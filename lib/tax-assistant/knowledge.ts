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

const reviewedAt = '2026-09-17';
const supportedTaxYears = [2026, 2027] as const;

/**
 * OBBBA (P.L. 119-21) figures below are statutory and not indexed for 2025–2028, so they hold for
 * both supported years. Primary sources:
 *   - Qualified tips §224, overtime §225, vehicle loan interest §163(h)(4): P.L. 119-21 §§70201–70203;
 *     IRS FS-2025-03 https://www.irs.gov/newsroom/one-big-beautiful-bill-act-tax-deductions-for-working-americans-and-seniors
 *   - Tips occupations/SSTB: T.D. 10044 https://www.federalregister.gov/documents/2026/04/13/2026-07104/occupations-that-customarily-and-regularly-received-tips-definition-of-qualified-tips ;
 *     Notice 2025-69 https://www.irs.gov/pub/irs-drop/n-25-69.pdf ; overtime FAQs FS-2026-13
 *   - Senior deduction §151(d)(5)(C): P.L. 119-21 §70103; FS-2025-03
 *   - 1099-K §6050W(e) >$20,000 and >200 transactions: P.L. 119-21 §70432; https://www.irs.gov/businesses/understanding-your-form-1099-k
 *   - 1099-NEC/MISC $2,000 for payments after 2025, indexed after 2026: P.L. 119-21 §70433; https://www.irs.gov/instructions/i1099mec
 *   - Charitable non-itemizer §170(p) and 0.5% floor §170(b)(1)(I): P.L. 119-21 §§70424–70425
 */

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
  {
    id: 'tips-overtime',
    title: 'IRS FS-2025-03: One Big Beautiful Bill Act deductions for tips and overtime (Schedule 1-A)',
    url: 'https://www.irs.gov/newsroom/one-big-beautiful-bill-act-tax-deductions-for-working-americans-and-seniors',
    reviewedAt, supportedTaxYears,
    summary: 'Section 224 allows a deduction for qualified tips for 2025 through 2028, capped at $25,000 per return and phased out by $100 per $1,000 of modified AGI above $150,000 ($300,000 joint). "No tax on tips" is a simplification: the tips still count as income and self-employment tax is unchanged. Tips must be voluntary, received in an occupation on the Treasury list (T.D. 10044), and reported on Form W-2, 1099-NEC, 1099-MISC, 1099-K or Form 4137. Tips earned in a specified service trade or business are excluded, subject to Notice 2025-69 transition relief. For a self-employed person the deduction cannot exceed the net income of the trade or business that produced the tips, and it cannot create a loss. Section 225 qualified overtime covers only the FLSA-required premium reported by an employer; an independent contractor generally has no qualified overtime. A work-eligible SSN is required and married taxpayers must file jointly.',
    requiredFacts: ['Are you self-employed, a W-2 employee, or both, and in what occupation were the tips received?', 'Were the tips voluntary customer payments, and does Form W-2, 1099-NEC, 1099-MISC, 1099-K or Form 4137 report them?', 'Does your work fall within a specified service trade or business (for example health, law, accounting, consulting, performing arts)?', 'What is the net income of the business that produced the tips, and is your filing status married filing separately?'],
  },
  {
    id: 'vehicle-loan-interest',
    title: 'IRS FS-2025-03: Qualified passenger vehicle loan interest deduction (section 163(h)(4))',
    url: 'https://www.irs.gov/newsroom/one-big-beautiful-bill-act-tax-deductions-for-working-americans-and-seniors',
    reviewedAt, supportedTaxYears,
    summary: 'For 2025 through 2028, up to $10,000 a year of interest on a loan taken out after December 31, 2024 to buy a new personal-use vehicle can be deducted without itemizing, reduced by $200 for each $1,000 of modified AGI above $100,000 ($200,000 joint). The vehicle must be new (original use begins with the taxpayer), under 14,000 pounds GVWR, and finally assembled in the United States; leases, used vehicles, fleet and commercial vehicles and related-party loans do not qualify, and the VIN must be reported on the return. Interest on a vehicle used in a trade or business is a Schedule C business-interest question limited to the business-use percentage, not a section 163(h)(4) deduction.',
    requiredFacts: ['Is the vehicle used personally, for business, or both, and what share is business use?', 'Was the loan taken out after December 31, 2024 to buy the vehicle, and is it secured by the vehicle?', 'Is the vehicle new with final assembly in the United States, and is it owned rather than leased?', 'What is your filing status and approximate modified adjusted gross income?'],
  },
  {
    id: 'senior-deduction',
    title: 'IRS FS-2025-03: Enhanced deduction for seniors (section 151(d)(5)(C))',
    url: 'https://www.irs.gov/newsroom/one-big-beautiful-bill-act-tax-deductions-for-working-americans-and-seniors',
    reviewedAt, supportedTaxYears,
    summary: 'For 2025 through 2028, a taxpayer who reaches age 65 by the end of the tax year may deduct $6,000 ($12,000 when both spouses on a joint return qualify), whether or not they itemize, in addition to the regular additional standard deduction for age. The deduction is reduced by 6% of modified AGI above $75,000 ($150,000 joint). A Social Security number is required for each qualifying individual and married taxpayers must file jointly. Self-employment tax is not affected. Social Security benefits remain taxable under the existing rules; this is a deduction, not an exclusion of benefits.',
    requiredFacts: ['Will you (and your spouse, if filing jointly) be age 65 or older by the end of the tax year?', 'What is your filing status, and does each qualifying person have a Social Security number?', 'What is your approximate modified adjusted gross income for the year?'],
  },
  {
    id: 'information-returns',
    title: 'IRS: Understanding your Form 1099-K; Instructions for Forms 1099-MISC and 1099-NEC',
    url: 'https://www.irs.gov/businesses/understanding-your-form-1099-k',
    reviewedAt, supportedTaxYears,
    summary: 'All business income is taxable whether or not an information return arrives. For payments made in 2025 and later, a third-party settlement organization files Form 1099-K only when gross payments exceed $20,000 and there are more than 200 transactions (P.L. 119-21 §70432 repealed the $600 rule and the IRS phase-in amounts); payment-card transactions have no minimum, and some states require reporting at lower thresholds. Form 1099-NEC/1099-MISC is required for payments of $600 or more made in 2025 and $2,000 or more made in 2026; the amount is indexed for payments made after 2026 and the 2027 figure has not been published. A 1099-K reports gross amounts before platform fees; Schedule C gross receipts should be the gross amount, with fees deducted as expenses.',
    requiredFacts: ['Are you asking as the person who was paid or as the business that made payments?', 'Which calendar year were the payments made in, and were they through a payment app or marketplace, by card, or directly?', 'Do the amounts on the form match your own records, including platform fees and personal transfers that were mixed in?'],
  },
  {
    id: 'charitable-non-itemizer',
    title: '26 USC 170(p): Charitable deduction for individuals who do not itemize',
    url: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section170&num=0&edition=prelim',
    reviewedAt, supportedTaxYears,
    summary: 'Starting with tax year 2026, a taxpayer who takes the standard deduction may deduct up to $1,000 ($2,000 joint) of cash contributions to public charities. Gifts to donor-advised funds and supporting organizations do not count, and non-cash gifts do not qualify. Itemizers instead deduct contributions on Schedule A subject to a new floor of 0.5% of the contribution base for 2026 and later. Substantiation rules still apply, including a contemporaneous written acknowledgment for any single gift of $250 or more. This does not apply to tax year 2025.',
    requiredFacts: ['Which tax year is the gift for, and will you itemize or take the standard deduction?', 'Was the gift cash (including check or card) to a public charity rather than to a donor-advised fund or supporting organization?', 'Do you have a receipt or written acknowledgment from the charity?'],
  },
];

export function sourcesForYear(year: number) {
  return GUIDANCE_SOURCES.filter(source => source.supportedTaxYears.includes(year));
}

export function yearNotice(year: number): string | null {
  return year === 2027
    ? '2027 planning: some annual IRS and Social Security amounts (inflation-indexed brackets, standard deductions, wage base, mileage rate, retirement limits, the indexed 1099-NEC threshold) have not been verified or published as of September 17, 2026, and remain pending. This answer uses general reviewed rules and statutory amounts that are fixed through 2028; it does not substitute 2026 limits or calculate a deduction amount.'
    : null;
}
