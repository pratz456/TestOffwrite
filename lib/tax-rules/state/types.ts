import type { FederalFilingStatus } from '../federal-year-rules';

/** The engine reuses the four federal statuses; state-specific statuses are not supported. */
export type StateFilingStatus = FederalFilingStatus;

/** Tax years the state registry is allowed to describe. 2027 is intentionally absent. */
export const STATE_REGISTRY_TAX_YEARS = [2025, 2026] as const;
export type StateRegistryTaxYear = typeof STATE_REGISTRY_TAX_YEARS[number];

/**
 * One row of a published "over / but not over / base plus rate of the excess" schedule.
 * `base` is transcribed from the department schedule rather than derived, so published
 * rounding (New York) and discontinuities (Ohio) are reproduced as printed.
 */
export interface RateScheduleSegment {
  over: number;
  base: number;
  rate: number;
}

export type RateSchedule = readonly RateScheduleSegment[];

export interface StateSource {
  /** Primary department of revenue / statute URL. */
  url: string;
  /** What the source establishes, including the effective tax year. */
  note: string;
}

interface StateYearRulesBase {
  stateCode: string;
  taxYear: StateRegistryTaxYear;
  reviewedAt: string;
  sources: readonly StateSource[];
  /** Freelancer-relevant items intentionally outside the estimate for this state-year. */
  unmodeled: readonly string[];
}

export interface NoIncomeTaxRules extends StateYearRulesBase {
  kind: 'no_income_tax';
  /** Informational statements shown with the $0 estimate (e.g. Washington B&O). */
  notes: readonly string[];
}

export interface AGIStepAmount {
  /** Applies while the measured income is at or below this amount. */
  agiUpTo: number;
  amount: number;
}

export interface FlatRateRules extends StateYearRulesBase {
  kind: 'flat';
  rate: number;
  /** Pennsylvania taxes the positive income classes, not federal AGI. */
  incomeBase: 'federal_agi' | 'pa_income_classes';
  /** Absent for states with no standard deduction (Pennsylvania, Illinois). */
  standardDeduction?: Record<StateFilingStatus, number>;
  /** Georgia-style fixed amount per dependent. */
  dependentExemption?: number;
  /**
   * Illinois-style exemption allowance: amount per taxpayer/spouse/dependent, disallowed
   * entirely when federal AGI exceeds the filing-status threshold.
   */
  exemptionAllowance?: { amount: number; disallowedAboveAGI: Record<StateFilingStatus, number> };
  /** North Carolina child deduction, stepped down by federal AGI. */
  childDeductionByAGI?: Record<StateFilingStatus, readonly AGIStepAmount[]>;
}

export interface CaliforniaRules extends StateYearRulesBase {
  kind: 'california';
  schedules: Record<StateFilingStatus, RateSchedule>;
  standardDeduction: Record<StateFilingStatus, number>;
  personalExemptionCredit: number;
  dependentExemptionCredit: number;
  exemptionPhaseout: {
    agiThreshold: Record<StateFilingStatus, number>;
    /** AGI increment that triggers each reduction; married filing separately uses half. */
    increment: number;
    incrementMarriedSeparate: number;
    reductionPerIncrement: number;
  };
  /** Form 540 line 62: additional tax on taxable income above the threshold. */
  behavioralHealthServicesTax: { threshold: number; rate: number };
}

export interface NewYorkRecaptureWorksheet {
  /** Worksheet applies when taxable income is above this amount; the phase-in also measures NYAGI from here. */
  taxableIncomeOver: number;
  /** ...and at or below this amount. */
  taxableIncomeUpTo: number;
  /** Fixed recapture already earned by the lower brackets. */
  base: number;
  /** Additional recapture phased in over the next `phaseInWidth` of NYAGI. */
  incrementalBenefit: number;
}

export interface NewYorkRules extends StateYearRulesBase {
  kind: 'new_york';
  schedules: Record<StateFilingStatus, RateSchedule>;
  standardDeduction: Record<StateFilingStatus, number>;
  dependentExemption: number;
  /** NYAGI above which the tax computation worksheets replace the schedule. */
  recaptureAgiThreshold: number;
  /** NYAGI at which the first worksheet's flat rate applies in full. */
  recaptureFullAt: number;
  /** NYAGI span over which each recapture step phases in. */
  phaseInWidth: number;
  /** NYAGI above which all taxable income is taxed at the top rate. */
  topRateAgiOver: number;
  topRate: number;
  recapture: Record<StateFilingStatus, {
    /** Flat rate applied by the first worksheet when taxable income is at or below `flatRateUpTo`. */
    flatRate: number;
    flatRateUpTo: number;
    worksheets: readonly NewYorkRecaptureWorksheet[];
  }>;
}

export interface OhioRules extends StateYearRulesBase {
  kind: 'ohio';
  nonbusinessSchedule: RateSchedule;
  businessIncomeDeduction: { limit: number; limitMarriedSeparate: number; rateOnExcess: number };
  /** Personal and dependent exemption amount by modified adjusted gross income ceiling. */
  exemptionByMAGI: readonly AGIStepAmount[];
  /** $20 per exemption when MAGI less exemptions is below the ceiling. */
  exemptionCredit: { amount: number; magiLessExemptionsBelow: number };
}

export type StateYearRules = NoIncomeTaxRules | FlatRateRules | CaliforniaRules | NewYorkRules | OhioRules;

/** A state-year the department has not yet published or that this module does not encode. */
export interface UnsupportedStateYear {
  stateCode: string;
  taxYear: number;
  reason: string;
  sources?: readonly StateSource[];
}

export interface StateTaxEstimateInput {
  stateCode: string;
  taxYear: number;
  filingStatus: StateFilingStatus;
  /** Form 1040 line 11. */
  federalAGI: number;
  /** Schedule C net profit after depreciation; losses are treated as zero business income. */
  scheduleCNetProfit: number;
  /** W-2 Box 1 wages; the Pennsylvania compensation class. */
  w2Wages: number;
  /** Interest, dividends, taxable benefits and other income included in federal AGI. */
  otherIncome?: number;
  /** Federal Schedule 1 HSA deduction; California adds it back, Pennsylvania allows it. */
  hsaContribution?: number;
  /** Form 1040 line 6b; every encoded state excludes it from its own base. */
  taxableSocialSecurityBenefits?: number;
  /** Dependents claimed; 0 when eligibility has not been reviewed. */
  dependents?: number;
}

export interface StateTaxLine {
  label: string;
  amount: number;
}

export interface StateTaxComponents {
  federalAGI: number;
  /** Additions (positive) and subtractions (negative) applied between federal AGI and the state base. */
  modifications: StateTaxLine[];
  stateAGI: number;
  /** Standard deduction, exemptions and the Ohio business income deduction. */
  deductions: StateTaxLine[];
  taxableIncome: number;
  taxBeforeCredits: number;
  credits: StateTaxLine[];
  additionalTaxes: StateTaxLine[];
  /** Intermediate figures worth showing (Ohio business/nonbusiness split, New York recapture). */
  detail: StateTaxLine[];
  /** Rate on the last dollar of taxable income, as a percentage. */
  marginalRate: number;
  /** Estimate divided by federal AGI, as a percentage. */
  effectiveRate: number;
}

export const STATE_PLANNING_ESTIMATE_LABEL = 'informational state planning estimate' as const;

export interface SupportedStateTaxEstimate {
  supported: true;
  label: typeof STATE_PLANNING_ESTIMATE_LABEL;
  stateCode: string;
  stateName: string;
  taxYear: number;
  filingStatus: StateFilingStatus;
  /** True for states without an individual income tax; the estimate is $0. */
  noIncomeTax: boolean;
  estimate: number;
  components: StateTaxComponents;
  warnings: string[];
  notes: string[];
  sources: string[];
}

export interface UnsupportedStateTaxEstimate {
  supported: false;
  label: typeof STATE_PLANNING_ESTIMATE_LABEL;
  stateCode: string;
  stateName: string;
  taxYear: number;
  reason: string;
  sources: string[];
}

export type StateTaxEstimate = SupportedStateTaxEstimate | UnsupportedStateTaxEstimate;
