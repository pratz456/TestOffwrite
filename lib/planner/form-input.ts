import { appliedOverpaymentCreditDate, assignInstallmentPeriod, isIsoDate } from '@/lib/tax-provider/quarterly-planner';
import { flooredPriorYearTax } from '@/lib/planner/zero-target';
import { PAYMENT_DATE_OUT_OF_RANGE_ERROR, PLANNER_ERROR_NEGATIVE, PLANNER_ERROR_NOT_A_NUMBER, plannerFill } from '@/lib/planner/planner-copy';
import type { YesNoBlank } from '@/lib/planner/zero-target';

export type PlannerPaymentKind = 'estimated' | 'prior_year_overpayment';
export type PriorReturnFiled = 'yes' | 'no' | '';

export interface PlannerPaymentDraft {
  clientId: string;
  date: string;
  amount: string;
  designatedTaxYear?: number;
  kind?: PlannerPaymentKind;
  priorReturnFiled?: PriorReturnFiled;
}

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
  payments: { clientId: string; date: string; amount: number; quarter: 1 | 2 | 3 | 4; designatedTaxYear: number | null; kind: PlannerPaymentKind }[];
  pendingApplied: boolean;
  priorYearTax: number;
}

/** First installment due date after weekend and holiday shifting. An applied overpayment is credited on this date. */
export function appliedCreditDate(taxYear: number): string {
  return appliedOverpaymentCreditDate(taxYear);
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

/** Latest payment date the form accepts: not after today, and not after April 15 of the next year. */
export function paymentDateMax(taxYear: number, asOf: string): string {
  const cap = `${taxYear + 1}-04-15`;
  return asOf < cap ? asOf : cap;
}

/** A payment dated January 1 through 15 asks which tax year it belongs to. */
export function paymentYearChoiceApplies(date: string, taxYear: number): boolean {
  if (!isIsoDate(date) || !Number.isInteger(taxYear)) return false;
  const monthDay = date.slice(5);
  return monthDay >= '01-01' && monthDay <= '01-15';
}

/** Defaults to the year before the payment date. Null when the date is outside that window. */
export function defaultDesignatedTaxYear(date: string, taxYear: number, chosen?: number): number | null {
  if (!paymentYearChoiceApplies(date, taxYear)) return null;
  const paymentYear = Number(date.slice(0, 4));
  const priorYear = paymentYear - 1;
  if (chosen === paymentYear || chosen === priorYear) return chosen;
  return priorYear;
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
  let pendingApplied = false;
  const dateError = plannerFill(PAYMENT_DATE_OUT_OF_RANGE_ERROR, { taxYear: input.taxYear, nextYear: input.taxYear + 1 });
  for (const payment of input.payments) {
    const applied = payment.kind === 'prior_year_overpayment';
    if (!applied && !payment.date.trim() && !payment.amount.trim()) continue;
    if (applied && !payment.amount.trim()) continue;
    const amount = moneyError(`payment-${payment.clientId}`, payment.amount, false, true);
    if (applied) {
      if (amount == null) continue;
      if (payment.priorReturnFiled !== 'yes') {
        pendingApplied = true;
        continue;
      }
      const date = appliedCreditDate(input.taxYear);
      payments.push({
        clientId: payment.clientId, date, amount, quarter: assignInstallmentPeriod(date, input.taxYear).quarter,
        designatedTaxYear: null, kind: 'prior_year_overpayment',
      });
      continue;
    }
    const earliest = `${input.taxYear}-01-01`;
    const latest = paymentDateMax(input.taxYear, input.asOf);
    if (!isIsoDate(payment.date) || payment.date < earliest || payment.date > latest) {
      errors.push({ field: `payment-date-${payment.clientId}`, message: dateError });
    } else if (amount != null) {
      const quarter = assignInstallmentPeriod(payment.date, input.taxYear).quarter;
      payments.push({
        clientId: payment.clientId, date: payment.date, amount, quarter,
        designatedTaxYear: defaultDesignatedTaxYear(payment.date, input.taxYear, payment.designatedTaxYear),
        kind: 'estimated',
      });
    }
  }
  if (input.twelveMonth !== 'yes' && input.twelveMonth !== 'no') {
    return { errors, parsed: null };
  }
  if (errors.length || line24 == null || credits == null || agi == null) return { errors, parsed: null };
  return {
    errors,
    parsed: { line24, credits, agi, withholding: input.hideWithholding ? null : withholding ?? 0, projectedIncome, payments, pendingApplied, priorYearTax: flooredPriorYearTax(line24, credits) },
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
