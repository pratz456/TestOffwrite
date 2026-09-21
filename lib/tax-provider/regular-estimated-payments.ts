import { getFederalTaxRules } from '@/lib/tax-rules/federal-year-rules';
import { normalizeFilingStatus } from '@/lib/tax-rules/filing-status';
import { getEstimatedTaxDeadline } from './payment-deadlines';

export const QUARTERLY_REVIEW_MESSAGE = 'Review your full-year federal tax forecast, expected withholding, prior-year return and dated payments before choosing an installment. Saved transactions alone do not establish an amount due or penalty protection. Use the 1040-ES worksheet or the payment-planning tool, then record your actual payments.';
export class QuarterlyReviewRequiredError extends Error {
  readonly code = 'QUARTERLY_REVIEW_REQUIRED';
}
export interface RegularEstimatedPaymentInput {
  taxYear: number;
  filingStatus: string;
  /** Form 1040-ES worksheet line 11c, after applicable refundable credits. */
  expectedTaxAfterCredits: number;
  expectedAnnualWithholding: number;
  reviewedTaxAmounts: boolean;
  /** Ordinary calendar-year regular method, income from first period; no special rules. */
  regularMethodConfirmed: boolean;
  priorYear: { available: false; noPriorTaxExceptionRuledOut: boolean } | {
    available: true; adjustedGrossIncome: number; taxAfterAdjustments: number;
    fullTwelveMonths: boolean; sameTaxpayersAndFilingStatus: boolean; fullYearUSResident: boolean;
  };
}
const fail = (message: string): never => { throw new QuarterlyReviewRequiredError(message); };
const amount = (value: unknown, label: string, allowNegative = false): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || (!allowNegative && value < 0)) fail(`Enter a valid ${label}.`);
  return Math.round((value as number) * 100);
};

/** 2026 Pub505 worksheet2-1 lines11c–15. Original regular installments only. */
export function calculateRegularEstimatedPayments(input: RegularEstimatedPaymentInput) {
  getFederalTaxRules(input.taxYear); // Never silently apply published parameters to 2027.
  const filingStatus = normalizeFilingStatus(input.filingStatus);
  if (!input.reviewedTaxAmounts) fail('Confirm the annual tax and withholding amounts were reviewed using the selected year’s 1040-ES worksheet. Form1040 line24 alone may need adjustments.');
  if (!input.regularMethodConfirmed) fail('Confirm the regular calendar-year method applies. Uneven or later-start income, farming/fishing, nonresident/fiscal-year returns, section 1062 elections and special relief need separate review.');
  const tax = amount(input.expectedTaxAfterCredits, 'full-year tax after refundable credits');
  const withholding = amount(input.expectedAnnualWithholding, 'full-year withholding');
  const currentTarget = Math.round(tax * .90);
  let priorTarget: number | null = null;
  if (!input.priorYear || typeof input.priorYear.available !== 'boolean') fail('Choose whether a prior-year return is available for this calculation.');
  if (!input.priorYear.available && input.priorYear.noPriorTaxExceptionRuledOut !== true) {
    fail('Review the no-prior-year-tax exception before using the current-year method. A full 12-month prior year with no tax liability and full-year U.S. citizenship/residency can exempt you even when no return was required.');
  }
  if (input.priorYear.available) {
    const prior = input.priorYear;
    if (!prior.fullTwelveMonths || !prior.sameTaxpayersAndFilingStatus || !prior.fullYearUSResident) {
      fail('The prior-year method needs a full 12-month return, the same taxpayer(s) and filing status and U.S. residency facts. Review changed joint/separate returns or the no-prior-tax exception before using a target.');
    }
    const agi = amount(prior.adjustedGrossIncome, 'prior-year adjusted gross income', true);
    const priorTax = amount(prior.taxAfterAdjustments, 'prior-year tax after 1040-ES adjustments');
    const threshold = (filingStatus === 'married_filing_separately' ? 75000 : 150000) * 100;
    priorTarget = Math.round(priorTax * (agi > threshold ? 1.10 : 1));
  }
  const required = priorTarget === null ? currentTarget : Math.min(currentTarget, priorTarget);
  // The $1,000 test uses expected tax less withholding, not estimated payments made.
  const estimated = tax - withholding < 100000 ? 0 : Math.max(0, required - withholding);
  const installment = Math.ceil(estimated / 4);
  return {
    taxYear: input.taxYear, filingStatus, basis: 'original_regular_installments' as const,
    currentYearTarget: currentTarget / 100, priorYearTarget: priorTarget === null ? null : priorTarget / 100,
    annualRequiredPayment: required / 100, annualEstimatedPayments: estimated / 100,
    installments: ([1, 2, 3, 4] as const).map(quarter => ({ quarter,
      amount: (quarter === 4 ? Math.max(0, estimated - installment * 3) : Math.min(installment, Math.max(0, estimated - installment * (quarter - 1)))) / 100,
      dueDate: getEstimatedTaxDeadline(input.taxYear, quarter).toISOString().slice(0, 10),
    })),
    note: 'Original regular-method installments before payments already made. This is not a current balance due, annualized-income calculation, penalty calculation or guarantee. Review dated payments, changed forecasts and any special relief before paying.',
  };
}
