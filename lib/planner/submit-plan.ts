import { buildPlannerCardView, type PlannerCardView } from '@/lib/planner/card-view';
import type { PastDueAllocation, PastDueInstallment } from '@/lib/planner/past-due';
import { organizerPayload, validatePlannerForm, type PlannerFormInput } from '@/lib/planner/form-input';
import { PLANNER_ERROR_LOAD, PLANNER_ERROR_SAVE } from '@/lib/planner/planner-copy';
import type { YesNoBlank } from '@/lib/planner/zero-target';

export interface PlannerTransport {
  postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; body: unknown }>;
  getJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }>;
}

export interface PlannerSubmitGuard { current: boolean; postedPaymentIds: Set<string>; postedSignatures?: Map<string, string> }

export type PlannerSubmitResult =
  | { status: 'duplicate' }
  | { status: 'invalid'; message: string }
  | { status: 'not_sure' }
  | { status: 'save_failed'; message: string }
  | { status: 'load_failed'; message: string; view: PlannerCardView | null }
  | { status: 'ready'; view: PlannerCardView };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readPastDue(planner: Record<string, unknown> | null): PastDueAllocation | null {
  const pastDue = planner ? asRecord(planner.pastDue) : null;
  if (!pastDue || typeof pastDue.amount !== 'number' || !Array.isArray(pastDue.installments)) return null;
  const installments = pastDue.installments.flatMap((item): PastDueInstallment[] => {
    const row = asRecord(item);
    if (!row || typeof row.n !== 'number' || typeof row.dueDate !== 'string' || typeof row.balance !== 'number' || typeof row.shortAtDue !== 'number' || typeof row.paidLate !== 'boolean') return [];
    if (row.n !== 1 && row.n !== 2 && row.n !== 3 && row.n !== 4) return [];
    return [{ n: row.n, dueDate: row.dueDate, balance: row.balance, shortAtDue: row.shortAtDue, paidLate: row.paidLate }];
  });
  if (installments.length !== 4) return null;
  const window = pastDue.window === 'open' || pastDue.window === 'w1' || pastDue.window === 'w2' || pastDue.window === 'w3' ? pastDue.window : null;
  if (!window || typeof pastDue.passedDueDates !== 'number' || typeof pastDue.nextOnly !== 'number' || typeof pastDue.remaining !== 'number' || typeof pastDue.nextInstallmentBalance !== 'number' || typeof pastDue.q4AltDate !== 'string' || typeof pastDue.lastDue !== 'string' || typeof pastDue.penaltyEnd !== 'string') return null;
  return {
    amount: pastDue.amount,
    passedDueDates: pastDue.passedDueDates,
    nextInstallmentBalance: pastDue.nextInstallmentBalance,
    nextOnly: pastDue.nextOnly,
    remaining: pastDue.remaining,
    nextDueDate: typeof pastDue.nextDueDate === 'string' ? pastDue.nextDueDate : null,
    window,
    q4AltDate: pastDue.q4AltDate,
    lastDue: pastDue.lastDue,
    penaltyEnd: pastDue.penaltyEnd,
    installments,
  };
}

export async function submitPlannerCard(input: PlannerFormInput, transport: PlannerTransport, guard: PlannerSubmitGuard): Promise<PlannerSubmitResult> {
  if (guard.current) return { status: 'duplicate' };
  guard.current = true;
  if (input.twelveMonth === 'not_sure') {
    guard.current = false;
    return { status: 'not_sure' };
  }
  const { errors, parsed } = validatePlannerForm(input);
  if (!parsed) {
    guard.current = false;
    return { status: 'invalid', message: errors[0]?.message ?? PLANNER_ERROR_SAVE };
  }
  const twelveMonth: YesNoBlank = input.twelveMonth;
  try {
    const organizer = await transport.postJson('/api/tax/organizer', { taxYear: input.taxYear, ...organizerPayload(input, parsed) });
    if (!organizer.ok) throw new Error('organizer');
    const profile: Record<string, unknown> = { filing_status: input.filingStatus };
    if (!input.hideWithholding) profile.w2_federal_withheld = parsed.withholding ?? 0;
    const profileWrite = await transport.postJson('/api/database/profiles', profile);
    if (!profileWrite.ok) throw new Error('profile');
    for (const payment of parsed.payments) {
      const signature = `${payment.date}|${payment.amount}|${payment.designatedTaxYear ?? ''}|${payment.kind}`;
      const signatures = guard.postedSignatures ?? (guard.postedSignatures = new Map());
      if (signatures.get(payment.clientId) === signature) continue;
      const saved = await transport.postJson('/api/tax/quarterly-payments', {
        paymentId: payment.clientId,
        quarter: payment.quarter, year: input.taxYear, paidAmount: payment.amount, paidDate: payment.date,
        ...(payment.designatedTaxYear == null ? {} : { designatedTaxYear: payment.designatedTaxYear }),
        ...(payment.kind === 'prior_year_overpayment' ? { paymentType: 'prior_year_overpayment', priorReturnFiled: true } : {}),
      });
      if (!saved.ok) throw new Error('payment');
      guard.postedPaymentIds.add(payment.clientId);
      signatures.set(payment.clientId, signature);
    }
  } catch {
    guard.current = false;
    return { status: 'save_failed', message: PLANNER_ERROR_SAVE };
  }
  let planBody: Record<string, unknown> | null = null;
  try {
    const plan = await transport.getJson(`/api/tax/quarterly-reminders?year=${input.taxYear}&asOf=${input.asOf}`);
    planBody = asRecord(plan.body);
    if (!plan.ok || !planBody) throw new Error('plan');
  } catch {
    guard.current = false;
    return { status: 'load_failed', message: PLANNER_ERROR_LOAD, view: null };
  }
  const planner = asRecord(planBody.planner);
  const required = planner ? asRecord(planner.requiredAnnualPayment) : null;
  const nextDue = planner ? asRecord(planner.nextDue) : null;
  const pastDue = readPastDue(planner);
  const missing = planner && planner.status === 'review_required' && Array.isArray(planner.missingFacts)
    ? planner.missingFacts.map(fact => asRecord(fact)?.label).filter((label): label is string => typeof label === 'string')
    : [];
  const hasCurrentYearFigure = parsed.projectedIncome != null && parsed.projectedIncome > 0 || (required?.currentYearCompared === true);
  const view = buildPlannerCardView({
    line24: parsed.line24,
    credits: parsed.credits,
    twelveMonth,
    citizenOrResident: input.citizenOrResident,
    taxYear: input.taxYear,
    hasCurrentYearFigure,
    basis: typeof required?.basis === 'string' ? required.basis as 'current_year_90' | 'prior_year_100' | 'prior_year_110' : null,
    annualAmount: typeof required?.requiredAnnualPayment === 'number' ? required.requiredAnnualPayment : null,
    nextAmount: pastDue ? pastDue.nextOnly : typeof nextDue?.amountToPay === 'number' ? nextDue.amountToPay : null,
    nextDueDate: pastDue?.nextDueDate ?? (typeof nextDue?.dueDate === 'string' ? nextDue.dueDate : null),
    pastDue,
    deMinimisApplies: asRecord(required?.deMinimis)?.applies === true,
    deMinimisEvaluated: asRecord(required?.deMinimis)?.evaluated === true,
    missingLabels: missing,
    appliedCreditPending: parsed.pendingApplied,
  });
  try {
    await transport.postJson('/api/database/profiles', { firstRunPlannerCard: 'completed' });
  } catch { /* The result is already on screen. A later visit retries nothing the user still needs to see. */ }
  guard.current = false;
  return { status: 'ready', view };
}
