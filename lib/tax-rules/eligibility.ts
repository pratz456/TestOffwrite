import { z } from 'zod';
import { getFederalTaxRules } from './federal-year-rules';
import { TaxCalculationScopeReviewRequiredError } from './calculation-scope';

const answer = z.enum(['', 'yes', 'no']);
const dollars = z.string().max(24).regex(/^(?:\d+(?:\.\d{0,2})?)?$/);
const month = z.object({ coverage: z.enum(['', 'none', 'self', 'family']), medicare: answer }).strict();
export const eligibilityFactsSchema = z.object({
  version: z.literal(1), taxYear: z.number().int().min(2024).max(2027),
  hsa: z.object({
    owner: z.enum(['', 'taxpayer', 'spouse']).optional(), age55: answer.optional(), notDependent: answer.optional(),
    eligibleCoverageConfirmed: answer.optional(), monthlyMethod: answer.optional(), onlyOneHolder: answer.optional(),
    familyAllocationAgreed: answer.optional(), employerContributions: dollars.optional(), otherReductions: dollars.optional(),
    noDistributionsOrPriorExcess: answer.optional(), months: z.array(month).length(12).optional(),
  }).strict().optional(),
  health: z.object({
    soleProprietor: answer.optional(),
    policyUnderBusiness: answer.optional(), coveredPeopleEligible: answer.optional(), nonMarketplace: answer.optional(),
    noLongTermCare: answer.optional(), noReimbursement: answer.optional(), oneBusiness: answer.optional(), noForeignIncomeExclusion: answer.optional(),
    months: z.array(z.object({ premiums: dollars, employerAccess: answer }).strict()).length(12).optional(),
  }).strict().optional(),
  retirement: z.object({
    soleProprietor: answer.optional(),
    plan: z.enum(['', 'sep_ira', 'solo_401k', 'simple_ira']).optional(),
    establishedAndTimely: answer.optional(), onlyPlan: answer.optional(), noEmployees: answer.optional(),
    noOtherDeferrals: answer.optional(), traditionalOnly: answer.optional(), noCatchUp: answer.optional(), earnedFromServices: answer.optional(),
    employerRate: dollars.optional(), employeeContribution: dollars.optional(), employerContribution: dollars.optional(),
    simpleMethod: z.enum(['', 'match3', 'nonelective2']).optional(),
  }).strict().optional(),
  joint: z.object({
    oneSelfEmployedSpouse: answer.optional(), businessOwner: z.enum(['', 'taxpayer', 'spouse']).optional(),
    taxpayerWages: dollars.optional(), spouseWages: dollars.optional(), taxpayerSSWages: dollars.optional(), spouseSSWages: dollars.optional(),
    taxpayerMedicareWages: dollars.optional(), spouseMedicareWages: dollars.optional(),
  }).strict().optional(),
}).strict();
export type EligibilityFacts = z.infer<typeof eligibilityFactsSchema>;
export const ELIGIBILITY_SOURCES = [
  'https://www.irs.gov/instructions/i8889', 'https://www.irs.gov/instructions/i7206',
  'https://www.irs.gov/publications/p560', 'https://www.irs.gov/instructions/i1040sse',
] as const;
const review = (message: string): never => { throw new TaxCalculationScopeReviewRequiredError(message); };
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
function money(value: unknown, label: string): number {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isSafeInteger(Math.round(Number(value) * 100))) {
    return review(`Enter ${label}, including 0 when none, in Deduction eligibility in Tax Organizer`);
  }
  return Number(value);
}
function yes(value: unknown, message: string) { if (value !== 'yes') review(message); }
export function readEligibilityFacts(value: unknown): EligibilityFacts | null {
  if (value === undefined || value === null || value === '') return null;
  try {
    if (typeof value !== 'string' || value.length > 5000) return review('Saved deduction eligibility answers are invalid; review and save them again');
    return eligibilityFactsSchema.parse(JSON.parse(value));
  } catch { return review('Saved deduction eligibility answers are invalid; review and save them again'); }
}
function factsForYear(organizer: Record<string, unknown> | undefined, taxYear: number) {
  const facts = readEligibilityFacts(organizer?.adjustmentEligibilityFacts);
  if (facts && facts.taxYear !== taxYear) review(`Deduction eligibility answers belong to ${facts.taxYear}; complete the answers for ${taxYear}`);
  return facts;
}

/** Form 8889 monthly method only. No unverified last-month election or excess-contribution tax. */
export function calculateEligibleHSA(taxYear: number, filingStatus: string, contribution: number, facts?: EligibilityFacts['hsa']) {
  if (!facts) return review('Complete HSA eligibility: coverage type and eligible months, age, Medicare coverage, and employer or other contributions in Tax Organizer');
  yes(facts.notDependent, 'HSA contributions require the account holder not to be another taxpayer’s dependent');
  yes(facts.eligibleCoverageConfirmed, 'Confirm HSA-qualified coverage and no disqualifying other coverage for each month marked eligible');
  yes(facts.monthlyMethod, 'Last-month-rule contributions require a testing-period review; this estimate supports the monthly eligibility method');
  yes(facts.onlyOneHolder, 'Separate spouse HSAs and shared family limits need two Forms 8889; this intake supports one contributing account holder');
  yes(facts.noDistributionsOrPriorExcess, 'HSA distributions, prior-year excess contributions or testing-period failures need Forms 8889/5329 review');
  if (!['taxpayer', 'spouse'].includes(facts.owner ?? '') || facts.owner === 'spouse' && filingStatus !== 'married_filing_jointly') review('Identify the HSA account holder; a spouse’s HSA deduction can be included only on a joint return');
  if (!['yes', 'no'].includes(facts.age55 ?? '')) review('Confirm whether the HSA account holder was age 55 or older at year end');
  const months = facts.months ?? review('Complete coverage and Medicare status for all 12 months, using coverage on the first day of each month');
  if (months.some(m => !m.coverage || !['yes', 'no'].includes(m.medicare))) review('Complete coverage and Medicare status for all 12 months, using coverage on the first day of each month');
  const married = filingStatus === 'married_filing_jointly' || filingStatus === 'married_filing_separately';
  if (married && months.some(m => m.coverage === 'family')) yes(facts.familyAllocationAgreed, 'Confirm the married family contribution limit is allocated to this holder by agreement and no spouse contributions use it');
  const limits = getFederalTaxRules(taxYear).hsaContributionLimit;
  let eligibleMonths = 0, annualLimit = 0;
  for (const m of months) {
    if (m.coverage === 'none' || m.medicare === 'yes') continue;
    eligibleMonths++;
    annualLimit += ((m.coverage === 'family' ? limits.family : limits.selfOnly) + (facts.age55 === 'yes' ? limits.catchUp : 0)) / 12;
  }
  annualLimit = round(annualLimit);
  const employer = money(facts.employerContributions, 'employer/payroll HSA contributions (including W-2 code W)');
  const reductions = money(facts.otherReductions, 'Archer MSA contributions and qualified HSA funding distributions');
  if (reductions > 0) review('Archer MSA contributions or IRA-to-HSA funding distributions need coordinated Form 8889 review');
  const available = Math.max(0, round(annualLimit - employer));
  if (employer + contribution > annualLimit + .005) review(`HSA contributions exceed the supported monthly limit of $${annualLimit.toFixed(2)}. Review excess contributions and Form 5329 or timely corrective distributions`);
  return { deduction: round(contribution), limit: annualLimit, availableAfterEmployer: available, eligibleMonths };
}

/** Pub 560 ch.5 / SIMPLE ch.3, one traditional sole-proprietor plan, no catch-up contributions. */
export function calculateEligibleRetirement(input: { taxYear: number; netProfit: number; halfSE: number; sep: number; solo: number; simple: number }, facts?: EligibilityFacts['retirement']) {
  if (!facts) return review('Complete retirement-plan eligibility, contribution type, earned-income limits and contributions across other plans in Tax Organizer');
  for (const [key, message] of [
    ['soleProprietor', 'Confirm this is one sole-proprietor or disregarded single-member LLC business, not a partnership or corporation'],
    ['establishedAndTimely', 'Confirm the plan was validly established and these tax-year contributions/elections met the applicable deadlines'],
    ['onlyPlan', 'Multiple plans, controlled businesses and other business income need coordinated retirement-limit review'],
    ['noEmployees', 'Employee coverage and required employer contributions need plan-administrator review; this intake supports an owner-only business'],
    ['noOtherDeferrals', 'Other-employer or other-plan deferrals need aggregation before this self-employed plan deduction'],
    ['traditionalOnly', 'Roth, after-tax and rollover amounts are not included in this traditional deductible-contribution calculation'],
    ['noCatchUp', 'Catch-up contributions, including age 60–63 and mandatory Roth rules, need separate plan review'],
    ['earnedFromServices', 'Confirm your services materially helped produce this business’s earned income'],
  ] as const) yes(facts[key], message);
  if (input.taxYear !== 2025 && input.taxYear !== 2026) review('This retirement worksheet supports published 2025 and 2026 plan limits; other years require review');
  const active = [['sep_ira', input.sep], ['solo_401k', input.solo], ['simple_ira', input.simple]] as const;
  if (active.filter(([, amount]) => amount > 0).length !== 1 || !active.some(([plan, amount]) => plan === facts.plan && amount > 0)) review('Reconcile the saved retirement amount and plan type; this calculation supports exactly one self-employed plan');
  const employee = money(facts.employeeContribution, 'employee elective contributions');
  const employer = money(facts.employerContribution, 'employer contributions');
  const total = round(input.sep + input.solo + input.simple);
  if (Math.abs(employee + employer - total) > .005) review('Employee and employer contributions must reconcile to the saved retirement contribution total');
  const net = Math.max(0, input.netProfit - input.halfSE);
  const limits = input.taxYear === 2026 ? { annual: 72000, deferral: 24500, compensation: 360000, simple: 17000 }
    : { annual: 70000, deferral: 23500, compensation: 350000, simple: 16500 };
  let employerLimit = 0, employeeLimit = 0;
  if (facts.plan === 'simple_ira') {
    const compensation = Math.max(0, input.netProfit) * .9235;
    employeeLimit = Math.min(limits.simple, compensation);
    if (!['match3', 'nonelective2'].includes(facts.simpleMethod ?? '')) review('Select the SIMPLE plan’s standard 3% matching or 2% nonelective method; reduced, enhanced or additional contributions need review');
    employerLimit = round(facts.simpleMethod === 'match3' ? Math.min(employee, compensation * .03) : Math.min(compensation, limits.compensation) * .02);
    if (Math.abs(employer - employerLimit) > .01) review(`Reconcile the SIMPLE employer contribution to the selected method ($${employerLimit.toFixed(2)}). Enhanced/reduced contribution options need plan review`);
  } else {
    const rate = money(facts.employerRate, 'the plan’s stated employer contribution percentage');
    if (rate > 25) review('The plan contribution percentage must be at most 25% for this supported SEP/defined-contribution worksheet');
    const fraction = rate / 100;
    employerLimit = Math.min(net * fraction / (1 + fraction), limits.compensation * fraction, limits.annual);
    if (facts.plan === 'sep_ira') {
      if (employee !== 0) review('A standard SEP contribution is an employer contribution; SARSEP salary deferrals need separate review');
    } else {
      employeeLimit = Math.min(limits.deferral, net);
      employerLimit = Math.min(employerLimit, Math.max(0, limits.annual - employee), Math.max(0, (net - employee) / 2));
    }
  }
  if (employee > round(employeeLimit) + .005 || employer > round(employerLimit) + .005) review(`Retirement contributions exceed a supported plan or earned-income limit (employee $${round(employeeLimit).toFixed(2)}; employer $${round(employerLimit).toFixed(2)}). Review excess contributions before using a deduction`);
  return { deduction: total, employeeLimit: round(employeeLimit), employerLimit: round(employerLimit), method: facts.plan };
}

/** Form 7206, one Schedule C business, non-Marketplace medical/dental/vision premiums. */
export function calculateEligibleHealth(input: { premiums: number; netProfit: number; halfSE: number; retirement: number }, facts?: EligibilityFacts['health']) {
  if (!facts) return review('Complete self-employed health-insurance eligibility: monthly premiums, employer-plan access, business policy and premium-tax-credit coordination in Tax Organizer');
  for (const [key, message] of [
    ['soleProprietor', 'Confirm this is one sole-proprietor or disregarded single-member LLC business, not a partnership or corporation'],
    ['policyUnderBusiness', 'Confirm the policy is established under this sole-proprietor business (in your name or the business name)'],
    ['coveredPeopleEligible', 'Confirm covered people are yourself, your spouse, dependents, or your child under age 27 at year end'],
    ['nonMarketplace', 'Marketplace premiums require Form 8962 / Publication 974 premium-tax-credit coordination before this deduction'],
    ['noLongTermCare', 'Qualified long-term-care premiums require age-based limits and separate Form 7206 review'],
    ['noReimbursement', 'Exclude reimbursed, pre-tax, retired-public-safety-officer exclusions and amounts deducted elsewhere before this calculation'],
    ['oneBusiness', 'Multiple businesses, partnerships and S-corporation policies need separate Form 7206 worksheets'],
    ['noForeignIncomeExclusion', 'Foreign earned-income or housing exclusions require coordinated Form 7206 / Form 2555 review'],
  ] as const) yes(facts[key], message);
  const months = facts.months ?? review('Enter premiums and employer-plan eligibility for all 12 months');
  let total = 0, eligible = 0;
  for (const [index, month] of months.entries()) {
    const premium = money(month.premiums, `month ${index + 1} health-insurance premiums`);
    if (!['yes', 'no'].includes(month.employerAccess)) review(`Answer employer-subsidized health-plan eligibility for month ${index + 1}`);
    total += premium;
    if (month.employerAccess === 'no') eligible += premium;
  }
  if (Math.abs(total - input.premiums) > .005) review('Monthly health-insurance premiums must reconcile to the saved annual premium amount');
  const incomeLimit = Math.max(0, input.netProfit - input.halfSE - input.retirement);
  return { deduction: round(Math.min(eligible, incomeLimit)), eligiblePremiums: round(eligible), excludedEmployerMonths: round(total - eligible), incomeLimit: round(incomeLimit) };
}

export interface AdjustmentClaims { hsaContribution: number; healthInsurancePremiums: number; sepIraContribution: number; solo401kContribution: number; simpleIraContribution: number }
export function calculateEligibleAdjustments(input: AdjustmentClaims & { taxYear: number; filingStatus: string; netProfit: number; halfSE: number; organizer?: Record<string, unknown> }) {
  const values = [input.hsaContribution, input.healthInsurancePremiums, input.sepIraContribution, input.solo401kContribution, input.simpleIraContribution];
  if (values.some(value => !Number.isFinite(value) || value < 0)) review('Contribution and premium amounts must be finite and nonnegative; reconcile signed or invalid entries');
  if (!Number.isFinite(input.netProfit) || !Number.isFinite(input.halfSE) || input.halfSE < 0) review('Business profit and the deductible half of self-employment tax must be valid before applying deduction limits');
  const facts = factsForYear(input.organizer, input.taxYear);
  const retirementAmount = input.sepIraContribution + input.solo401kContribution + input.simpleIraContribution;
  // A zero deduction claim does not erase contribution records or their potential
  // excess-contribution tax. Validate known funding and reconcile declared totals.
  const retirementRecorded = Number(facts?.retirement?.employeeContribution) > 0 || Number(facts?.retirement?.employerContribution) > 0;
  const hsaRecorded = Number(facts?.hsa?.employerContributions) > 0 || Number(facts?.hsa?.otherReductions) > 0 || facts?.hsa?.noDistributionsOrPriorExcess === 'no';
  const healthRecorded = facts?.health?.months?.some(month => Number(month.premiums) > 0);
  const retirement = retirementAmount > 0 || retirementRecorded ? calculateEligibleRetirement({ taxYear: input.taxYear, netProfit: input.netProfit, halfSE: input.halfSE, sep: input.sepIraContribution, solo: input.solo401kContribution, simple: input.simpleIraContribution }, facts?.retirement) : null;
  const hsa = input.hsaContribution > 0 || hsaRecorded ? calculateEligibleHSA(input.taxYear, input.filingStatus, input.hsaContribution, facts?.hsa) : null;
  const health = input.healthInsurancePremiums > 0 || healthRecorded ? calculateEligibleHealth({ premiums: input.healthInsurancePremiums, netProfit: input.netProfit, halfSE: input.halfSE, retirement: retirement?.deduction ?? 0 }, facts?.health) : null;
  return { hsa, health, retirement, hsaDeduction: hsa?.deduction ?? 0, healthInsuranceDeduction: health?.deduction ?? 0, retirementDeduction: retirement?.deduction ?? 0 };
}

/** The wage base is per spouse. Compare every assigned total with current saved W-2 records. */
export function resolveJointWageOwnership(input: { taxYear: number; organizer?: Record<string, unknown>; wages: number; ssWages: number; medicareWages?: number }) {
  const facts = factsForYear(input.organizer, input.taxYear)?.joint;
  if (!facts) return review('A joint return with W-2 wages and business profit requires wages to be assigned to the spouse who earned them in Tax Organizer');
  yes(facts.oneSelfEmployedSpouse, 'Two self-employed spouses, a jointly operated business or a qualified joint venture need separate Schedule C/SE calculations');
  if (!['taxpayer', 'spouse'].includes(facts.businessOwner ?? '')) review('Identify which spouse earned all of the recorded self-employment income');
  const taxpayer = { wages: money(facts.taxpayerWages, 'taxpayer W-2 Box 1 total'), ss: money(facts.taxpayerSSWages, 'taxpayer W-2 Boxes 3 + 7 total'), medicare: money(facts.taxpayerMedicareWages, 'taxpayer W-2 Box 5 total') };
  const spouse = { wages: money(facts.spouseWages, 'spouse W-2 Box 1 total'), ss: money(facts.spouseSSWages, 'spouse W-2 Boxes 3 + 7 total'), medicare: money(facts.spouseMedicareWages, 'spouse W-2 Box 5 total') };
  if (input.medicareWages === undefined || Math.abs(taxpayer.wages + spouse.wages - input.wages) > .005 || Math.abs(taxpayer.ss + spouse.ss - input.ssWages) > .005 || Math.abs(taxpayer.medicare + spouse.medicare - input.medicareWages) > .005) review('Spouse wage assignments must match the current W-2 Box 1, Boxes 3 + 7 and Box 5 totals. Complete missing boxes and review assignments after any W-2 change');
  return { businessOwner: facts.businessOwner!, ownerSocialSecurityWages: facts.businessOwner === 'taxpayer' ? taxpayer.ss : spouse.ss, combinedMedicareWages: taxpayer.medicare + spouse.medicare };
}
