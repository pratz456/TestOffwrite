import { getStateYearRules, isSupportedStateYear, stateName } from './registry';
import {
  STATE_PLANNING_ESTIMATE_LABEL,
  type AGIStepAmount,
  type CaliforniaRules,
  type FlatRateRules,
  type NewYorkRules,
  type NoIncomeTaxRules,
  type OhioRules,
  type RateSchedule,
  type RateScheduleSegment,
  type StateFilingStatus,
  type StateTaxComponents,
  type StateTaxEstimate,
  type StateTaxEstimateInput,
  type StateTaxLine,
  type StateYearRules,
  type SupportedStateTaxEstimate,
} from './types';

const FILING_STATUSES: readonly StateFilingStatus[] = ['single', 'married_filing_jointly', 'married_filing_separately', 'head_of_household'];

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const nonNegative = (value: number | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
const sum = (lines: StateTaxLine[]) => lines.reduce((total, line) => total + line.amount, 0);

interface Facts {
  filingStatus: StateFilingStatus;
  federalAGI: number;
  scheduleCNetProfit: number;
  w2Wages: number;
  otherIncome: number;
  hsaContribution: number;
  socialSecurity: number;
  dependents: number;
  /** Taxpayer plus spouse on a joint return. */
  personalExemptions: number;
}

interface Computation {
  modifications: StateTaxLine[];
  stateAGI: number;
  deductions: StateTaxLine[];
  taxableIncome: number;
  taxBeforeCredits: number;
  credits: StateTaxLine[];
  additionalTaxes: StateTaxLine[];
  detail: StateTaxLine[];
  marginalRate: number;
  warnings: string[];
  notes?: string[];
}

function segmentFor(schedule: RateSchedule, income: number): RateScheduleSegment {
  let segment = schedule[0];
  for (const candidate of schedule) if (income > candidate.over) segment = candidate;
  return segment;
}

/** Published "base plus rate of the excess" computation; the base is transcribed, not derived. */
export function scheduleTax(schedule: RateSchedule, income: number): number {
  if (income <= 0) return 0;
  const segment = segmentFor(schedule, income);
  return segment.base + segment.rate * (income - segment.over);
}

function scheduleMarginalRate(schedule: RateSchedule, income: number): number {
  return income > 0 ? segmentFor(schedule, income).rate : 0;
}

function stepAmount(steps: readonly AGIStepAmount[], measure: number): number {
  for (const step of steps) if (measure <= step.agiUpTo) return step.amount;
  return 0;
}

function socialSecurityLine(facts: Facts, label = 'Social Security benefits excluded from state income'): StateTaxLine[] {
  return facts.socialSecurity > 0 ? [{ label, amount: -Math.min(facts.socialSecurity, facts.federalAGI) }] : [];
}

/**
 * Informational state planning estimate for a supported state-year, or an explicit
 * unsupported result. Never guesses a figure the department has not published.
 */
export function estimateStateTax(input: StateTaxEstimateInput): StateTaxEstimate {
  const rules = getStateYearRules(input.stateCode, input.taxYear);
  const name = rules.stateCode ? stateName(rules.stateCode) : (typeof input.stateCode === 'string' && input.stateCode.trim()) || 'Not set';
  if (!isSupportedStateYear(rules)) {
    return {
      supported: false, label: STATE_PLANNING_ESTIMATE_LABEL, stateCode: rules.stateCode, stateName: name,
      taxYear: input.taxYear, reason: rules.reason, sources: (rules.sources ?? []).map(source => source.url),
    };
  }
  if (!FILING_STATUSES.includes(input.filingStatus)) {
    return {
      supported: false, label: STATE_PLANNING_ESTIMATE_LABEL, stateCode: rules.stateCode, stateName: name, taxYear: input.taxYear,
      reason: 'The filing status must be one of single, married filing jointly, married filing separately or head of household before a state planning estimate is produced.',
      sources: rules.sources.map(source => source.url),
    };
  }
  const unsupportedAmount = [
    input.federalAGI,
    input.scheduleCNetProfit,
    input.w2Wages,
    input.otherIncome,
    input.hsaContribution,
    input.taxableSocialSecurityBenefits,
    input.dependents,
  ].some(value => value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)));
  if (unsupportedAmount || (input.federalAGI ?? 0) < 0 || (input.scheduleCNetProfit ?? 0) < 0
      || [input.w2Wages, input.otherIncome, input.hsaContribution, input.taxableSocialSecurityBenefits, input.dependents]
        .some(value => typeof value === 'number' && value < 0)) {
    return {
      supported: false,
      label: STATE_PLANNING_ESTIMATE_LABEL,
      stateCode: rules.stateCode,
      stateName: name,
      taxYear: input.taxYear,
      reason: 'This state calculator does not model negative AGI, business losses, negative income fields or nonfinite amounts. Review the state return with a qualified preparer.',
      sources: rules.sources.map(source => source.url),
    };
  }

  const facts: Facts = {
    filingStatus: input.filingStatus,
    federalAGI: nonNegative(input.federalAGI),
    scheduleCNetProfit: nonNegative(input.scheduleCNetProfit),
    w2Wages: nonNegative(input.w2Wages),
    otherIncome: nonNegative(input.otherIncome),
    hsaContribution: nonNegative(input.hsaContribution),
    socialSecurity: nonNegative(input.taxableSocialSecurityBenefits),
    dependents: Math.floor(nonNegative(input.dependents)),
    personalExemptions: input.filingStatus === 'married_filing_jointly' ? 2 : 1,
  };
  const computation = compute(rules, facts);
  const warnings = [...rules.unmodeled, ...computation.warnings];
  const estimate = round2(Math.max(0,
    computation.taxBeforeCredits - sum(computation.credits) + sum(computation.additionalTaxes),
  ));
  const components: StateTaxComponents = {
    federalAGI: round2(facts.federalAGI),
    modifications: computation.modifications.map(roundLine),
    stateAGI: round2(computation.stateAGI),
    deductions: computation.deductions.map(roundLine),
    taxableIncome: round2(computation.taxableIncome),
    taxBeforeCredits: round2(computation.taxBeforeCredits),
    credits: computation.credits.map(roundLine),
    additionalTaxes: computation.additionalTaxes.map(roundLine),
    detail: computation.detail.map(roundLine),
    marginalRate: round2(computation.marginalRate * 100),
    effectiveRate: facts.federalAGI > 0 ? round2((estimate / facts.federalAGI) * 100) : 0,
  };
  const result: SupportedStateTaxEstimate = {
    supported: true, label: STATE_PLANNING_ESTIMATE_LABEL, stateCode: rules.stateCode, stateName: name,
    taxYear: rules.taxYear, filingStatus: facts.filingStatus, noIncomeTax: rules.kind === 'no_income_tax',
    estimate, components, warnings: [...new Set(warnings)], notes: computation.notes ?? [],
    sources: rules.sources.map(source => source.url),
  };
  return result;
}

function roundLine(line: StateTaxLine): StateTaxLine {
  return { label: line.label, amount: round2(line.amount) };
}

function compute(rules: StateYearRules, facts: Facts): Computation {
  switch (rules.kind) {
    case 'no_income_tax': return noIncomeTax(rules, facts);
    case 'flat': return rules.incomeBase === 'pa_income_classes' ? pennsylvaniaClasses(rules, facts) : flatOnFederalAGI(rules, facts);
    case 'california': return california(rules, facts);
    case 'new_york': return newYork(rules, facts);
    case 'ohio': return ohio(rules, facts);
  }
}

function noIncomeTax(rules: NoIncomeTaxRules, facts: Facts): Computation {
  return {
    modifications: [], stateAGI: facts.federalAGI, deductions: [], taxableIncome: 0, taxBeforeCredits: 0,
    credits: [], additionalTaxes: [], detail: [], marginalRate: 0, warnings: [], notes: [...rules.notes],
  };
}

function flatOnFederalAGI(rules: FlatRateRules, facts: Facts): Computation {
  const warnings: string[] = [];
  const modifications = socialSecurityLine(facts);
  const stateAGI = Math.max(0, facts.federalAGI + sum(modifications));
  const deductions: StateTaxLine[] = [];
  const name = stateName(rules.stateCode);
  if (rules.standardDeduction) {
    deductions.push({ label: `${name} standard deduction`, amount: rules.standardDeduction[facts.filingStatus] });
  }
  if (rules.exemptionAllowance) {
    const count = facts.personalExemptions + facts.dependents;
    if (facts.federalAGI > rules.exemptionAllowance.disallowedAboveAGI[facts.filingStatus]) {
      deductions.push({ label: `${name} exemption allowance (not allowed above ${money(rules.exemptionAllowance.disallowedAboveAGI[facts.filingStatus])} federal AGI)`, amount: 0 });
    } else {
      deductions.push({ label: `${name} exemption allowance (${count} × ${money(rules.exemptionAllowance.amount)})`, amount: count * rules.exemptionAllowance.amount });
    }
  }
  if (rules.dependentExemption && facts.dependents > 0) {
    deductions.push({ label: `Dependent exemption (${facts.dependents} × ${money(rules.dependentExemption)})`, amount: facts.dependents * rules.dependentExemption });
  }
  if (rules.childDeductionByAGI && facts.dependents > 0) {
    const perChild = stepAmount(rules.childDeductionByAGI[facts.filingStatus], facts.federalAGI);
    deductions.push({ label: `Child deduction (${facts.dependents} × ${money(perChild)})`, amount: facts.dependents * perChild });
  }
  const taxableIncome = Math.max(0, stateAGI - sum(deductions));
  return {
    modifications, stateAGI, deductions, taxableIncome,
    taxBeforeCredits: taxableIncome * rules.rate, credits: [], additionalTaxes: [], detail: [],
    marginalRate: taxableIncome > 0 ? rules.rate : 0, warnings,
  };
}

function pennsylvaniaClasses(rules: FlatRateRules, facts: Facts): Computation {
  const compensation = facts.w2Wages;
  const netProfits = facts.scheduleCNetProfit;
  const otherClasses = Math.max(0, facts.otherIncome - facts.socialSecurity);
  const classesTotal = compensation + netProfits + otherClasses;
  const detail: StateTaxLine[] = [
    { label: 'Compensation (W-2 wages)', amount: compensation },
    { label: 'Net profits from business (Schedule C profit)', amount: netProfits },
    { label: 'Interest, dividends and other positive classes', amount: otherClasses },
  ];
  const deductions: StateTaxLine[] = facts.hsaContribution > 0
    ? [{ label: 'Health savings account contributions', amount: Math.min(facts.hsaContribution, classesTotal) }]
    : [];
  const taxableIncome = Math.max(0, classesTotal - sum(deductions));
  return {
    modifications: [{ label: 'Pennsylvania income classes replace federal AGI', amount: classesTotal - facts.federalAGI }],
    stateAGI: classesTotal, deductions, taxableIncome,
    taxBeforeCredits: taxableIncome * rules.rate, credits: [], additionalTaxes: [], detail,
    marginalRate: taxableIncome > 0 ? rules.rate : 0, warnings: [],
  };
}

function california(rules: CaliforniaRules, facts: Facts): Computation {
  const warnings: string[] = [];
  const modifications: StateTaxLine[] = [
    ...(facts.hsaContribution > 0 ? [{ label: 'HSA deduction added back (California does not conform)', amount: facts.hsaContribution }] : []),
    ...socialSecurityLine(facts),
  ];
  const stateAGI = Math.max(0, facts.federalAGI + sum(modifications));
  const deductions: StateTaxLine[] = [{ label: 'California standard deduction', amount: rules.standardDeduction[facts.filingStatus] }];
  const taxableIncome = Math.max(0, stateAGI - sum(deductions));
  const schedule = rules.schedules[facts.filingStatus];
  const taxBeforeCredits = scheduleTax(schedule, taxableIncome);

  // Form 540 line 32 AGI Limitation Worksheet: $6 per $2,500 ($1,250 separate) of federal AGI
  // above the threshold, rounded up, applied per exemption.
  const threshold = rules.exemptionPhaseout.agiThreshold[facts.filingStatus];
  const increment = facts.filingStatus === 'married_filing_separately' ? rules.exemptionPhaseout.incrementMarriedSeparate : rules.exemptionPhaseout.increment;
  const reductionPerExemption = facts.federalAGI > threshold
    ? Math.ceil((facts.federalAGI - threshold) / increment) * rules.exemptionPhaseout.reductionPerIncrement
    : 0;
  if (reductionPerExemption > 0) warnings.push(`California exemption credits are reduced because federal AGI exceeds ${money(threshold)}.`);
  const personalCredit = Math.max(0, facts.personalExemptions * (rules.personalExemptionCredit - reductionPerExemption));
  const dependentCredit = Math.max(0, facts.dependents * (rules.dependentExemptionCredit - reductionPerExemption));
  const credits: StateTaxLine[] = [
    { label: `Personal exemption credit (${facts.personalExemptions} × ${money(rules.personalExemptionCredit)})`, amount: Math.min(personalCredit, taxBeforeCredits) },
  ];
  if (facts.dependents > 0) {
    credits.push({ label: `Dependent exemption credit (${facts.dependents} × ${money(rules.dependentExemptionCredit)})`, amount: Math.min(dependentCredit, Math.max(0, taxBeforeCredits - credits[0].amount)) });
  }

  const bhst = rules.behavioralHealthServicesTax;
  const additionalTaxes: StateTaxLine[] = taxableIncome > bhst.threshold
    ? [{ label: `Behavioral Health Services Tax (${bhst.rate * 100}% of taxable income over ${money(bhst.threshold)})`, amount: (taxableIncome - bhst.threshold) * bhst.rate }]
    : [];
  return {
    modifications, stateAGI, deductions, taxableIncome, taxBeforeCredits, credits, additionalTaxes, detail: [],
    marginalRate: scheduleMarginalRate(schedule, taxableIncome) + (taxableIncome > bhst.threshold ? bhst.rate : 0),
    warnings,
  };
}

function newYork(rules: NewYorkRules, facts: Facts): Computation {
  const modifications = socialSecurityLine(facts);
  const nyAGI = Math.max(0, facts.federalAGI + sum(modifications));
  const deductions: StateTaxLine[] = [{ label: 'New York standard deduction', amount: rules.standardDeduction[facts.filingStatus] }];
  if (facts.dependents > 0) deductions.push({ label: `Dependent exemptions (${facts.dependents} × ${money(rules.dependentExemption)})`, amount: facts.dependents * rules.dependentExemption });
  const taxableIncome = Math.max(0, nyAGI - sum(deductions));
  const schedule = rules.schedules[facts.filingStatus];
  const fromSchedule = scheduleTax(schedule, taxableIncome);
  const detail: StateTaxLine[] = [{ label: 'Tax from New York State rate schedule', amount: fromSchedule }];
  let tax = fromSchedule;
  let marginalRate = scheduleMarginalRate(schedule, taxableIncome);

  if (nyAGI > rules.topRateAgiOver) {
    // Worksheets 6/11/16: the entire taxable income is taxed at the top rate.
    tax = taxableIncome * rules.topRate;
    marginalRate = rules.topRate;
    detail.push({ label: `Tax benefit recapture (NYAGI over ${money(rules.topRateAgiOver)})`, amount: tax - fromSchedule });
  } else if (nyAGI > rules.recaptureAgiThreshold && taxableIncome > 0) {
    const recapture = rules.recapture[facts.filingStatus];
    if (taxableIncome <= recapture.flatRateUpTo) {
      // Worksheets 1/7/12: phase from the schedule to a flat rate over $50,000 of NYAGI.
      const flat = taxableIncome * recapture.flatRate;
      const fraction = nyAGI >= rules.recaptureFullAt ? 1 : round4((nyAGI - rules.recaptureAgiThreshold) / rules.phaseInWidth);
      tax = fromSchedule + (flat - fromSchedule) * fraction;
      marginalRate = Math.max(marginalRate, recapture.flatRate * fraction + marginalRate * (1 - fraction));
    } else {
      // Worksheets 2–5, 8–10, 13–15: schedule tax plus the printed base and phased incremental benefit.
      const worksheet = recapture.worksheets.find(candidate => taxableIncome > candidate.taxableIncomeOver && taxableIncome <= candidate.taxableIncomeUpTo);
      if (worksheet) {
        const excess = Math.min(Math.max(0, nyAGI - worksheet.taxableIncomeOver), rules.phaseInWidth);
        tax = fromSchedule + worksheet.base + worksheet.incrementalBenefit * round4(excess / rules.phaseInWidth);
      }
    }
    detail.push({ label: `Tax benefit recapture (NYAGI over ${money(rules.recaptureAgiThreshold)})`, amount: tax - fromSchedule });
  }
  return {
    modifications, stateAGI: nyAGI, deductions, taxableIncome, taxBeforeCredits: tax,
    credits: [], additionalTaxes: [], detail, marginalRate, warnings: [],
  };
}

function ohio(rules: OhioRules, facts: Facts): Computation {
  const warnings: string[] = [];
  const bidLimit = facts.filingStatus === 'married_filing_separately' ? rules.businessIncomeDeduction.limitMarriedSeparate : rules.businessIncomeDeduction.limit;
  const businessIncome = facts.scheduleCNetProfit;
  const businessIncomeDeduction = Math.min(businessIncome, bidLimit);
  const modifications: StateTaxLine[] = [
    ...(businessIncomeDeduction > 0 ? [{ label: `Business income deduction (first ${money(bidLimit)} of Schedule C profit)`, amount: -businessIncomeDeduction }] : []),
    ...socialSecurityLine(facts, 'Taxable Social Security benefits deducted'),
  ];
  const ohioAGI = Math.max(0, facts.federalAGI + sum(modifications));
  // Exemptions are measured on modified AGI, which adds the business income deduction back.
  const modifiedAGI = ohioAGI + businessIncomeDeduction;
  const exemptionCount = facts.personalExemptions + facts.dependents;
  const exemptionAmount = stepAmount(rules.exemptionByMAGI, modifiedAGI);
  const deductions: StateTaxLine[] = [{ label: `Personal and dependent exemptions (${exemptionCount} × ${money(exemptionAmount)})`, amount: exemptionCount * exemptionAmount }];
  const taxableIncome = Math.max(0, ohioAGI - sum(deductions));
  const taxableBusinessIncome = Math.min(Math.max(0, businessIncome - businessIncomeDeduction), taxableIncome);
  const taxableNonbusinessIncome = taxableIncome - taxableBusinessIncome;
  const nonbusinessTax = scheduleTax(rules.nonbusinessSchedule, taxableNonbusinessIncome);
  const businessTax = taxableBusinessIncome * rules.businessIncomeDeduction.rateOnExcess;
  const credits: StateTaxLine[] = [];
  if (modifiedAGI - sum(deductions) < rules.exemptionCredit.magiLessExemptionsBelow) {
    credits.push({ label: `Exemption credit (${exemptionCount} × ${money(rules.exemptionCredit.amount)})`, amount: Math.min(exemptionCount * rules.exemptionCredit.amount, nonbusinessTax + businessTax) });
  }
  if (facts.filingStatus === 'married_filing_jointly' && nonbusinessTax + businessTax > 0) {
    warnings.push('The Ohio joint filing credit (5%–20% of tax when each spouse has at least $500 of qualifying income) is not modeled because spouse income is not separated.');
  }
  const detail: StateTaxLine[] = [
    { label: 'Taxable business income (Schedule C profit above the deduction)', amount: taxableBusinessIncome },
    { label: 'Taxable nonbusiness income', amount: taxableNonbusinessIncome },
    { label: 'Nonbusiness income tax (graduated schedule)', amount: nonbusinessTax },
    { label: `Business income tax (${rules.businessIncomeDeduction.rateOnExcess * 100}% flat)`, amount: businessTax },
  ];
  const marginalRate = taxableNonbusinessIncome > 0
    ? scheduleMarginalRate(rules.nonbusinessSchedule, taxableNonbusinessIncome)
    : taxableBusinessIncome > 0 ? rules.businessIncomeDeduction.rateOnExcess : 0;
  return {
    modifications, stateAGI: ohioAGI, deductions, taxableIncome, taxBeforeCredits: nonbusinessTax + businessTax,
    credits, additionalTaxes: [], detail, marginalRate, warnings,
  };
}
