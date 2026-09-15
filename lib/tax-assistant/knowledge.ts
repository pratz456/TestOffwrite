/** Reviewed guidance packets, not a complete tax-code retrieval system. */
export interface GuidanceSource {
  id: string;
  title: string;
  url: string;
  reviewedAt: string;
  supportedTaxYears: readonly number[];
  summary: string;
  requiredFacts: readonly string[];
}

const reviewedAt = '2026-09-15';
const supportedTaxYears = [2026, 2027] as const;

export const GUIDANCE_SOURCES: readonly GuidanceSource[] = [
  {
    id: 'authority',
    title: 'IRS: Tax code, regulations and official guidance',
    url: 'https://www.irs.gov/privacy-disclosure/tax-code-regulations-and-official-guidance',
    reviewedAt, supportedTaxYears,
    summary: 'Apply the law effective for the selected tax year. Read the Code with applicable Treasury regulations and interpreting decisions. Publications and FAQs explain rules but do not replace controlling law. This packet covers selected federal business deduction questions only, not a complete return, state tax, every entity, or every Code section.',
    requiredFacts: ['Which tax year and business/entity type does this question concern?'],
  },
  {
    id: 'business-expenses',
    title: '26 USC 162: Trade or business expenses',
    url: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section162&num=0&edition=prelim',
    reviewedAt, supportedTaxYears,
    summary: 'Section 162 generally allows ordinary and necessary expenses paid or incurred in carrying on a trade or business. A merchant name or item photo cannot establish a business purpose. Personal use, reimbursement, capitalization, timing and specific limitations must be checked. An asset purchase may require depreciation analysis rather than an immediate expense deduction.',
    requiredFacts: ['Are you self-employed, a business owner, or a W-2 employee, and what is the business/entity type?', 'How is this item used in that business?', 'Was the expense paid or incurred, and was any part personal or reimbursed?'],
  },
  {
    id: 'vehicles-records',
    title: 'IRS Publication 463 (2025): Travel, gift, and car expenses',
    url: 'https://www.irs.gov/publications/p463',
    reviewedAt, supportedTaxYears,
    summary: 'Separate business travel from commuting and personal use. Vehicle method choices and substantiation matter; avoid combining standard mileage with separately deducted costs already included in that method. Keep dates, mileage, destination and business purpose. Appearance does not prove weight classification, ownership, actual business-use percentage or tax eligibility. Annual mileage rates must be checked for the date driven; do not reuse a prior-year rate. Employee eligibility and detailed vehicle exceptions are outside this packet.',
    requiredFacts: ['Are you self-employed or a W-2 employee, and do you own or lease the vehicle?', 'Is this a truck/van or another passenger automobile? Confirm manufacturer GVWR for a truck/van, or unloaded gross vehicle weight for another passenger automobile.', 'What share of actual use is business, excluding commuting, and what mileage records support that?', 'When was it acquired and first available for business use, and what was the purchase basis?', 'Which deduction method has been used previously, and what is the business/entity type?'],
  },
  {
    id: 'depreciation',
    title: 'IRS Publication 946 (2025): Depreciation and Section 179',
    url: 'https://www.irs.gov/publications/p946',
    reviewedAt, supportedTaxYears,
    summary: 'For asset purchases establish cost/basis, acquisition date, placed-in-service date, eligibility, entity and business use. Section 179, bonus depreciation and regular depreciation are different provisions with ordering, elections and limitations. Listed property generally requires more than 50% qualified business use for Section 179, bonus depreciation and accelerated methods; a later decrease can trigger recapture. A vehicle above 6,000 pounds is not automatically fully deductible. Heavy-SUV caps and vehicle design exceptions need exact classification; detailed exceptions are outside this packet. Do not quote historical annual limits as current.',
    requiredFacts: ['Are you self-employed or a W-2 employee, and what is the business/entity type?', 'When was the property acquired and first ready and available for business use?', 'What is the purchase basis and qualified business-use percentage?', 'What type of asset is this, and was it ever used personally or acquired from a related party?', 'What prior depreciation or mileage elections apply, and what other Section 179 purchases and business income must be considered?'],
  },
  {
    id: 'home-office',
    title: 'IRS Publication 587 (2025): Business use of your home',
    url: 'https://www.irs.gov/publications/p587',
    reviewedAt, supportedTaxYears,
    summary: 'A self-employed home workspace generally must meet regular and exclusive business-use requirements and the applicable place-of-business test. Specific exceptions exist, including certain daycare and inventory uses. W-2 employee eligibility has separate restrictions and is not supported by this packet. Working from home by itself does not qualify every room or housing cost. Ask about business use and method before giving a conditional assessment; do not infer area or eligibility from a room photo.',
    requiredFacts: ['Are you self-employed or a W-2 employee?', 'Is this space used regularly and exclusively for the business?', 'What business activity takes place here, and do you have another fixed business location?', 'Which home-office method have you used, and what records support the business area and expenses?'],
  },
  {
    id: 'meals',
    title: '26 USC 274: Entertainment, meals and substantiation limits',
    url: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section274&num=0&edition=prelim',
    reviewedAt, supportedTaxYears,
    summary: 'Entertainment is generally disallowed; business meals have separate conditions and generally a 50% limitation subject to exceptions. The business purpose, attendees, taxpayer/employee presence, lavishness and separation from entertainment charges matter. Employer-provided meals have additional rules including 2026 changes, outside this packet. A restaurant receipt alone does not establish deductibility.',
    requiredFacts: ['Who attended, and what was the business purpose?', 'Was the meal separate from entertainment, and was the taxpayer or an employee present?'],
  },
  {
    id: 'vehicle-classification',
    title: '26 USC 280F: Listed property and passenger automobiles',
    url: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section280F&num=0&edition=prelim',
    reviewedAt, supportedTaxYears,
    summary: 'For the passenger-automobile weight test, section 280F(d)(5) uses unloaded gross vehicle weight, with gross vehicle weight substituted for a truck or van. Do not use a sedan GVWR to establish the exemption from passenger-automobile limits. Listed-property business-use requirements, substantiation and recapture remain relevant.',
    requiredFacts: [],
  },
];

export function sourcesForYear(year: number) {
  return GUIDANCE_SOURCES.filter(source => source.supportedTaxYears.includes(year));
}

export function yearNotice(year: number): string | null {
  return year === 2027
    ? '2027 planning: some annual IRS and Social Security amounts have not been verified or published as of September 15, 2026. This answer uses general reviewed rules and does not substitute 2026 limits or calculate a deduction amount.'
    : null;
}
