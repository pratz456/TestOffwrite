/**
 * Capital gain character for the federal planning estimate.
 * Sources:
 *   - §1211(b) and §1212(b): individual capital loss limit and carryover
 *   - §1(h): preferential rates on net capital gain
 *   - Schedule D (Form 1040) instructions, lines 16, 21 and the Capital Loss Carryover Worksheet
 *     https://www.irs.gov/instructions/i1040sd
 *   - Publication 550, chapter 4 (Capital Gains and Losses) https://www.irs.gov/publications/p550
 */
import { getFederalTaxRules } from './federal-year-rules';
import { normalizeFilingStatus } from './filing-status';

export class CapitalGainReviewRequiredError extends Error {
  readonly code = 'CAPITAL_GAIN_REVIEW_REQUIRED';
  constructor(detail: string) {
    super(`Review capital gains in Tax Organizer: ${detail}`);
    this.name = 'CapitalGainReviewRequiredError';
  }
}
const review = (message: string): never => { throw new CapitalGainReviewRequiredError(message); };
const round = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

/** §1211(b)(1): $3,000 of net capital loss offsets ordinary income each year ($1,500 married filing separately). */
export const CAPITAL_LOSS_LIMIT = 3000;
export const CAPITAL_LOSS_LIMIT_SEPARATE = 1500;

/** Organizer text fields. `amountCapGains` is the legacy combined Schedule D line 16 total. */
export const SHORT_TERM_FIELD = 'amountShortTermCapGains';
export const LONG_TERM_FIELD = 'amountLongTermCapGains';
export const LEGACY_CAPITAL_GAIN_FIELD = 'amountCapGains';

export interface CapitalGainFacts {
  /** Net short-term capital gain or (loss): Schedule D line 7. */
  shortTerm: number;
  /** Net long-term capital gain or (loss): Schedule D line 15. */
  longTerm: number;
  /** True when the organizer recorded a short/long-term split (including explicit zeros). */
  characterRecorded: boolean;
}

/** Blank is "not answered"; everything else must be a money amount. */
export function readCapitalGainAmount(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : null;
  if (text === null) return review(`enter ${label} as an amount.`);
  if (text === '') return undefined;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) return review(`enter ${label} as an amount, including 0 when none.`);
  const amount = Number(text);
  if (!Number.isFinite(amount) || Math.abs(amount) > 1e12) return review(`enter a valid ${label}.`);
  return amount;
}

/** True when any saved gain/loss amount (legacy or split) is nonzero; used by other review gates. */
export function hasCapitalGainAmounts(organizer: Record<string, unknown>): boolean {
  return [
    readCapitalGainAmount(organizer[SHORT_TERM_FIELD], 'net short-term capital gain or loss'),
    readCapitalGainAmount(organizer[LONG_TERM_FIELD], 'net long-term capital gain or loss'),
    readCapitalGainAmount(organizer[LEGACY_CAPITAL_GAIN_FIELD], 'net capital gain or loss'),
  ].some(amount => amount !== undefined && amount !== 0);
}

/**
 * The legacy combined total cannot establish character. A nonzero legacy amount
 * without the short/long-term split requires review instead of a long-term assumption.
 */
export function readCapitalGainFacts(organizer: Record<string, unknown>): CapitalGainFacts {
  const shortTerm = readCapitalGainAmount(organizer[SHORT_TERM_FIELD], 'net short-term capital gain or loss (Schedule D line 7)');
  const longTerm = readCapitalGainAmount(organizer[LONG_TERM_FIELD], 'net long-term capital gain or loss (Schedule D line 15)');
  const legacy = readCapitalGainAmount(organizer[LEGACY_CAPITAL_GAIN_FIELD], 'net capital gain or loss (Schedule D line 16)');
  const flag = organizer.hasCapGains;
  if (shortTerm === undefined && longTerm === undefined) {
    if (legacy !== undefined && legacy !== 0) {
      review('enter the net short-term (Schedule D line 7) and net long-term (Schedule D line 15) amounts separately. The saved combined total does not establish which gains qualify for the 0/15/20% rates, and long-term treatment is not assumed.');
    }
    if (flag === 'yes' && legacy === undefined) review('enter the net short-term and net long-term capital gain or loss amounts, including 0 when none.');
    return { shortTerm: 0, longTerm: 0, characterRecorded: false };
  }
  if (shortTerm === undefined || longTerm === undefined) {
    review(`enter the ${shortTerm === undefined ? 'net short-term (Schedule D line 7)' : 'net long-term (Schedule D line 15)'} amount, including 0 when none.`);
  }
  const st = shortTerm as number, lt = longTerm as number;
  if (flag === 'no' && (st !== 0 || lt !== 0)) review('capital gain amounts are saved while the capital gains question is marked No; reconcile those answers.');
  if (legacy !== undefined && legacy !== 0 && Math.abs(legacy - (st + lt)) > 0.005) {
    review('the saved combined Schedule D total does not equal the short-term plus long-term amounts; reconcile those entries.');
  }
  return { shortTerm: st, longTerm: lt, characterRecorded: true };
}

export interface CapitalGainCharacterInput {
  taxYear: number;
  filingStatus: string;
  shortTerm: number;
  longTerm: number;
}
export interface CapitalGainCharacterResult {
  taxYear: number;
  netShortTerm: number;
  netLongTerm: number;
  /** Schedule D line 16 combined result before the loss limit. */
  netGainOrLoss: number;
  /** Form 1040 line 7 amount after the §1211(b) limit. */
  line7: number;
  /** Portion of line 7 eligible for the 0/15/20% rates (Schedule D worksheet: smaller of lines 15 and 16). */
  preferentialLongTermGain: number;
  /** Portion of line 7 taxed as ordinary income. */
  ordinaryShortTermGain: number;
  capitalLossLimit: number;
  allowedLoss: number;
  lossCarryforward: number;
  warnings: string[];
}

/**
 * Schedule D netting for one year. Collectibles (28%), unrecaptured §1250 gain,
 * qualified dividends, prior-year carryovers, wash sales and basis are not modeled.
 */
export function calculateCapitalGainCharacter(input: CapitalGainCharacterInput): CapitalGainCharacterResult {
  const taxYear = getFederalTaxRules(input.taxYear).taxYear;
  const filingStatus = normalizeFilingStatus(input.filingStatus);
  const netShortTerm = round(input.shortTerm), netLongTerm = round(input.longTerm);
  if (![netShortTerm, netLongTerm].every(amount => Number.isFinite(amount) && Math.abs(amount) <= 1e12)) review('enter valid capital gain and loss amounts.');
  const netGainOrLoss = round(netShortTerm + netLongTerm);
  const capitalLossLimit = filingStatus === 'married_filing_separately' ? CAPITAL_LOSS_LIMIT_SEPARATE : CAPITAL_LOSS_LIMIT;
  const warnings: string[] = [];
  const result: CapitalGainCharacterResult = {
    taxYear, netShortTerm, netLongTerm, netGainOrLoss, line7: netGainOrLoss,
    preferentialLongTermGain: 0, ordinaryShortTermGain: 0, capitalLossLimit, allowedLoss: 0, lossCarryforward: 0, warnings,
  };
  if (netGainOrLoss < 0) {
    result.allowedLoss = Math.min(-netGainOrLoss, capitalLossLimit);
    result.lossCarryforward = round(-netGainOrLoss - result.allowedLoss);
    result.line7 = -result.allowedLoss;
    if (result.lossCarryforward > 0) {
      warnings.push(`Net capital loss of $${(-netGainOrLoss).toLocaleString('en-US')} exceeds the $${capitalLossLimit.toLocaleString('en-US')} annual limit; $${result.lossCarryforward.toLocaleString('en-US')} carries forward to later years (Schedule D Capital Loss Carryover Worksheet). This estimate applies only the current-year limit and does not track carryovers.`);
    }
  } else if (netGainOrLoss > 0) {
    result.preferentialLongTermGain = round(Math.min(Math.max(0, netLongTerm), netGainOrLoss));
    result.ordinaryShortTermGain = round(netGainOrLoss - result.preferentialLongTermGain);
  }
  if (netShortTerm !== 0 || netLongTerm !== 0) {
    warnings.push('Capital gain character uses your saved Schedule D short-term and long-term totals. Collectibles (28%) gain, unrecaptured section 1250 gain, qualified dividends, prior-year loss carryovers, wash sales and basis records are not modeled and need review.');
  }
  return result;
}
