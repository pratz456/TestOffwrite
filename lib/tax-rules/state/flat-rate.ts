import type { AGIStepAmount, FlatRateRules, StateFilingStatus, StateRegistryTaxYear, StateSource } from './types';

const REVIEWED_AT = '2026-09-17';

function byStatus(single: number, joint: number, separate: number, head: number): Record<StateFilingStatus, number> {
  return { single, married_filing_jointly: joint, married_filing_separately: separate, head_of_household: head };
}

function steps(...pairs: [number, number][]): AGIStepAmount[] {
  return pairs.map(([agiUpTo, amount]) => ({ agiUpTo, amount }));
}

// ── Illinois ─────────────────────────────────────────────────────────────────────
// 4.95% flat rate; no standard deduction. The exemption allowance is $2,850 for 2025 and
// $2,925 for 2026 per taxpayer/spouse/dependent, and is disallowed when federal AGI exceeds
// $500,000 (joint) / $250,000 (all others). Federally taxed Social Security is subtracted (IL-1040 line 5).
const IL_SOURCES: StateSource[] = [
  {
    url: 'https://tax.illinois.gov/questionsandanswers/answer.851.html',
    note: 'Illinois Department of Revenue answer 851: personal exemption allowance $2,850 for tax years beginning January 1, 2025 and $2,925 for tax years beginning January 1, 2026; no allowance when federal AGI exceeds $500,000 (married filing jointly) or $250,000 (all other returns).',
  },
  {
    url: 'https://tax.illinois.gov/content/dam/soi/en/web/tax/forms/incometax/documents/currentyear/individual/il-1040-instr.pdf',
    note: '2025 Form IL-1040 instructions: "The Illinois income tax rate is 4.95 percent (.0495)"; Step 4 exemption chart and income exceptions; Line 5 subtraction of federally taxed Social Security and retirement income.',
  },
];
const IL_UNMODELED = [
  'Illinois retirement-income subtraction (pensions, IRA distributions), other IL-1040 Schedule M additions/subtractions and the property tax, K-12 and earned income credits are not modeled.',
  'The additional $1,000 exemption for taxpayers 65 or older or legally blind is not modeled.',
];

function illinois(taxYear: StateRegistryTaxYear, exemption: number): FlatRateRules {
  return {
    kind: 'flat', stateCode: 'IL', taxYear, reviewedAt: REVIEWED_AT, rate: 0.0495, incomeBase: 'federal_agi',
    exemptionAllowance: { amount: exemption, disallowedAboveAGI: byStatus(250000, 500000, 250000, 250000) },
    sources: IL_SOURCES, unmodeled: IL_UNMODELED,
  };
}

// ── Pennsylvania ─────────────────────────────────────────────────────────────────
// 3.07% on eight separately computed income classes; no standard deduction or personal
// exemption; losses in one class cannot offset another class. Of the federal Schedule 1
// adjustments, only medical savings account, health savings account and 529 contributions
// are deductible.
const PA_SOURCES: StateSource[] = [
  {
    url: 'https://www.pa.gov/agencies/revenue/resources/tax-rates',
    note: 'Pennsylvania Department of Revenue current tax rates: Personal Income Tax 3.07 percent (unchanged through the 2025 and 2026 review dates).',
  },
  {
    url: 'https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/personal-income-tax',
    note: 'Pennsylvania Department of Revenue: eight classes of income; a loss in one class may not offset income in another class; no standard deduction or personal exemption; deductions allowed only for medical savings account, health savings account and IRC Section 529 contributions.',
  },
];
const PA_UNMODELED = [
  'Pennsylvania does not allow the federal deductions for one-half of self-employment tax, self-employed health insurance, SEP/SIMPLE/solo 401(k) contributions or student loan interest; none are applied here.',
  'Pennsylvania has no standard deduction, no personal exemption and no net operating loss carryover for individuals; a business loss cannot offset wages or other classes.',
  'Pennsylvania net-profit rules (depreciation, meals, start-up costs) can differ from federal Schedule C; the federal profit is used as the planning proxy.',
  'Tax Forgiveness (Schedule SP), local earned income taxes and the Philadelphia BIRT/NPT are not modeled.',
  'Interest, dividends, gains and other non-wage income are treated as one positive class in this estimate.',
];

function pennsylvania(taxYear: StateRegistryTaxYear): FlatRateRules {
  return {
    kind: 'flat', stateCode: 'PA', taxYear, reviewedAt: REVIEWED_AT, rate: 0.0307, incomeBase: 'pa_income_classes',
    sources: PA_SOURCES, unmodeled: PA_UNMODELED,
  };
}

// ── Georgia ──────────────────────────────────────────────────────────────────────
// 2025: flat 5.19%; standard deduction $12,000 ($24,000 joint); $4,000 per dependent.
// 2026: flat 4.99%; standard deduction $15,000 ($30,000 joint) per the department's
// 2026 income tax changes. The 2026 dependent exemption has not been published in a
// 2026 IT-511 booklet at review time and is therefore not applied for 2026.
const GA_SOURCES_2025: StateSource[] = [
  {
    // The earlier ".../document/booklet/..." path returned HTTP 404 on 2026-09-18; the
    // department publishes the booklet under ".../document/document/...".
    url: 'https://dor.georgia.gov/document/document/2025-it-511-individual-income-tax-booklet/download',
    note: '2025 Georgia IT-511 booklet: "the income tax rate is 5.19%"; standard deduction $24,000 married filing jointly, $12,000 single, married filing separately, head of household and qualifying surviving spouse; Form 500 line 14 dependent exemption $4,000 per dependent (IT-511 line 11 instructions: "Multiply Form 500, Line 7c by $4,000"); Schedule 1 line 8 subtracts the taxable portion of Social Security benefits.',
  },
];
const GA_SOURCES_2026: StateSource[] = [
  {
    url: 'https://dor.georgia.gov/taxes/important-tax-updates',
    note: 'Georgia Department of Revenue, 2026 Income Tax Changes: "The Georgia income tax rate has been reduced to a flat rate of 4.99%" and "the Georgia standard deduction has been increased to $15,000 for single taxpayers, heads of households, and married taxpayers filing separately, or $30,000 for married taxpayers filing jointly" (HB 463, effective January 1, 2026).',
  },
  ...GA_SOURCES_2025,
];
const GA_UNMODELED = [
  'Georgia retirement income exclusion, other Schedule 1 adjustments, itemized deductions and credits (including the one-time 2026 credit) are not modeled.',
];

function georgia(taxYear: StateRegistryTaxYear): FlatRateRules {
  return taxYear === 2025
    ? {
      kind: 'flat', stateCode: 'GA', taxYear, reviewedAt: REVIEWED_AT, rate: 0.0519, incomeBase: 'federal_agi',
      standardDeduction: byStatus(12000, 24000, 12000, 12000), dependentExemption: 4000,
      sources: GA_SOURCES_2025, unmodeled: GA_UNMODELED,
    }
    : {
      kind: 'flat', stateCode: 'GA', taxYear, reviewedAt: REVIEWED_AT, rate: 0.0499, incomeBase: 'federal_agi',
      standardDeduction: byStatus(15000, 30000, 15000, 15000),
      sources: GA_SOURCES_2026,
      unmodeled: [
        ...GA_UNMODELED,
        'The 2026 Georgia dependent exemption has not been published in a 2026 IT-511 booklet at review time; no dependent exemption is applied for 2026, so the estimate may be high for taxpayers with dependents.',
      ],
    };
}

// ── North Carolina ───────────────────────────────────────────────────────────────
// 4.25% for 2025 and 3.99% for taxable years after 2025 (S.L. 2023-134). Standard deduction
// $12,750 single/separate, $25,500 joint, $19,125 head of household in G.S. 105-153.5(a)(1),
// carried into the 2026 NC-30 withholding tables. Child deduction stepped by AGI, G.S. 105-153.5(a1).
const NC_SOURCES: StateSource[] = [
  {
    url: 'https://www.ncdor.gov/taxes-forms/individual-income-tax/tax-rate-schedules',
    note: 'NCDOR tax rate schedules: "For Taxable Years beginning in 2025, the North Carolina individual income tax rate is 4.25% (0.0425). For Taxable Years after 2025, the North Carolina individual income tax rate is 3.99% (0.0399)."',
  },
  {
    url: 'https://www.ncdor.gov/taxes-forms/individual-income-tax/north-carolina-standard-deduction-or-north-carolina-itemized-deductions',
    note: 'NCDOR standard deduction page (tax year 2025): Single $12,750; Married Filing Jointly/Surviving Spouse $25,500; Married Filing Separately $12,750; Head of Household $19,125.',
  },
  {
    url: 'https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/BySection/Chapter_105/GS_105-153.5.pdf',
    note: 'G.S. 105-153.5: (a)(1) standard deduction table; (a1) child deduction amount by filing status and AGI ($3,000 stepping down to $0); (b)(3) deduction for Title II Social Security benefits included in federal AGI.',
  },
];
const NC_SOURCES_2026: StateSource[] = [
  {
    url: 'https://www.ncdor.gov/income-tax-withholding-tables-and-instructions-employers/open',
    note: 'NC-30 (rev. 11-25), 2026 Income Tax Withholding Tables and Instructions for Employers: "the individual income tax rate for tax year 2026 will be 3.99%"; annualized computations use the N.C. standard deduction of $12,750 (single/married) and $19,125 (head of household).',
  },
  ...NC_SOURCES,
];
const NC_UNMODELED = [
  'North Carolina itemized deductions, other D-400 Schedule S additions/subtractions and credits are not modeled.',
  'The child deduction is applied per dependent on the assumption that each dependent is a qualifying child for the federal child tax credit.',
];
const NC_CHILD_DEDUCTION: Record<StateFilingStatus, readonly AGIStepAmount[]> = {
  married_filing_jointly: steps([40000, 3000], [60000, 2500], [80000, 2000], [100000, 1500], [120000, 1000], [140000, 500]),
  head_of_household: steps([30000, 3000], [45000, 2500], [60000, 2000], [75000, 1500], [90000, 1000], [105000, 500]),
  single: steps([20000, 3000], [30000, 2500], [40000, 2000], [50000, 1500], [60000, 1000], [70000, 500]),
  married_filing_separately: steps([20000, 3000], [30000, 2500], [40000, 2000], [50000, 1500], [60000, 1000], [70000, 500]),
};

function northCarolina(taxYear: StateRegistryTaxYear): FlatRateRules {
  return {
    kind: 'flat', stateCode: 'NC', taxYear, reviewedAt: REVIEWED_AT, rate: taxYear === 2025 ? 0.0425 : 0.0399, incomeBase: 'federal_agi',
    standardDeduction: byStatus(12750, 25500, 12750, 19125), childDeductionByAGI: NC_CHILD_DEDUCTION,
    sources: taxYear === 2025 ? NC_SOURCES : NC_SOURCES_2026, unmodeled: NC_UNMODELED,
  };
}

export const FLAT_RATE_STATE_CODES = Object.freeze(['GA', 'IL', 'NC', 'PA']) as readonly string[];

export function flatRateRules(stateCode: string, taxYear: StateRegistryTaxYear): FlatRateRules | undefined {
  switch (stateCode) {
    case 'IL': return illinois(taxYear, taxYear === 2025 ? 2850 : 2925);
    case 'PA': return pennsylvania(taxYear);
    case 'GA': return georgia(taxYear);
    case 'NC': return northCarolina(taxYear);
    default: return undefined;
  }
}
