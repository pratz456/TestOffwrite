/**
 * Schedule C loss treatment for the federal planning estimate.
 * Sources:
 *   - §465 at-risk rules; Schedule C line 32a/32b and Form 6198 https://www.irs.gov/instructions/i1040sc
 *   - §469 passive activity rules; Schedule C line G material participation; Form 8582
 *   - §183 activities not engaged in for profit; Reg. §1.183-2(b) factors
 *     https://www.irs.gov/newsroom/heres-how-to-tell-the-difference-between-a-hobby-and-a-business-for-tax-purposes
 *   - §461(l) excess business loss limitation (permanent under P.L. 119-21 §70601); Form 461 instructions
 *     https://www.irs.gov/instructions/i461 ; annual thresholds in federal-year-rules.ts
 *   - §172 net operating losses; Publication 536 https://www.irs.gov/publications/p536
 */
import { getFederalTaxRules } from './federal-year-rules';
import { normalizeFilingStatus } from './filing-status';

export const BUSINESS_LOSS_FIELD = 'businessLossFacts';
export interface BusinessLossAnswers {
  version: 1;
  taxYear: number;
  /** Schedule C line 32a: all investment is at risk (§465). */
  allInvestmentAtRisk?: string;
  /** Schedule C line G: material participation (§469). */
  materialParticipation?: string;
  /** §183: activity carried on for profit (not a hobby). */
  profitMotive?: string;
}
export class BusinessLossReviewRequiredError extends Error {
  readonly code = 'BUSINESS_LOSS_REVIEW_REQUIRED';
  constructor(detail: string) {
    super(`Review business loss facts in Tax Organizer: ${detail}`);
    this.name = 'BusinessLossReviewRequiredError';
  }
}
const review = (message: string): never => { throw new BusinessLossReviewRequiredError(message); };
const round = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

/** Blank/missing facts are unanswered, not "No"; the caller decides whether a loss makes them required. */
export function readBusinessLossAnswers(raw: unknown): BusinessLossAnswers | undefined {
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) return undefined;
  if (typeof raw !== 'string') return review('saved business loss answers are invalid; save the section again.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return review('saved business loss answers are invalid; save the section again.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as { version?: unknown }).version !== 1) {
    return review('saved business loss answers need review; save the section again.');
  }
  if (!Number.isInteger((value as { taxYear?: unknown }).taxYear)) review('save business loss answers for the selected tax year.');
  if (Object.entries(value).some(([key, item]) => key !== 'version' && key !== 'taxYear' && typeof item !== 'string')) {
    return review('business loss answers must be text selections.');
  }
  return value as BusinessLossAnswers;
}

export interface BusinessLossInput {
  taxYear: number;
  filingStatus: string;
  /** Schedule C net loss after depreciation, as a positive amount. */
  netLoss: number;
  organizer?: Record<string, unknown>;
}
export interface BusinessLossResult {
  taxYear: number;
  netLoss: number;
  /** Loss allowed against other income this year (positive amount). */
  allowedLoss: number;
  /** §461(l) disallowed amount treated as a net operating loss carryforward. */
  excessBusinessLoss: number;
  excessBusinessLossThreshold: number;
  warnings: string[];
}

/**
 * A Schedule C loss offsets other income only with explicit at-risk, participation
 * and profit-motive declarations; otherwise the estimate is review-blocked rather
 * than clamped to zero. Losses from other businesses are not aggregated here.
 */
export function calculateAllowedBusinessLoss(input: BusinessLossInput): BusinessLossResult {
  const rules = getFederalTaxRules(input.taxYear);
  const filingStatus = normalizeFilingStatus(input.filingStatus);
  const netLoss = round(input.netLoss);
  if (!Number.isFinite(netLoss) || netLoss < 0 || netLoss > 1e12) review('the Schedule C loss amount is invalid.');
  const threshold = rules.excessBusinessLossThreshold[filingStatus];
  const result: BusinessLossResult = { taxYear: rules.taxYear, netLoss, allowedLoss: 0, excessBusinessLoss: 0, excessBusinessLossThreshold: threshold, warnings: [] };
  if (netLoss === 0) return result;
  if (!input.organizer) review('your business shows a net loss. Record the at-risk, material participation and profit-motive facts before the loss can offset other income.');
  const facts = readBusinessLossAnswers((input.organizer as Record<string, unknown>)[BUSINESS_LOSS_FIELD]);
  if (!facts) review(`your ${rules.taxYear} business shows a net loss of $${netLoss.toLocaleString('en-US')}. Answer the at-risk, material participation and profit-motive questions before the loss can offset other income.`);
  const answers = facts as BusinessLossAnswers;
  if (answers.taxYear !== rules.taxYear) review(`business loss answers were saved for ${answers.taxYear}; confirm them for ${rules.taxYear}.`);
  const yesNo = (value: unknown, label: string) => {
    if (value !== 'yes' && value !== 'no') review(`answer ${label}; an unanswered question is not “No.”`);
    return value === 'yes';
  };
  if (!yesNo(answers.allInvestmentAtRisk, 'whether all of your investment in the business is at risk (Schedule C line 32a)')) {
    review('some of your investment is not at risk (Schedule C line 32b). The deductible loss is limited by Form 6198, which this estimate does not prepare.');
  }
  if (!yesNo(answers.materialParticipation, 'whether you materially participated in the business (Schedule C line G)')) {
    review('you did not materially participate, so the loss is a passive activity loss limited by Form 8582 (section 469). That limitation is not modeled here.');
  }
  if (!yesNo(answers.profitMotive, 'whether the activity is carried on to make a profit (not a hobby)')) {
    review('an activity not engaged in for profit (section 183 hobby) reports its income as other income and cannot deduct a loss. Review the nine factors in Regulation 1.183-2(b) with a tax professional.');
  }
  result.allowedLoss = Math.min(netLoss, threshold);
  result.excessBusinessLoss = round(netLoss - result.allowedLoss);
  result.warnings.push(`Your $${netLoss.toLocaleString('en-US')} Schedule C loss offsets other income based on your at-risk, material participation and profit-motive declarations. Keep the supporting records; Forms 6198 and 8582 are not prepared, and losses from other businesses are not aggregated for the section 461(l) limit.`);
  if (result.excessBusinessLoss > 0) {
    result.warnings.push(`The section 461(l) excess business loss limit is $${threshold.toLocaleString('en-US')} for ${rules.taxYear}. $${result.excessBusinessLoss.toLocaleString('en-US')} is disallowed this year and becomes a net operating loss carryforward (Form 461; Publication 536).`);
  }
  return result;
}
