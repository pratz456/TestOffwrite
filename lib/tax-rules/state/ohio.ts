import type { OhioRules, StateRegistryTaxYear, StateSource, UnsupportedStateYear } from './types';

const REVIEWED_AT = '2026-09-17';

const OH_SOURCES_2025: StateSource[] = [
  {
    url: 'https://tax.ohio.gov/individual/resources/annual-tax-rates',
    note: 'Ohio Department of Taxation annual tax rates, taxable years beginning in 2025: 0% of Ohio taxable nonbusiness income up to $26,050; $342.00 + 2.75% of the excess over $26,050 up to $100,000; $2,394.32 + 3.125% of the excess over $100,000. The page lists brackets through 2025 only.',
  },
  {
    url: 'https://dam.assets.ohio.gov/image/upload/tax.ohio.gov/forms/ohio_individual/individual/2025/it1040-booklet.pdf',
    note: '2025 Ohio IT 1040 booklet: 2025 income tax brackets; personal and dependent exemption $2,400 (MAGI $40,000 or less), $2,150 ($40,001–$80,000), $1,900 ($80,001–$749,999), $0 ($750,000 or greater); Schedule of Credits line 9 exemption credit $20 per exemption when MAGI less exemptions is under $30,000; Schedule of Adjustments line 16 deduction for taxable Social Security benefits; business income taxed at a flat 3% after the deduction.',
  },
  {
    url: 'https://tax.ohio.gov/individual/resources/business-income-deduction',
    note: 'Ohio Business Income Deduction: the first $250,000 of business income (single or married filing jointly) or $125,000 (married filing separately) included in federal AGI is 100% deductible; remaining business income is taxed at a flat 3%; the federal QBI deduction does not affect the Ohio computation.',
  },
  {
    url: 'https://tax.ohio.gov/help-center/faqs/income-business-income-and-the-business-income-deduction/income-business-income-and-the-business-income-deduction',
    note: 'Ohio FAQ: federal Schedule 1 deductions such as self-employed health insurance and retirement contributions are not business income and are not entered on the Ohio Schedule of Business Income, so Schedule C net profit is the business income base.',
  },
];

const OH_2025: OhioRules = {
  kind: 'ohio', stateCode: 'OH', taxYear: 2025, reviewedAt: REVIEWED_AT,
  nonbusinessSchedule: [
    { over: 0, base: 0, rate: 0 },
    { over: 26050, base: 342, rate: 0.0275 },
    { over: 100000, base: 2394.32, rate: 0.03125 },
  ],
  businessIncomeDeduction: { limit: 250000, limitMarriedSeparate: 125000, rateOnExcess: 0.03 },
  exemptionByMAGI: [
    { agiUpTo: 40000, amount: 2400 },
    { agiUpTo: 80000, amount: 2150 },
    { agiUpTo: 749999, amount: 1900 },
  ],
  exemptionCredit: { amount: 20, magiLessExemptionsBelow: 30000 },
  sources: OH_SOURCES_2025,
  unmodeled: [
    'Ohio municipal income taxes and school district income taxes are separate returns and are not included.',
    'The joint filing credit, retirement income credit, senior citizen credit and other Schedule of Credits items are not modeled.',
    'Schedule of Adjustments items other than the business income deduction and the Social Security deduction (for example 529 contributions, bonus depreciation add-back, unreimbursed medical expenses) are not modeled.',
    'Only Schedule C net profit is treated as business income; pass-through, Schedule E and Schedule F business income are not collected.',
  ],
};

const OH_2026_UNSUPPORTED: UnsupportedStateYear = {
  stateCode: 'OH', taxYear: 2026,
  reason: 'The Ohio Department of Taxation annual tax rates page lists individual income tax brackets through taxable year 2025 only, and the 2026 estimated-payment instructions had not been updated for the H.B. 96 rate change at the September 17, 2026 review. Ohio is supported for 2025 only until the department publishes the 2026 brackets.',
  sources: [{ url: 'https://tax.ohio.gov/individual/resources/annual-tax-rates', note: 'Ohio annual tax rates page; 2026 brackets not yet listed.' }],
};

export function ohioRules(taxYear: StateRegistryTaxYear): OhioRules | UnsupportedStateYear {
  return taxYear === 2025 ? OH_2025 : OH_2026_UNSUPPORTED;
}
