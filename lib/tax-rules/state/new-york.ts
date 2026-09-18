import type { NewYorkRecaptureWorksheet, NewYorkRules, RateSchedule, StateFilingStatus, StateRegistryTaxYear, StateSource } from './types';

const REVIEWED_AT = '2026-09-17';

function schedule(rows: [number, number, number][]): RateSchedule {
  return rows.map(([over, base, rate]) => ({ over, base, rate }));
}
function worksheets(rows: [number, number, number, number][]): NewYorkRecaptureWorksheet[] {
  return rows.map(([taxableIncomeOver, taxableIncomeUpTo, base, incrementalBenefit]) => ({ taxableIncomeOver, taxableIncomeUpTo, base, incrementalBenefit }));
}

// Bracket edges are identical for 2025 and 2026; the rates in the lower brackets fall in 2026.
const JOINT_EDGES = [17150, 23600, 27900, 161550, 323200, 2155350, 5000000, 25000000];
const SINGLE_EDGES = [8500, 11700, 13900, 80650, 215400, 1077550, 5000000, 25000000];
const HEAD_EDGES = [12800, 17650, 20900, 107650, 269300, 1616450, 5000000, 25000000];

// ── 2025: Form IT-201-I New York State tax rate schedule (bases as printed) ──────
const JOINT_2025 = schedule([
  [0, 0, 0.04], [17150, 686, 0.045], [23600, 976, 0.0525], [27900, 1202, 0.055], [161550, 8553, 0.06],
  [323200, 18252, 0.0685], [2155350, 143754, 0.0965], [5000000, 418263, 0.103], [25000000, 2478263, 0.109],
]);
const SINGLE_2025 = schedule([
  [0, 0, 0.04], [8500, 340, 0.045], [11700, 484, 0.0525], [13900, 600, 0.055], [80650, 4271, 0.06],
  [215400, 12356, 0.0685], [1077550, 71413, 0.0965], [5000000, 449929, 0.103], [25000000, 2509929, 0.109],
]);
const HEAD_2025 = schedule([
  [0, 0, 0.04], [12800, 512, 0.045], [17650, 730, 0.0525], [20900, 901, 0.055], [107650, 5672, 0.06],
  [269300, 15371, 0.0685], [1616450, 107651, 0.0965], [5000000, 434163, 0.103], [25000000, 2494163, 0.109],
]);

// ── 2026: Form IT-2105-I (2026) New York State tax rates (bases as printed) ─────
const JOINT_2026 = schedule([
  [0, 0, 0.039], [17150, 669, 0.044], [23600, 953, 0.0515], [27900, 1174, 0.054], [161550, 8391, 0.059],
  [323200, 17928, 0.0685], [2155350, 143430, 0.0965], [5000000, 417939, 0.103], [25000000, 2477939, 0.109],
]);
const SINGLE_2026 = schedule([
  [0, 0, 0.039], [8500, 332, 0.044], [11700, 473, 0.0515], [13900, 586, 0.054], [80650, 4191, 0.059],
  [215400, 12141, 0.0685], [1077550, 71198, 0.0965], [5000000, 449714, 0.103], [25000000, 2509714, 0.109],
]);
const HEAD_2026 = schedule([
  [0, 0, 0.039], [12800, 499, 0.044], [17650, 712, 0.0515], [20900, 879, 0.054], [107650, 5564, 0.059],
  [269300, 15101, 0.0685], [1616450, 107381, 0.0965], [5000000, 433894, 0.103], [25000000, 2493894, 0.109],
]);

// Tax computation worksheets (NYAGI over $107,650). Worksheets 1/7/12 apply a flat rate to
// taxable income at or below the first edge; 2–5, 8–10 and 13–15 add the printed recapture
// base plus an incremental benefit phased in over $50,000 of NYAGI above the bracket edge.
const RECAPTURE_2025: NewYorkRules['recapture'] = {
  married_filing_jointly: {
    flatRate: 0.055, flatRateUpTo: 161550,
    worksheets: worksheets([[161550, 323200, 333, 807], [323200, 2155350, 1140, 2747], [2155350, 5000000, 3887, 60350], [5000000, Infinity, 64237, 32500]]),
  },
  single: {
    flatRate: 0.06, flatRateUpTo: 215400,
    worksheets: worksheets([[215400, 1077550, 568, 1831], [1077550, 5000000, 2399, 30172], [5000000, Infinity, 32571, 32500]]),
  },
  married_filing_separately: {
    flatRate: 0.06, flatRateUpTo: 215400,
    worksheets: worksheets([[215400, 1077550, 568, 1831], [1077550, 5000000, 2399, 30172], [5000000, Infinity, 32571, 32500]]),
  },
  head_of_household: {
    flatRate: 0.06, flatRateUpTo: 269300,
    worksheets: worksheets([[269300, 1616450, 787, 2289], [1616450, 5000000, 3076, 45261], [5000000, Infinity, 48337, 32500]]),
  },
};
const RECAPTURE_2026: NewYorkRules['recapture'] = {
  married_filing_jointly: {
    flatRate: 0.054, flatRateUpTo: 161550,
    worksheets: worksheets([[161550, 323200, 333, 807], [323200, 2155350, 1140, 3071], [2155350, 5000000, 4211, 60350], [5000000, Infinity, 64561, 32500]]),
  },
  single: {
    flatRate: 0.059, flatRateUpTo: 215400,
    worksheets: worksheets([[215400, 1077550, 567, 2047], [1077550, 5000000, 2614, 30172], [5000000, Infinity, 32786, 32500]]),
  },
  married_filing_separately: {
    flatRate: 0.059, flatRateUpTo: 215400,
    worksheets: worksheets([[215400, 1077550, 567, 2047], [1077550, 5000000, 2614, 30172], [5000000, Infinity, 32786, 32500]]),
  },
  head_of_household: {
    flatRate: 0.059, flatRateUpTo: 269300,
    worksheets: worksheets([[269300, 1616450, 787, 2559], [1616450, 5000000, 3346, 45260], [5000000, Infinity, 48606, 32500]]),
  },
};

const STANDARD_DEDUCTION: Record<StateFilingStatus, number> = {
  single: 8000, married_filing_jointly: 16050, married_filing_separately: 8000, head_of_household: 11200,
};

const NY_SOURCES_2025: StateSource[] = [
  {
    url: 'https://www.tax.ny.gov/forms/current-forms/it/it201i.htm',
    note: '2025 Form IT-201-I: New York State standard deduction table ($8,000 single, $16,050 married filing jointly, $8,000 married filing separately, $11,200 head of household); line 36 dependent exemption $1,000; 2025 New York State tax rate schedule; tax computation worksheets 1–16 for NYAGI over $107,650 (recapture base and incremental benefit amounts as printed).',
  },
  {
    url: 'https://www.tax.ny.gov/pdf/current_forms/it/it201_fill_in.pdf',
    note: '2025 Form IT-201 line 27: "Taxable amount of Social Security benefits (from line 15)" is a New York subtraction.',
  },
];
const NY_SOURCES_2026: StateSource[] = [
  {
    url: 'https://www.tax.ny.gov/pdf/current_forms/it/it2105i.pdf',
    note: 'Form IT-2105-I (2026), Estimated Tax Payment Voucher instructions: 2026 New York State tax rates (3.90% to 10.9%) with printed base amounts, 2026 standard deduction table, $1,000 dependent exemption and tax computation worksheets 1–16 with 2026 recapture base and incremental benefit amounts.',
  },
  ...NY_SOURCES_2025,
];

const NY_UNMODELED = [
  'New York City resident income tax, Yonkers taxes, the MCTMT on self-employment earnings and the NYC unincorporated business tax are separate and not included.',
  'New York itemized deductions, IT-225 modifications other than the Social Security subtraction, the pension and annuity exclusion, household credit, empire state child credit and other credits are not modeled.',
  'Taxable income below $65,000 is estimated with the rate schedule rather than the printed tax table, so the estimate can differ from the table by a few dollars.',
];

function rules(taxYear: StateRegistryTaxYear): NewYorkRules {
  const is2025 = taxYear === 2025;
  return {
    kind: 'new_york', stateCode: 'NY', taxYear, reviewedAt: REVIEWED_AT,
    schedules: is2025
      ? { single: SINGLE_2025, married_filing_separately: SINGLE_2025, married_filing_jointly: JOINT_2025, head_of_household: HEAD_2025 }
      : { single: SINGLE_2026, married_filing_separately: SINGLE_2026, married_filing_jointly: JOINT_2026, head_of_household: HEAD_2026 },
    standardDeduction: STANDARD_DEDUCTION,
    dependentExemption: 1000,
    recaptureAgiThreshold: 107650,
    recaptureFullAt: 157650,
    phaseInWidth: 50000,
    topRateAgiOver: 25000000,
    topRate: 0.109,
    recapture: is2025 ? RECAPTURE_2025 : RECAPTURE_2026,
    sources: is2025 ? NY_SOURCES_2025 : NY_SOURCES_2026,
    unmodeled: NY_UNMODELED,
  };
}

export const NEW_YORK_BRACKET_EDGES = Object.freeze({ joint: JOINT_EDGES, single: SINGLE_EDGES, head: HEAD_EDGES });

export function newYorkRules(taxYear: StateRegistryTaxYear): NewYorkRules {
  return rules(taxYear);
}
