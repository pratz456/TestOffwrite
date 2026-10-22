import { assignInstallmentPeriod } from '@/lib/tax-provider/quarterly-planner';
import { flooredPriorYearTax } from '@/lib/planner/zero-target';
import { PLANNER_ERROR_NEGATIVE, PLANNER_ERROR_NOT_A_NUMBER, PLANNER_ERROR_PAYMENT_DATE, plannerFill } from '@/lib/planner/planner-copy';
import type { YesNoBlank } from '@/lib/planner/zero-target';

export interface PlannerPaymentDraft { clientId: string; date: string; amount: string }

export interface PlannerFormInput {
  taxYear: number;
  asOf: string;
  filingStatus: string;
  twelveMonth: YesNoBlank | 'not_sure';
  citizenOrResident: YesNoBlank;
  line24: string;
  credits: string;
  agi: string;
  withholding: string;
  hideWithholding: boolean;
  projectedIncome: string;
  payments: PlannerPaymentDraft[];
}

export type FieldError = { field: string; message: string };

export interface ParsedPlannerForm {
  line24: number;
  credits: number;
  agi: number;
  withholding: number | null;
  projectedIncome: number | null;
  payments: { clientId: string; date: string; amount: number; quarter: 1 | 2 | 3 | 4 }[];
  priorYearTax: number;
}

function parseDollar(raw: string, allowNegative: boolean): { ok: true; value: number } | { ok: false; reason: 'empty' | 'nan' | 'negative' } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  const normalized = trimmed.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return { ok: false, reason: 'nan' };
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, reason: 'nan' };
  if (!allowNegative && value < 0) return { ok: false, reason: 'negative' };
  return { ok: true, value };
}

export function plannerFormHasLastYearNumbers(input: Pick<PlannerFormInput, 'line24' | 'credits' | 'agi'>): boolean {
  return Boolean(input.line24.trim() || input.credits.trim() || input.agi.trim());
}

export function validatePlannerForm(input: PlannerFormInput): { errors: FieldError[]; parsed: ParsedPlannerForm | null } {
  const errors: FieldError[] = [];
  const moneyError = (field: string, raw: string, allowNegative: boolean, required: boolean) => {
    const parsed = parseDollar(raw, allowNegative);
    if (parsed.ok) return parsed.value;
    if (parsed.reason === 'empty' && !required) return null;
    errors.push({ field, message: parsed.reason === 'negative' ? PLANNER_ERROR_NEGATIVE : PLANNER_ERROR_NOT_A_NUMBER });
    return null;
  };
  const line24 = moneyError('line24', input.line24, false, true);
  const credits = moneyError('credits', input.credits, false, true);
  const agi = moneyError('agi', input.agi, true, true);
  const withholding = input.hideWithholding ? null : moneyError('withholding', input.withholding, false, false);
  const projectedIncome = moneyError('projectedIncome', input.projectedIncome, false, false);
  const payments: ParsedPlannerForm['payments'] = [];
  for (const payment of input.payments) {
    if (!payment.date.trim() && !payment.amount.trim()) continue;
    const amount = moneyError(`payment-${payment.clientId}`, payment.amount, false, true);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payment.date) || payment.date.slice(0, 4) !== String(input.taxYear) || payment.date > input.asOf) {
      errors.push({ field: `payment-date-${payment.clientId}`, message: plannerFill(PLANNER_ERROR_PAYMENT_DATE, { taxYear: input.taxYear }) });
    } else if (amount != null) {
      const quarter = assignInstallmentPeriod(payment.date, input.taxYear).quarter;
      payments.push({ clientId: payment.clientId, date: payment.date, amount, quarter });
    }
  }
  if (input.twelveMonth !== 'yes' && input.twelveMonth !== 'no') {
    return { errors, parsed: null };
  }
  if (errors.length || line24 == null || credits == null || agi == null) return { errors, parsed: null };
  return {
    errors,
    parsed: { line24, credits, agi, withholding: input.hideWithholding ? null : withholding ?? 0, projectedIncome, payments, priorYearTax: flooredPriorYearTax(line24, credits) },
  };
}

export function organizerPayload(input: PlannerFormInput, parsed: ParsedPlannerForm): Record<string, string> {
  const answers: Record<string, string> = {
    priorYearLine24Tax: String(parsed.line24),
    priorYearRefundableCredits: String(parsed.credits),
    priorYearTax: String(parsed.priorYearTax),
    priorYearAGI: String(parsed.agi),
    priorReturnCoveredTwelveMonths: input.twelveMonth === 'yes' ? 'yes' : 'no',
  };
  if (input.citizenOrResident === 'yes' || input.citizenOrResident === 'no') {
    answers.priorYearFullYearCitizenOrResident = input.citizenOrResident;
  }
  if (parsed.projectedIncome != null) answers.projectedNetBusinessIncome = String(parsed.projectedIncome);
  return answers;
}
