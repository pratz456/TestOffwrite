import { STATE_REGISTRY_TAX_YEARS, type NoIncomeTaxRules, type StateRegistryTaxYear, type StateSource } from './types';

const REVIEWED_AT = '2026-09-17';

/**
 * States without an individual income tax on wages or business profits for tax years 2025
 * and 2026. Each statement is taken from the state revenue department (or, for Texas and
 * Alaska, the Comptroller and Department of Revenue), not from secondary summaries.
 */
const NO_INCOME_TAX_STATES: Record<string, { sources: StateSource[]; notes: string[]; unmodeled: string[] }> = {
  AK: {
    sources: [{
      url: 'https://tax.alaska.gov/programs/programs/reports/AnnualReport.aspx?Year=2024',
      note: 'Alaska Department of Revenue annual report history: the Legislature repealed the individual income tax provisions of AS 43.20 in 1980; no individual income tax applies for 2025 or 2026.',
    }],
    notes: ['Alaska has no individual income tax.'],
    unmodeled: ['Local sales/property taxes and Alaska Permanent Fund Dividend treatment are outside this estimate.'],
  },
  FL: {
    sources: [{
      url: 'https://floridarevenue.com/taxes/compliance/Pages/violations.aspx',
      note: 'Florida Department of Revenue: "The State of Florida does not have a personal income tax." Applies to 2025 and 2026.',
    }],
    notes: ['Florida has no personal income tax.'],
    unmodeled: ['Florida corporate income tax applies to corporations only; sole proprietors are outside it.'],
  },
  NV: {
    sources: [{
      url: 'https://tax.nv.gov/about-nevada-department-of-taxation/income-tax-in-nevada/',
      note: 'Nevada Department of Taxation: the State of Nevada does not impose a state income tax on individuals. Applies to 2025 and 2026.',
    }],
    notes: ['Nevada has no individual income tax.'],
    unmodeled: ['The Nevada Commerce Tax applies only to businesses with gross revenue above the department\'s annual threshold and is not modeled.'],
  },
  NH: {
    sources: [{
      url: 'https://www.revenue.nh.gov/news-and-media/repeal-nh-interest-and-dividends-tax-now-effect',
      note: 'NH Department of Revenue Administration (Jan 23, 2025): the Interest and Dividends Tax is repealed for tax periods beginning on or after January 1, 2025; New Hampshire has no tax on wages or business profits of individuals as such.',
    }],
    notes: ['New Hampshire has no individual income tax on wages, and its Interest and Dividends Tax is repealed for tax periods beginning on or after January 1, 2025.'],
    unmodeled: ['New Hampshire Business Profits Tax and Business Enterprise Tax can apply to a sole proprietorship above the department\'s filing thresholds; they are business-entity taxes and are not modeled here.'],
  },
  SD: {
    sources: [{
      url: 'https://dor.sd.gov/individuals/taxes/',
      note: 'South Dakota Department of Revenue: South Dakota does not impose a state income tax. Applies to 2025 and 2026.',
    }],
    notes: ['South Dakota has no state income tax.'],
    unmodeled: [],
  },
  TN: {
    sources: [{
      url: 'https://www.tn.gov/revenue/taxes/hall-income-tax.html',
      note: 'Tennessee Department of Revenue: the Hall income tax (interest and dividends) was repealed for tax periods beginning on or after January 1, 2021; Tennessee has no individual income tax for 2025 or 2026.',
    }],
    notes: ['Tennessee has no individual income tax; the Hall tax on interest and dividends was repealed for tax periods beginning January 1, 2021 or later.'],
    unmodeled: ['The Tennessee business tax on gross receipts can apply to businesses above the department\'s thresholds and is not modeled.'],
  },
  TX: {
    sources: [{
      url: 'https://comptroller.texas.gov/taxes/franchise/faq/taxable-entities.php',
      note: 'Texas Comptroller franchise tax FAQ: a sole proprietorship that is not legally organized to limit liability is not a taxable entity; Texas imposes no individual income tax (Tex. Const. art. VIII, §24-a). Applies to 2025 and 2026.',
    }],
    notes: ['Texas has no individual income tax, and a sole proprietorship is not a taxable entity for the Texas franchise tax.'],
    unmodeled: ['A single-member LLC taxed as a sole proprietor is a franchise-tax taxable entity and is not modeled.'],
  },
  WA: {
    sources: [
      {
        url: 'https://dor.wa.gov/taxes-rates/income-tax',
        note: 'Washington Department of Revenue: Washington does not currently have an individual income tax; a 9.9% income tax on adjusted gross income exceeding $1 million begins January 1, 2028 (SB 6346), first returns due 2029. No individual income tax for 2025 or 2026.',
      },
      {
        url: 'https://dor.wa.gov/taxes-rates/business-occupation-tax',
        note: 'Washington Department of Revenue: most businesses, including sole proprietors, owe the business and occupation (B&O) gross receipts tax, which allows no deduction for expenses; rates depend on the classification.',
      },
    ],
    notes: [
      'Washington has no individual income tax for 2025 or 2026. Beginning January 1, 2028 a 9.9% income tax applies to adjusted gross income over $1 million (SB 6346).',
      'Washington does tax business gross receipts through the B&O tax, which is owed even in a loss year and is not part of this income tax estimate.',
    ],
    unmodeled: ['Washington B&O tax, the small business B&O credit and the capital gains excise tax are not modeled.'],
  },
  WY: {
    sources: [{
      url: 'https://revenue.wyo.gov/',
      note: 'Wyoming Department of Revenue administers excise, mineral and property taxes only; Wyoming imposes no individual income tax (W.S. 39-12-101 preempts income taxation). Applies to 2025 and 2026.',
    }],
    notes: ['Wyoming has no individual income tax.'],
    unmodeled: [],
  },
};

export const NO_INCOME_TAX_STATE_CODES = Object.freeze(Object.keys(NO_INCOME_TAX_STATES).sort()) as readonly string[];

export function noIncomeTaxRules(stateCode: string, taxYear: StateRegistryTaxYear): NoIncomeTaxRules | undefined {
  const entry = NO_INCOME_TAX_STATES[stateCode];
  if (!entry || !STATE_REGISTRY_TAX_YEARS.includes(taxYear)) return undefined;
  return { kind: 'no_income_tax', stateCode, taxYear, reviewedAt: REVIEWED_AT, ...entry };
}
