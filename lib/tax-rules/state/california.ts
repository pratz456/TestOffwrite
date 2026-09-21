import type { CaliforniaRules, RateSchedule, StateRegistryTaxYear, StateSource, UnsupportedStateYear } from './types';

const REVIEWED_AT = '2026-09-17';

function schedule(rows: [number, number, number][]): RateSchedule {
  return rows.map(([over, base, rate]) => ({ over, base, rate }));
}

// 2025 California Tax Rate Schedules (Form 540 booklet), transcribed as printed.
// Schedule X: single and married/RDP filing separately.
const SCHEDULE_X_2025 = schedule([
  [0, 0, 0.01], [11079, 110.79, 0.02], [26264, 414.49, 0.04], [41452, 1022.01, 0.06], [57542, 1987.41, 0.08],
  [72724, 3201.97, 0.093], [371479, 30986.19, 0.103], [445771, 38638.27, 0.113], [742953, 72219.84, 0.123],
]);
// Schedule Y: married/RDP filing jointly and qualifying surviving spouse/RDP.
const SCHEDULE_Y_2025 = schedule([
  [0, 0, 0.01], [22158, 221.58, 0.02], [52528, 828.98, 0.04], [82904, 2044.02, 0.06], [115084, 3974.82, 0.08],
  [145448, 6403.94, 0.093], [742958, 61972.37, 0.103], [891542, 77276.52, 0.113], [1485906, 144439.65, 0.123],
]);
// Schedule Z: head of household.
const SCHEDULE_Z_2025 = schedule([
  [0, 0, 0.01], [22173, 221.73, 0.02], [52530, 828.87, 0.04], [67716, 1436.31, 0.06], [83805, 2401.65, 0.08],
  [98990, 3616.45, 0.093], [505208, 41394.72, 0.103], [606251, 51802.15, 0.113], [1010417, 97472.91, 0.123],
]);

const CA_SOURCES_2025: StateSource[] = [
  {
    url: 'https://www.ftb.ca.gov/forms/2025/2025-540-tax-rate-schedules.pdf',
    note: '2025 California Tax Rate Schedules X, Y and Z (Form 540 line 31), including the printed base amounts.',
  },
  {
    url: 'https://www.ftb.ca.gov/forms/2025/2025-540-instructions.html',
    note: '2025 Form 540 instructions: standard deduction $5,706 (single, married/RDP filing separately) and $11,412 (married/RDP filing jointly, head of household, qualifying surviving spouse); line 32 AGI Limitation Worksheet thresholds $252,203 / $504,411 / $378,310 with a $6 reduction per $2,500 ($1,250 married/RDP filing separately) of excess federal AGI; line 62 Behavioral Health Services Tax of 1% on taxable income over $1,000,000.',
  },
  {
    url: 'https://www.ftb.ca.gov/forms/2025/2025-540.pdf',
    note: '2025 Form 540 lines 7 and 10: personal exemption credit $153 per exemption; dependent exemption credit $475 per dependent.',
  },
  {
    url: 'https://www.ftb.ca.gov/forms/2025/2025-540-ca-instructions.html',
    note: '2025 Schedule CA (540) instructions: line 13 "Federal law allows a deduction for contributions to an HSA account. California law does not conform" (add back); line 6 "California excludes U.S. social security benefits ... from taxable income" (subtract).',
  },
];

const CA_2025: CaliforniaRules = {
  kind: 'california', stateCode: 'CA', taxYear: 2025, reviewedAt: REVIEWED_AT,
  schedules: {
    single: SCHEDULE_X_2025, married_filing_separately: SCHEDULE_X_2025,
    married_filing_jointly: SCHEDULE_Y_2025, head_of_household: SCHEDULE_Z_2025,
  },
  standardDeduction: { single: 5706, married_filing_separately: 5706, married_filing_jointly: 11412, head_of_household: 11412 },
  personalExemptionCredit: 153,
  dependentExemptionCredit: 475,
  exemptionPhaseout: {
    agiThreshold: { single: 252203, married_filing_separately: 252203, married_filing_jointly: 504411, head_of_household: 378310 },
    increment: 2500, incrementMarriedSeparate: 1250, reductionPerIncrement: 6,
  },
  behavioralHealthServicesTax: { threshold: 1000000, rate: 0.01 },
  sources: CA_SOURCES_2025,
  unmodeled: [
    'California itemized deductions, the California earned income tax credit, renter\'s credit, other credits and alternative minimum tax are not modeled.',
    'California does not conform to the federal QBI deduction (not in AGI, so no adjustment is needed) or to several 2025 federal changes; only the HSA add-back and Social Security subtraction are applied.',
    'California\'s net operating loss suspension for 2024–2026 and business-loss treatment are not modeled; a Schedule C loss is treated as zero.',
    'The blind and senior exemption credits and the standard deduction worksheet for dependents are not modeled.',
  ],
};

const CA_2026_UNSUPPORTED: UnsupportedStateYear = {
  stateCode: 'CA', taxYear: 2026,
  reason: 'The Franchise Tax Board indexes California brackets, the standard deduction and exemption credits annually and had not published the 2026 Form 540 rate schedules or instructions at the September 17, 2026 review (the 2026 schedule URL returned not found). California is supported for 2025 only until the 2026 figures are published.',
  sources: [{ url: 'https://www.ftb.ca.gov/forms/index.html', note: 'FTB forms and publications; 2026 Form 540 materials not yet available.' }],
};

export function californiaRules(taxYear: StateRegistryTaxYear): CaliforniaRules | UnsupportedStateYear {
  return taxYear === 2025 ? CA_2025 : CA_2026_UNSUPPORTED;
}
