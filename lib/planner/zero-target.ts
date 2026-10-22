import { PRIOR_YEAR_ZERO_TAX_NET_CEILING } from '@/lib/tax-rules/estimated-tax-safe-harbor';

export type YesNoBlank = 'yes' | 'no' | '';

export interface PriorYearZeroInput {
  line24: number;
  credits: number;
  twelveMonth: YesNoBlank;
  citizenOrResident: YesNoBlank;
}

export interface PriorYearZeroDecision {
  priorNet: number;
  /** Floored at 0. This is what priorYearTax stores. Never use it for the E1 test. */
  priorYearTax: number;
  zeroTax: boolean;
  showE1: boolean;
  /** 12-month yes, residency no, prior net at or below 0. */
  showCase1: boolean;
  /** 12-month yes, residency blank, prior net at or below 0. */
  showCase2: boolean;
  /** 12-month no. The section 5 no-return state applies. No E1 and no zero-target explanation. */
  showNoTwelveMonth: boolean;
  /** Rule ZT-HIDE: last year's target is $0, so the 90% line and link stay hidden. */
  hideNinetyPrompt: boolean;
}

const cents = (value: number) => Math.round(value * 100);

/** Raw line 24 minus raw refundable credits. Does not read the floored priorYearTax field. */
export function priorYearNetTax(line24: number, credits: number): number {
  if (!Number.isFinite(line24) || !Number.isFinite(credits)) throw new RangeError('Prior-year tax inputs must be finite.');
  return (cents(line24) - cents(credits)) / 100;
}

export function flooredPriorYearTax(line24: number, credits: number): number {
  return Math.max(0, priorYearNetTax(line24, credits));
}

export function decidePriorYearZeroTarget(input: PriorYearZeroInput): PriorYearZeroDecision {
  const priorNet = priorYearNetTax(input.line24, input.credits);
  const zeroTax = priorNet <= PRIOR_YEAR_ZERO_TAX_NET_CEILING;
  const twelveYes = input.twelveMonth === 'yes';
  const showE1 = zeroTax && twelveYes && input.citizenOrResident === 'yes';
  const showCase1 = zeroTax && twelveYes && input.citizenOrResident === 'no';
  const showCase2 = zeroTax && twelveYes && input.citizenOrResident === '';
  const showNoTwelveMonth = input.twelveMonth === 'no';
  return {
    priorNet,
    priorYearTax: Math.max(0, priorNet),
    zeroTax,
    showE1,
    showCase1,
    showCase2,
    showNoTwelveMonth,
    hideNinetyPrompt: showE1 || showCase1,
  };
}
