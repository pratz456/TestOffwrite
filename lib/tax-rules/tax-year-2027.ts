/**
 * Verified 2027 planning parameters, deliberately separate from the annual return engine.
 * Published amounts do not establish a taxpayer's eligibility. Never substitute prior-year
 * values for pending parameters or use this registry to enable a complete 2027 estimate.
 */
export const TAX_YEAR_2027_REVIEWED_AT = '2026-09-23';

export const TAX_YEAR_2027_SOURCES = {
  health: 'https://www.irs.gov/pub/irs-drop/rp-26-24.pdf',
  marketplace: 'https://www.irs.gov/pub/irs-drop/rp-26-26.pdf',
  hsaEligibility: 'https://www.irs.gov/publications/p969',
  statute: 'https://www.govinfo.gov/content/pkg/PLAW-119publ21/html/PLAW-119publ21.htm',
  saversMatch: 'https://www.irs.gov/credits-deductions/savers-match',
  saversMatchGuidance: 'https://www.irs.gov/irb/2026-35_IRB',
  scholarship: 'https://www.irs.gov/government-entities/federal-state-local-governments/federal-scholarship-tax-credit-fstc',
  annualAdjustments: 'https://www.irs.gov/pub/irs-drop/rp-25-32.pdf',
  wageBase: 'https://www.ssa.gov/oact/cola/cbb.html',
  mileage: 'https://www.irs.gov/tax-professionals/standard-mileage-rates',
} as const;

/** Rev. Proc. 2026-24 §3; the age-55 catch-up remains $1,000 under IRC §223(b)(3). */
export const HSA_2027_LIMITS = {
  selfOnly: 4500,
  family: 9000,
  catchUp: 1000,
  minimumDeductible: { selfOnly: 1750, family: 3500 },
  maximumOutOfPocket: { selfOnly: 8700, family: 17400 },
  directPrimaryCareMonthly: { selfOnly: 150, moreThanOnePerson: 300 },
  exceptedBenefitHra: 2250,
} as const;

/** Percent units (10.22 means 10.22%, not a multiplier). These are NOT credit amounts. */
export const ACA_2027_PARAMETERS = {
  employerAffordabilityPercent: 10.22,
  applicablePercentages: [
    { fplMinimumPercent: 0, fplMaximumPercent: 133, initialPercent: 2.15, finalPercent: 2.15 },
    { fplMinimumPercent: 133, fplMaximumPercent: 150, initialPercent: 3.23, finalPercent: 4.30 },
    { fplMinimumPercent: 150, fplMaximumPercent: 200, initialPercent: 4.30, finalPercent: 6.78 },
    { fplMinimumPercent: 200, fplMaximumPercent: 250, initialPercent: 6.78, finalPercent: 8.66 },
    { fplMinimumPercent: 250, fplMaximumPercent: 300, initialPercent: 8.66, finalPercent: 10.22 },
    { fplMinimumPercent: 300, fplMaximumPercent: 400, initialPercent: 10.22, finalPercent: 10.22 },
  ],
  // Upper band endpoints are exclusive except 400%. The first row is not an eligibility
  // determination: below-100%-FPL cases require the statutory exception/eligibility rules.
  finalFplEndpointInclusive: true,
} as const;

/** P.L. 119-21 §70120: enacted 101% escalator, not an assumed inflation forecast. */
export const SALT_2027_PARAMETERS = {
  cap: 40804,
  marriedFilingSeparatelyCap: 20402,
  phaseDownMagi: 510050,
  marriedFilingSeparatelyPhaseDownMagi: 255025,
  floor: 10000,
  marriedFilingSeparatelyFloor: 5000,
  // For MFS apply 30% against the full cap using the MFS MAGI threshold, THEN halve
  // the result after the $10,000 floor. This registry does not calculate Schedule A.
  phaseDownRateBeforeMfsHalving: 0.30,
} as const;

export interface TaxYearReadinessTopic {
  id: string;
  title: string;
  status: 'published' | 'statutory' | 'derived';
  application: 'guidance_only';
  summary: string;
  source: string;
  sourceSection: string;
}

export const TAX_YEAR_2027_TOPICS: readonly TaxYearReadinessTopic[] = [
  {
    id: 'hsa', title: 'HSA and health-plan limits', status: 'published', application: 'guidance_only',
    summary: 'HSA: $4,500 self-only / $9,000 family, plus the separate age-55 catch-up when eligible. Coverage and contribution history still matter.',
    source: TAX_YEAR_2027_SOURCES.health, sourceSection: 'Rev. Proc. 2026-24 §3; IRC §223(b)(3) for catch-up',
  },
  {
    id: 'marketplace', title: 'Marketplace coverage', status: 'published', application: 'guidance_only',
    summary: 'Employer affordability: 10.22%. The published premium-tax-credit table also requires household income, coverage and benchmark premiums.',
    source: TAX_YEAR_2027_SOURCES.marketplace, sourceSection: 'Rev. Proc. 2026-26 §3',
  },
  {
    id: 'salt', title: 'State and local tax deduction', status: 'derived', application: 'guidance_only',
    summary: 'Cap: $40,804 ($20,402 married filing separately), subject to the statutory income phase-down and itemizing.',
    source: TAX_YEAR_2027_SOURCES.statute, sourceSection: 'P.L. 119-21 §70120, IRC §164(b)(6)–(7)',
  },
  {
    id: 'savers-match', title: "Saver’s Match begins", status: 'statutory', application: 'guidance_only',
    summary: 'Eligible retirement contributions may qualify for up to $1,000 per person, paid into an eligible retirement account. Implementation guidance is still developing.',
    source: TAX_YEAR_2027_SOURCES.saversMatchGuidance, sourceSection: 'IRC §6433; Notice 2026-48 (anticipated rules)',
  },
  {
    id: 'scholarship', title: 'Scholarship donation credit begins', status: 'statutory', application: 'guidance_only',
    summary: 'Up to $1,700 for qualifying cash gifts to eligible state-listed scholarship organizations. State participation and gift eligibility must be checked.',
    source: TAX_YEAR_2027_SOURCES.scholarship, sourceSection: 'IRC §25F, effective January 1, 2027',
  },
];

export const TAX_YEAR_2027_STATUS = Object.freeze({
  taxYear: 2027,
  usualFilingYear: 2028,
  reviewedAt: TAX_YEAR_2027_REVIEWED_AT,
  annualEstimateAvailable: false,
  coverage: 'Selected U.S. federal planning guidance; not a complete return, state coverage or e-filing support.',
  publishedParameters: { hsa: HSA_2027_LIMITS, marketplace: ACA_2027_PARAMETERS },
  derivedParameters: { salt: SALT_2027_PARAMETERS },
  topics: TAX_YEAR_2027_TOPICS,
  knownByStatute: [
    'Ordinary rates 10%–37% continue; 2027 bracket dollar amounts require publication.',
    'Qualified tips: deduction up to $25,000 with MAGI phaseout from $150,000 ($300,000 joint), eligibility and business-net-income limits. SSTB transition rules require separate review.',
    'Qualified overtime: deduction up to $12,500 ($25,000 joint), MAGI phaseout from $150,000 ($300,000 joint); qualifying FLSA overtime premium only, not ordinary contractor income.',
    'Qualifying personal-use vehicle loan interest: deduction up to $10,000, MAGI phaseout from $100,000 ($200,000 joint), subject to acquisition, loan and U.S. final-assembly requirements.',
    'Enhanced senior deduction: $6,000 per eligible individual, with 6% phaseout above $75,000 ($150,000 joint).',
    'SALT: $40,804 cap ($20,402 MFS), derived from the enacted 101% escalator; income phase-down and floors apply.',
    'QBI: 20% deduction continues with $75,000 ($150,000 joint) phase-in width; indexed thresholds and minimum-deduction figures remain pending.',
    'Third-party settlement organization Form 1099-K reporting: more than $20,000 AND more than 200 transactions. This is a reporting threshold, not a tax-free income allowance.',
    'Additional Medicare and NIIT thresholds remain $200,000 / $250,000 joint / $125,000 MFS; tax-specific eligibility rules apply.',
    'Estimated tax safe harbors generally use 90% of current tax or 100% of prior tax, increased to 110% for prior AGI above $150,000 ($75,000 MFS), subject to prior-return and special-rule conditions.',
    "Saver’s Match starts in 2027; scholarship contribution credit starts January 1, 2027. Neither is calculated by WriteOff yet.",
  ],
  pendingPublication: [
    { item: 'Ordinary income bracket amounts', expected: 'IRS annual revenue procedure, typically autumn 2026' },
    { item: 'Standard deduction, including age/blindness and dependent amounts', expected: 'IRS annual revenue procedure, typically autumn 2026' },
    { item: 'Long-term capital gain 0% and 15% thresholds', expected: 'IRS annual revenue procedure, typically autumn 2026' },
    { item: 'AMT exemptions and phaseouts; excess business loss thresholds', expected: 'IRS annual revenue procedure, typically autumn 2026' },
    { item: 'Indexed Child Tax Credit and refundable amount', expected: 'IRS annual revenue procedure, typically autumn 2026' },
    { item: 'EITC table and investment income limit', expected: 'IRS annual revenue procedure, typically autumn 2026' },
    { item: 'QBI thresholds and indexed minimum-deduction / active-income figures', expected: 'IRS annual revenue procedure, typically autumn 2026' },
    { item: 'Form 1099-NEC/MISC indexed reporting threshold', expected: 'IRS annual revenue procedure, typically autumn 2026' },
    { item: 'Social Security wage base and quarter of coverage', expected: 'SSA annual announcement, typically autumn 2026' },
    { item: 'Section 179, heavy-SUV and retirement contribution limits', expected: 'IRS revenue procedure and notices, typically autumn 2026' },
    { item: 'Standard mileage rates', expected: 'IRS notice, typically late 2026' },
    { item: 'Underpayment interest rates for 2027 quarters', expected: 'Quarterly IRS announcements; later quarters cannot be filled from Q1' },
  ],
  notImplemented: [
    'Complete 2027 federal liability, credits, forms and return filing',
    '2027 state and local calculations',
    '2027 transaction-level deduction determinations and tax-saving estimates',
    'HSA eligibility-month calculations, Marketplace credit calculation/reconciliation, Saver’s Match and scholarship credit claims',
  ],
  sources: Object.values(TAX_YEAR_2027_SOURCES),
});
