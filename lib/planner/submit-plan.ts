import { buildPlannerCardView, type PlannerCardView } from '@/lib/planner/card-view';
import { organizerPayload, validatePlannerForm, type PlannerFormInput } from '@/lib/planner/form-input';
import { PLANNER_ERROR_LOAD, PLANNER_ERROR_SAVE } from '@/lib/planner/planner-copy';
import type { YesNoBlank } from '@/lib/planner/zero-target';

export interface PlannerTransport {
  postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; body: unknown }>;
  getJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }>;
}

export interface PlannerSubmitGuard { current: boolean; postedPaymentIds: Set<string> }

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
      if (guard.postedPaymentIds.has(payment.clientId)) continue;
      const saved = await transport.postJson('/api/tax/quarterly-payments', {
        quarter: payment.quarter, year: input.taxYear, paidAmount: payment.amount, paidDate: payment.date,
      });
      if (!saved.ok) throw new Error('payment');
      guard.postedPaymentIds.add(payment.clientId);
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
    nextAmount: typeof nextDue?.amountToPay === 'number' ? nextDue.amountToPay : null,
    nextDueDate: typeof nextDue?.dueDate === 'string' ? nextDue.dueDate : null,
    deMinimisApplies: asRecord(required?.deMinimis)?.applies === true,
    deMinimisEvaluated: asRecord(required?.deMinimis)?.evaluated === true,
    missingLabels: missing,
  });
  try {
    await transport.postJson('/api/database/profiles', { firstRunPlannerCard: 'completed' });
  } catch { /* The result is already on screen. A later visit retries nothing the user still needs to see. */ }
  return { status: 'ready', view };
}
