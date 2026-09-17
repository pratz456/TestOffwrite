/**
 * Published federal estimator parameters, reviewed September 15, 2026.
 * Annual parameters do not establish eligibility or validate a complete return.
 * 2027 is intentionally absent until the official annual figures are published.
 */
export const SUPPORTED_TAX_YEARS = [2024, 2025, 2026] as const;
export type SupportedTaxYear = typeof SUPPORTED_TAX_YEARS[number];
export type FederalFilingStatus = 'single' | 'married_filing_jointly' | 'married_filing_separately' | 'head_of_household';
export interface TaxBracket { min: number; max: number; rate: number }
export type TaxBrackets = Record<FederalFilingStatus, TaxBracket[]>;

export interface EITCParameters {
  maxCredit: number;
  phaseInRate: number;
  phaseOutRate: number;
  phaseOutStart: number;
  phaseOutStartMFJ: number;
  phaseOutEnd: number;
  phaseOutEndMFJ: number;
}

/**
 * §179(b)(1) dollar limit and §179(b)(2) phaseout threshold for the tax year.
 * Verified against the published revenue procedures on 2026-09-17:
 * - 2024: Rev. Proc. 2023-34 §3.25 ($1,220,000 / $3,050,000).
 * - 2025: Rev. Proc. 2024-40 §2.25 originally $1,250,000 / $3,130,000; OBBBA §70306
 *   (P.L. 119-21) raised them to $2,500,000 / $4,000,000 for tax years beginning after
 *   2024 — Rev. Proc. 2025-32 §2.10 and §3.02 (which removes §2.25 of Rev. Proc. 2024-40).
 * - 2026: Rev. Proc. 2025-32 §4.24 ($2,560,000 / $4,090,000).
 * The §179(b)(3) business-income limit is applied by the caller, not stored here.
 */
export interface Section179Limits {
  limit: number;
  phaseoutThreshold: number;
  source: string;
}

interface FederalTaxRules {
  taxYear: SupportedTaxYear;
  reviewedAt: string;
  sources: readonly string[];
  brackets: TaxBrackets;
  standardDeductions: Record<FederalFilingStatus, number>;
  socialSecurityWageBase: number;
  sepContributionLimit: number;
  childTaxCreditPerChild: number;
  refundableChildTaxCreditPerChild: number;
  eitcInvestmentIncomeLimit: number;
  eitc: Record<0 | 1 | 2 | 3, EITCParameters>;
  capitalGainsThresholds: Record<FederalFilingStatus, readonly [number, number]>;
  saltCap: number;
  saltPhaseoutStart: number;
  qbiThreshold: Record<FederalFilingStatus, number>;
  qbiPhaseInWidth: number;
  /**
   * §461(l)(3) excess business loss threshold: base amount, doubled for joint returns
   * (married filing separately and head of household use the base amount).
   * Made permanent by P.L. 119-21 §70601. Annual amounts below are the published figures.
   */
  excessBusinessLossThreshold: Record<FederalFilingStatus, number>;
  section179: Section179Limits;
}

const rates = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
function brackets(ends: number[]): TaxBracket[] {
  return [...ends, Infinity].map((max, index) => ({ min: index ? ends[index - 1] : 0, max, rate: rates[index] }));
}
function filingAmounts(single: number, joint: number, separate: number, head: number): Record<FederalFilingStatus, number> {
  return { single, married_filing_jointly: joint, married_filing_separately: separate, head_of_household: head };
}
function eitc(
  maxima: number[], starts: number[], startsMFJ: number[], ends: number[], endsMFJ: number[],
): Record<0 | 1 | 2 | 3, EITCParameters> {
  const phaseInRates = [0.0765, 0.34, 0.40, 0.45];
  const phaseOutRates = [0.0765, 0.1598, 0.2106, 0.2106];
  return Object.fromEntries(maxima.map((maxCredit, index) => [index, {
    maxCredit, phaseInRate: phaseInRates[index], phaseOutRate: phaseOutRates[index],
    phaseOutStart: starts[index], phaseOutStartMFJ: startsMFJ[index],
    phaseOutEnd: ends[index], phaseOutEndMFJ: endsMFJ[index],
  }])) as Record<0 | 1 | 2 | 3, EITCParameters>;
}

const sharedSources = [
  'https://www.irs.gov/instructions/i1040s8',
  'https://www.irs.gov/publications/p560',
  'https://www.irs.gov/instructions/i1040sca',
  'https://uscode.house.gov/view.xhtml?req=granuleid%3AUSC-prelim-title26-section164&num=0&edition=prelim',
  'https://www.ssa.gov/oact/COLA/cbb.html',
  'https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions',
] as const;

const rules: Record<SupportedTaxYear, FederalTaxRules> = {
  2024: {
    taxYear: 2024, reviewedAt: '2026-09-15',
    sources: ['https://www.irs.gov/pub/irs-drop/rp-23-34.pdf', ...sharedSources],
    brackets: {
      single: brackets([11600, 47150, 100525, 191950, 243725, 609350]),
      married_filing_jointly: brackets([23200, 94300, 201050, 383900, 487450, 731200]),
      married_filing_separately: brackets([11600, 47150, 100525, 191950, 243725, 365600]),
      head_of_household: brackets([16550, 63100, 100500, 191950, 243700, 609350]),
    },
    standardDeductions: filingAmounts(14600, 29200, 14600, 21900),
    socialSecurityWageBase: 168600, sepContributionLimit: 69000,
    childTaxCreditPerChild: 2000, refundableChildTaxCreditPerChild: 1700,
    eitcInvestmentIncomeLimit: 11600,
    eitc: eitc([632, 4213, 6960, 7830], [10330, 22720, 22720, 22720],
      [17250, 29640, 29640, 29640], [18591, 49084, 55768, 59899], [25511, 56004, 62688, 66819]),
    capitalGainsThresholds: {
      single: [47025, 518900], married_filing_jointly: [94050, 583750],
      married_filing_separately: [47025, 291850], head_of_household: [63000, 551350],
    },
    saltCap: 10000, saltPhaseoutStart: Infinity,
    qbiThreshold: filingAmounts(191950, 383900, 191950, 191950), qbiPhaseInWidth: 50000,
    // Instructions for Form 461 (2024): $305,000 ($610,000 joint). https://www.irs.gov/instructions/i461
    excessBusinessLossThreshold: filingAmounts(305000, 610000, 305000, 305000),
    section179: { limit: 1220000, phaseoutThreshold: 3050000, source: 'Rev. Proc. 2023-34 §3.25' },
  },
  2025: {
    taxYear: 2025, reviewedAt: '2026-09-15',
    sources: ['https://www.irs.gov/pub/irs-drop/rp-24-40.pdf', 'https://www.irs.gov/pub/irs-drop/rp-25-32.pdf', ...sharedSources],
    brackets: {
      single: brackets([11925, 48475, 103350, 197300, 250525, 626350]),
      married_filing_jointly: brackets([23850, 96950, 206700, 394600, 501050, 751600]),
      married_filing_separately: brackets([11925, 48475, 103350, 197300, 250525, 375800]),
      head_of_household: brackets([17000, 64850, 103350, 197300, 250500, 626350]),
    },
    // P.L. 119-21 amended the original Rev. Proc. 2024-40 basic deductions.
    standardDeductions: filingAmounts(15750, 31500, 15750, 23625),
    socialSecurityWageBase: 176100, sepContributionLimit: 70000,
    childTaxCreditPerChild: 2200, refundableChildTaxCreditPerChild: 1700,
    eitcInvestmentIncomeLimit: 11950,
    eitc: eitc([649, 4328, 7152, 8046], [10620, 23350, 23350, 23350],
      [17730, 30470, 30470, 30470], [19104, 50434, 57310, 61555], [26214, 57554, 64430, 68675]),
    capitalGainsThresholds: {
      single: [48350, 533400], married_filing_jointly: [96700, 600050],
      married_filing_separately: [48350, 300000], head_of_household: [64750, 566700],
    },
    saltCap: 40000, saltPhaseoutStart: 500000,
    qbiThreshold: filingAmounts(197300, 394600, 197300, 197300), qbiPhaseInWidth: 50000,
    // Rev. Proc. 2024-40 §2.32: $313,000 ($626,000 joint); Instructions for Form 461 (2025).
    excessBusinessLossThreshold: filingAmounts(313000, 626000, 313000, 313000),
    // Rev. Proc. 2024-40 §2.25 published $1,250,000 / $3,130,000 before OBBBA §70306.
    section179: { limit: 2500000, phaseoutThreshold: 4000000, source: 'OBBBA §70306 (P.L. 119-21); Rev. Proc. 2025-32 §2.10 and §3.02' },
  },
  2026: {
    taxYear: 2026, reviewedAt: '2026-09-15',
    sources: ['https://www.irs.gov/pub/irs-drop/rp-25-32.pdf', ...sharedSources],
    brackets: {
      single: brackets([12400, 50400, 105700, 201775, 256225, 640600]),
      married_filing_jointly: brackets([24800, 100800, 211400, 403550, 512450, 768700]),
      married_filing_separately: brackets([12400, 50400, 105700, 201775, 256225, 384350]),
      head_of_household: brackets([17700, 67450, 105700, 201750, 256200, 640600]),
    },
    standardDeductions: filingAmounts(16100, 32200, 16100, 24150),
    socialSecurityWageBase: 184500, sepContributionLimit: 72000,
    childTaxCreditPerChild: 2200, refundableChildTaxCreditPerChild: 1700,
    eitcInvestmentIncomeLimit: 12200,
    eitc: eitc([664, 4427, 7316, 8231], [10860, 23890, 23890, 23890],
      [18140, 31160, 31160, 31160], [19540, 51593, 58629, 62974], [26820, 58863, 65899, 70244]),
    capitalGainsThresholds: {
      single: [49450, 545500], married_filing_jointly: [98900, 613700],
      married_filing_separately: [49450, 306850], head_of_household: [66200, 579600],
    },
    saltCap: 40400, saltPhaseoutStart: 505000,
    qbiThreshold: filingAmounts(201750, 403500, 201775, 201750), qbiPhaseInWidth: 75000,
    // Rev. Proc. 2025-32 §4.31: $256,000 ($512,000 joint) after the P.L. 119-21 §70601 re-based indexing.
    excessBusinessLossThreshold: filingAmounts(256000, 512000, 256000, 256000),
    section179: { limit: 2560000, phaseoutThreshold: 4090000, source: 'Rev. Proc. 2025-32 §4.24' },
  },
};

export class UnsupportedTaxYearError extends RangeError {
  constructor(public readonly taxYear: number) {
    super(describeUnsupportedTaxYear(taxYear));
    this.name = 'UnsupportedTaxYearError';
  }
}

/** Latest year with a complete published parameter set. */
export const LATEST_PUBLISHED_TAX_YEAR: SupportedTaxYear = SUPPORTED_TAX_YEARS[SUPPORTED_TAX_YEARS.length - 1];

/**
 * Items already fixed by statute for 2027 (P.L. 119-21) versus items the IRS and SSA
 * publish each autumn. Reviewed September 17, 2026; update when Rev. Proc. 2026-xx issues.
 */
export const TAX_YEAR_2027_STATUS = Object.freeze({
  taxYear: 2027,
  reviewedAt: '2026-09-17',
  knownByStatute: [
    'Ordinary rates 10%–37% are permanent; bracket dollar amounts are pending inflation adjustment.',
    'Qualified tips deduction: up to $25,000, MAGI phaseout from $150,000 ($300,000 joint); self-employed limited to business net income.',
    'Qualified overtime deduction: up to $12,500 ($25,000 joint), same MAGI phaseout; generally unavailable to independent contractors.',
    'Passenger vehicle loan interest: up to $10,000, MAGI phaseout from $100,000 ($200,000 joint), personal-use U.S.-assembled new vehicles only.',
    'Enhanced senior deduction: $6,000 per eligible individual, 6% phaseout above $75,000 ($150,000 joint).',
    'SALT cap: $40,804 with phase-down above $510,050 MAGI (101% statutory escalator), floor $10,000.',
    'QBI deduction permanent at 20%; phase-in range $75,000 ($150,000 joint); $400 minimum deduction indexed after 2026.',
    'Form 1099-K threshold: more than $20,000 and more than 200 transactions.',
    'Additional Medicare and NIIT thresholds: $200,000 / $250,000 / $125,000 (not indexed).',
    'Estimated tax safe harbors: 90% current year, 100% prior year, 110% if prior AGI over $150,000 ($75,000 MFS).',
    'HSA limits published: $4,500 self-only, $9,000 family (Rev. Proc. 2026-24).',
  ],
  pendingPublication: [
    { item: 'Ordinary income bracket amounts', expected: 'IRS revenue procedure, typically October–November 2026' },
    { item: 'Standard deduction (basic, additional age/blindness, dependent limit)', expected: 'IRS revenue procedure, typically October–November 2026' },
    { item: 'Long-term capital gain 0% and 15% thresholds', expected: 'IRS revenue procedure, typically October–November 2026' },
    { item: 'Child Tax Credit maximum and refundable amount', expected: 'IRS revenue procedure, typically October–November 2026' },
    { item: 'EITC table and investment income limit', expected: 'IRS revenue procedure, typically October–November 2026' },
    { item: 'QBI threshold amounts and indexed $400/$1,000 minimum-deduction figures', expected: 'IRS revenue procedure, typically October–November 2026' },
    { item: 'Form 1099-NEC/MISC reporting threshold (first indexing year)', expected: 'IRS revenue procedure, typically October–November 2026' },
    { item: 'Social Security wage base and quarter of coverage', expected: 'SSA announcement expected mid-October 2026' },
    { item: 'Section 179 limits and retirement plan contribution limits', expected: 'IRS notices, typically October–November 2026' },
    { item: 'Standard mileage rate', expected: 'IRS notice, typically December 2026' },
    { item: 'Underpayment interest rate for Q1 2027', expected: 'IRS news release, late November–early December 2026' },
  ],
  sources: [
    'https://www.govinfo.gov/content/pkg/PLAW-119publ21/html/PLAW-119publ21.htm',
    'https://www.irs.gov/pub/irs-drop/rp-25-32.pdf',
    'https://www.irs.gov/pub/irs-drop/rp-26-24.pdf',
    'https://www.irs.gov/newsroom/working-families-tax-cuts-individuals-and-workers',
  ],
});

export function describeUnsupportedTaxYear(taxYear: number): string {
  if (taxYear === TAX_YEAR_2027_STATUS.taxYear) {
    return `Tax year 2027 estimates are not available yet: the IRS and SSA have not published the 2027 bracket, standard deduction, credit and wage-base amounts (expected October–November 2026). Rules already fixed by law for 2027 are listed in the tax year status, and 2024–2026 estimates remain available.`;
  }
  return `Tax year ${taxYear} is not supported. Published rules are available for 2024, 2025 and 2026.`;
}

export function getFederalTaxRules(taxYear: number): FederalTaxRules {
  if (!SUPPORTED_TAX_YEARS.includes(taxYear as SupportedTaxYear)) throw new UnsupportedTaxYearError(taxYear);
  return rules[taxYear as SupportedTaxYear];
}

/** §179 dollar limits for a published year; 2027 stays unsupported until its revenue procedure issues. */
export function getSection179Limits(taxYear: number): Section179Limits {
  return getFederalTaxRules(taxYear).section179;
}

/** Rates for display helpers: the requested year when published, otherwise the latest published year. */
export function nearestPublishedTaxYear(taxYear: number): SupportedTaxYear {
  if (SUPPORTED_TAX_YEARS.includes(taxYear as SupportedTaxYear)) return taxYear as SupportedTaxYear;
  return taxYear > LATEST_PUBLISHED_TAX_YEAR ? LATEST_PUBLISHED_TAX_YEAR : SUPPORTED_TAX_YEARS[0];
}

/** Schedule A personal SALT only; caller supplies SALT MAGI, including applicable exclusions. */
export function calculateSALTLimit(taxYear: number, filingStatus: FederalFilingStatus, modifiedAGI: number): number {
  const year = getFederalTaxRules(taxYear);
  const separate = filingStatus === 'married_filing_separately';
  const cap = year.saltCap;
  const threshold = year.saltPhaseoutStart / (separate ? 2 : 1);
  // Schedule A worksheet: use half the MAGI threshold for MFS, then halve
  // the final limitation. Halving the cap before applying 30% is incorrect.
  return Math.max(10000, cap - Math.max(0, modifiedAGI - threshold) * 0.30) / (separate ? 2 : 1);
}
