import type { OutputType, TransactionInput, UserContext } from './analyzeTransaction';
import { findMerchantEntry, merchantDescriptor, merchantIntelligence, type MerchantIntelligenceResult } from './merchant-intelligence';
import { matchProfessions, professionHint } from './profession-priors';
import { redactIdentifierText } from '@/lib/security/identifier-redaction';
import { BUSINESS_STANDARD_MILEAGE_RATES } from '@/lib/tax-rules/mileage-rates';

/** Selected, reviewed federal rules. This is not retrieval over the entire tax code. */
export const TRANSACTION_TAX_POLICY_VERSION = 'federal-transactions-2026-09-18.3';
export const TRANSACTION_KINDS = ['expense', 'income', 'transfer', 'refund', 'personal', 'unknown'] as const;
/** Expense categories the model may return; the single source for the zod enum, JSON schema and intelligence tables. */
export const EXPENSE_CATEGORIES = [
  'advertising_marketing', 'supplies_small_tools', 'software_subscriptions', 'contract_labor', 'equipment', 'vehicle_expense',
  'parking_tolls', 'travel', 'meals_50', 'home_office', 'utilities_phone_internet', 'education_training', 'dues_and_memberships',
  'bank_and_payment_fees', 'rent', 'insurance', 'legal_professional', 'taxes_licenses', 'repairs_maintenance', 'other',
] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
/**
 * Categories added in 2026-09-18.3 so that ordinary Schedule C lines 9, 15, 17, 21 and 23 are confirmable
 * deductions. Live evaluation had found correct approvals for parking, tolls and business insurance dying in the
 * unconfirmable "other"/"vehicle_expense" buckets; a high-confidence merchant match now refines a model's "other".
 */
export const CONFIRMABLE_LINE_CATEGORIES: readonly ExpenseCategory[] = ['parking_tolls', 'insurance', 'legal_professional', 'taxes_licenses', 'repairs_maintenance'];
export interface TransactionTaxSource {
  id: string; title: string; url: string; edition: string; reviewed_at: string;
}
export interface TransactionTaxMetadata {
  tax_year: number | null;
  jurisdiction: 'US-federal';
  policy_version: string;
  sources: TransactionTaxSource[];
  provenance: { provider: 'openai'; model: string; kind: 'model_with_curated_tax_policy' };
  /**
   * Merchant-table purpose the user can confirm or edit in one tap. Present only on a
   * needs_more_info result whose missing field is business_purpose; never on an approval.
   */
  proposed_purpose?: string;
  /** Schedule C line for the suggested expense category, for display only. */
  schedule_c_line?: string;
}
const codeUrl = (section: number | string) => `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section${section}&num=0&edition=prelim`;
const PUB_334 = 'https://www.irs.gov/publications/p334';
const source = (id: string, title: string, url: string, edition: string, rule: string, reviewed_at = '2026-09-16', notes?: string) =>
  ({ id, title, url, edition, reviewed_at, rule, notes });
/** Sources added in the 2026-09-17.2 packet review. */
const added = (id: string, title: string, url: string, edition: string, rule: string, notes?: string) =>
  source(id, title, url, edition, rule, '2026-09-17', notes);
const mileageYears = `${BUSINESS_STANDARD_MILEAGE_RATES[0].from.slice(0, 4)}–${BUSINESS_STANDARD_MILEAGE_RATES.at(-1)!.to.slice(0, 4)}`;

export const TRANSACTION_TAX_EVIDENCE = [
  source('business-162', '26 USC 162 — Trade or business expenses', codeUrl(162), 'Current Code; selected general rule',
    'An expense must be ordinary and necessary for an existing trade or business. Merchant, profession, a business bank account, prior corrections, and time of day do not establish the purpose. Identify the actual item/service and business use; consider reimbursement, personal allocation, timing and capitalization.'),
  source('personal-262', '26 USC 262 — Personal, living and family expenses', codeUrl(262), 'Current Code; selected general rule',
    'Personal, living and family spending does not become a business deduction merely because it benefits work. Distinguish household meals, recreation and commuting. Separate identifiable business use from personal use; never invent an allocation.'),
  source('meals-274', '26 USC 274 — Meal conditions, entertainment limits and employer-provided meals after 2025', codeUrl(274), 'Current Code as amended by P.L. 119-21 §70305; selected 2025/2026 rules',
    'Ordinary qualifying business meals generally have a 50% limit, not automatic eligibility (§274(k) conditions, §274(n)(1) limit). Establish business purpose, participants, taxpayer/employee presence, non-lavish spending and separately stated food from entertainment; food and drinks served to clients, customers or contractors at the taxpayer\'s own studio, office or shoot location are business meals under the same tests, not supplies. Entertainment is generally disallowed. Meals and snacks the taxpayer provides to their own employees at the business premises (§119 employer-convenience meals, an on-premises eating facility or break room under §132(e)(2)) were limited to 50% for 2018–2025 and are not deductible at all for amounts paid after December 31, 2025 (§274(o)); the only exceptions are food sold to customers for full consideration (§274(e)(8)) and crew, offshore-rig and fishing-vessel meals (§274(n)(2)(C)). A meal during a work shift alone is not enough.',
    '2026-09-18', 'Text and effective dates verified in the current uscode.house.gov text on 2026-09-18: §274(o) enacted by P.L. 115-97 (2017) for amounts paid after 2025; the (e)(8)/(n)(2)(C) exceptions and the fishing-vessel clause (n)(2)(C)(v) added by P.L. 119-21 §70305, also for amounts paid after December 31, 2025; the restaurant exception in (n)(2)(D) ended after 2022.'),
  source('travel-463', 'IRS Publication 463 — Travel, gift and car expenses', 'https://www.irs.gov/publications/p463', '2025 publication; selected general principles only',
    'Ordinary commuting to a regular work location is personal. Overnight business travel depends on tax home, business purpose, dates and personal allocation. A home-to-client trip is not automatically eligible: qualifying home-office/temporary-location facts matter. For vehicles establish business mileage/use and deduction method; standard mileage already includes many actual car costs. No annual mileage rates or depreciation limits are supplied here.'),
  source('capital-263', '26 USC 263 — Capital expenditures', codeUrl(263), 'Current Code; selected general rule',
    'Asset purchases and improvements can require capitalization. Do not promise immediate expensing based on price, merchant or weight; elections and safe-harbor eligibility need separate facts.'),
  source('assets-946', 'IRS Publication 946 — Depreciation and Section 179', 'https://www.irs.gov/publications/p946', '2025 publication; no annual limits supplied',
    'Depreciation, Section 179 and bonus depreciation are different treatments. Establish asset basis/type, acquisition and placed-in-service dates, business use and elections. A vehicle over 6,000 pounds is not automatically fully deductible. Asset deductions and annual limits are outside this transaction suggestion packet.'),
  source('home-587', 'IRS Publication 587 — Business use of your home', 'https://www.irs.gov/publications/p587', '2025 publication; selected general principles only',
    'A self-employed home workspace normally needs regular exclusive business use and the applicable business-location test. Exceptions, method, business area, income limits and carryovers need review; working at home alone does not qualify housing costs.'),
  source('records-334', 'IRS Publication 334 — Small-business income and expenses', PUB_334, '2025 publication; selected general principles only',
    'Separate business receipts, owner contributions, loans, transfers and refunds. A negative bank amount alone does not establish income or a refund. Match refunds to the original purchase and its tax year/treatment; prior-year deduction recoveries may be income under tax-benefit rules. Retain invoices and payment records. A refund is not a new positive deduction.'),
  // --- 2026-09-17.2: category-specific rules (primary sources only) -----------------------------
  added('software-334', 'IRS Publication 334, ch. 8 — Software, subscriptions and web services (§162)', PUB_334, '2025 publication; "Other Expenses You Can Deduct" applied to software and online tools',
    'Business software, SaaS plans, cloud storage and hosting, domains and online tools are ordinary expenses (Schedule C line 18, office expense) when the plan is used in the business. Common false positives: streaming, music and gaming services, personal cloud or family plans, and the personal tier of a tool that also has business uses. Eligibility rests on the recorded business use and any personal share; a recurring charge or a business card does not show use.'),
  added('advertising-334', 'IRS Publication 334, ch. 8 — Advertising (§162)', PUB_334, '2025 publication; selected rule; Schedule C line 8',
    'Reasonable advertising directly related to the business is deductible (Schedule C line 8): online ads, business cards and printed promotion, website promotion, paid listings and sponsorships that promote your goods or services. Common false positives: boosts of a personal social account, gifts or meals labelled "marketing", and political or lobbying spending, which is disallowed. Eligibility needs the campaign or item and the business offering it promoted.'),
  added('contract-labor-334', 'IRS Publication 334, ch. 8 — Contract labor and independent contractors', PUB_334, '2025 publication; Schedule C line 11',
    'Payments to non-employee people or firms for services in the business (freelancers, subcontractors, assistants, editors, virtual assistants) are contract labor (Schedule C line 11). Payments to yourself, to household help and for personal projects are not, and employee wages belong on line 26 with payroll filings. Eligibility needs who was paid, the work they did for the business and the invoice or contract; the Form 1099-NEC duty applies to yearly totals.'),
  added('information-returns-6041', '26 USC 6041 — Information returns for contractor payments (Form 1099-NEC)', codeUrl(6041), 'Current Code as amended by P.L. 119-21: $600 for 2025 payments; $2,000 for payments after 2025, indexed after 2026',
    'A business that pays an unincorporated contractor $600 or more during 2025, or $2,000 or more in a calendar year after 2025 (indexed for inflation after 2026), must file Form 1099-NEC and furnish a copy; the deduction does not depend on filing, but the duty and the contractor\'s Form W-9 are part of the record. Payments made by card or through a third-party settlement platform such as PayPal goods-and-services, Upwork or Fiverr are reported by the platform on Form 1099-K (§6050W) instead of by you. When contract labor is confirmed, ask for the contractor\'s name, entity type and yearly total.',
    'Threshold and §6041(h) indexing verified in the current uscode.house.gov text on 2026-09-17; the 1099-K carve-out follows the Instructions for Forms 1099-MISC and 1099-NEC.'),
  added('education-reg-1.162-5', 'Treas. Reg. §1.162-5 — Expenses for education', 'https://www.ecfr.gov/current/title-26/section-1.162-5', 'Current eCFR text; selected rule; Schedule C line 27a',
    'Education is deductible when it maintains or improves skills required in your present business, or is required to keep your status or license, and it is not education that meets the minimum requirements of your trade or qualifies you for a new trade or business. Common false positives: courses to start a different line of work, degree programs that qualify you for a new profession, general-interest or personal-development classes, and coaching unrelated to a skill you sell. Eligibility needs the course topic, how it relates to the services you already provide, and the receipt.'),
  added('insurance-334', 'IRS Publication 334, ch. 8 — Insurance (business premiums vs. self-employed health insurance)', PUB_334, '2025 publication; Schedule C line 15; §162(l) health premiums via Form 7206',
    'Premiums for business liability, professional or errors-and-omissions coverage, business property, commercial auto (only under the actual-expense vehicle method), workers\' compensation and business interruption coverage are deductible on Schedule C line 15. Health, dental and vision premiums for you and your family are not a Schedule C expense: they are a Schedule 1 adjustment computed on Form 7206 (§162(l)) that does not reduce self-employment tax, and life or disability insurance on yourself is personal. Eligibility needs the policy type, the insured business risk or property, and the premium statement.'),
  added('bank-fees-334', 'IRS Publication 334, ch. 8 — Bank charges and payment processing fees', PUB_334, '2025 publication; "Other Expenses You Can Deduct"; Schedule C line 10 or 27a',
    'Service charges, wire and ACH fees, merchant processing fees (Stripe, Square, PayPal) and annual fees on cards or accounts used for the business are deductible (Schedule C line 10, commissions and fees, or line 27a). Fees on a personal account, interest and overdraft charges from personal spending, and ATM fees for personal cash are not. Eligibility needs the account or processor the fee came from and that the account carries business activity.'),
  added('platform-fees-1099k', 'IRS — Understanding your Form 1099-K (gross receipts vs. platform fees)', 'https://www.irs.gov/businesses/understanding-your-form-1099-k', 'IRS page as reviewed 2026-09-17; selected rule; Schedule C line 10',
    'Marketplace and payment-platform payouts (Etsy, Amazon, Shopify Payments, Stripe, Upwork, rideshare and delivery apps) usually arrive net of fees while Form 1099-K reports the gross amount: report gross receipts and deduct the commissions and processing fees separately (Schedule C line 10). Treating a net payout as income understates receipts and hides the deductible fees. Eligibility needs the platform statement showing gross sales and the fees withheld.'),
  added('dues-274a3', '26 USC 274(a)(3) — Club dues disallowed; professional and trade association dues', codeUrl(274), 'Current Code; selected rule with Publication 334 ch. 8; Schedule C line 27a',
    'No deduction is allowed for membership in any club organized for business, pleasure, recreation or other social purpose: gyms, health and athletic clubs, country and golf clubs, airline and hotel clubs, and social or dining clubs, even when networking or fitness supports your work. Dues to professional and trade associations, chambers of commerce, boards of trade, licensing boards and civic or public-service organizations remain ordinary business expenses (Schedule C line 27a) when membership serves the business. Eligibility needs the organization type and its role in your business; a facility used exclusively in the business, such as space you rent to train clients, is a rent question rather than a dues question.'),
  added('gifts-274b', '26 USC 274(b) — Business gifts limited to $25 per recipient per year', codeUrl(274), 'Current Code; selected rule; Schedule C line 27a',
    'Gifts to clients, referral sources or vendors are deductible only up to $25 per recipient per year (Schedule C line 27a); items costing $4 or less with your business name permanently imprinted and distributed widely, and signs or displays used on the recipient\'s premises, fall outside the cap. Common false positives: gifts to family or friends, gift cards used personally, and event tickets given away, which follow the entertainment disallowance. Eligibility needs the recipient, the business relationship, the cost and the date.'),
  added('phone-internet-262', '26 USC 262(b) — Telephone and internet: business-use allocation', codeUrl(262), 'Current Code; selected rule with Publication 334 ch. 8; Schedule C line 25',
    'Phone and internet plans are usually mixed use: only the documented business share of the bill is deductible (Schedule C line 25), and the basic local charge for the first landline into your home is personal by statute. Cell phones stopped being listed property in 2010 (P.L. 111-240 amended §280F), so no trip-style log is required, but deducting a full family or single personal plan is a common false positive. Eligibility needs the recorded business-use percentage or a dedicated business line and the monthly statement.',
    'Removal of cellular telephones from §280F(d)(4) confirmed in the amendment notes of the current uscode.house.gov text on 2026-09-17.'),
  added('startup-195', '26 USC 195 — Start-up expenditures', codeUrl(195), 'Current Code; $5,000 first-year election reduced above $50,000; 180-month amortization',
    'Costs paid before the business actually began operating (market research, pre-opening advertising, training, travel to line up suppliers, formation-related consulting) are start-up costs rather than current expenses: up to $5,000 may be deducted in the first active year, reduced dollar-for-dollar once total start-up costs exceed $50,000, and the rest is amortized over 180 months beginning with the month the business begins. Common false positive: deducting pre-opening spending as an ordinary expense in the year paid. Eligibility needs the business start date, the nature of the cost and the total pre-opening spending.'),
  added('professional-fees-334', 'IRS Publication 334, ch. 8 — Legal and professional fees', PUB_334, '2025 publication; Schedule C line 17',
    'Fees to attorneys, accountants, bookkeepers, consultants and tax preparers that are ordinary and directly related to operating the business are deductible (Schedule C line 17); for tax preparation only the part attributable to the business schedules counts, fees to acquire a business asset are added to its basis, and pre-opening fees are start-up costs. Common false positives: personal legal matters such as wills, divorce or personal injury, the personal part of a return fee, and fees for buying a personal residence. Eligibility needs the matter or service and its link to the business.'),
  added('taxes-licenses-sch-c', 'Instructions for Schedule C — Line 23 taxes and licenses; nondeductible federal and self-employment tax', 'https://www.irs.gov/instructions/i1040sc', '2025 instructions; selected rule with §164(f) and §275',
    'Business licenses, permits and regulatory fees paid to state or local governments, sales tax you collected and included in receipts, personal property tax on business assets and the employer share of payroll taxes are deductible on Schedule C line 23. Federal income tax, estimated tax payments and self-employment tax are never Schedule C expenses (§275); one-half of self-employment tax is a Schedule 1 adjustment under §164(f), and state income tax is a personal itemized deduction. Eligibility needs the government payee and what the payment was for.'),
  added('mileage-rates', 'IRS standard mileage rates — annual notices (dated rate table in lib/tax-rules/mileage-rates.ts)', 'https://www.irs.gov/tax-professionals/standard-mileage-rates',
    `IRS notice per period; ${BUSINESS_STANDARD_MILEAGE_RATES.length} dated rate periods on file (${mileageYears}); Schedule C line 9`,
    'The optional standard mileage rate is set by IRS notice for each period and applied by this app from its dated rate table, so never state a per-mile rate or compute a vehicle deduction in this analysis. Standard mileage replaces fuel, repairs, insurance, depreciation and lease payments for the same miles (parking and tolls stay separately deductible), must be chosen in the first year the vehicle is used for business, and cannot follow accelerated depreciation or Section 179 on the same vehicle. Either method requires §274(d) records for each trip: date, miles, destination and business purpose; commuting and personal driving are excluded.',
    'Rates and their notices (Notice 2025-5 for 2025; Notice 2026-10 and Announcement 2026-11 for 2026) live in lib/tax-rules/mileage-rates.ts and are never restated here.'),
  added('supplies-263a', 'Treas. Reg. §1.263(a)-1(f) — Supplies and the de minimis safe harbor', 'https://www.ecfr.gov/current/title-26/section-1.263(a)-1', 'Current eCFR text; $2,500 per item or invoice without an applicable financial statement; Schedule C line 22',
    'Consumable supplies, materials and small tools used up within the year are current expenses (Schedule C line 22). A unit of property that lasts beyond the year is a capital asset unless the de minimis safe harbor election is made on a timely return for that year, which lets items costing $2,500 or less per item or invoice be expensed; without the election, items over the threshold or durable equipment need depreciation or Section 179 review. Eligibility needs the item, its cost per unit and whether the annual election statement is being filed.'),
  added('rent-334', 'IRS Publication 334, ch. 8 — Rent expense (business property vs. your home)', PUB_334, '2025 publication; Schedule C lines 20a/20b; home rent only through §280A',
    'Rent for property you use in the business but do not own — an office, studio, chair or booth, storage unit or coworking desk — is deductible when paid (Schedule C line 20b; equipment and vehicle rentals on line 20a). Rent for the home you live in is not business rent even if you work there; only a qualifying home office deduction (§280A, Form 8829 or the simplified method) can include part of it, and payments that build equity or are really purchases are not rent. Eligibility needs the location, what it is used for and the lease or booth agreement.'),
  added('utilities-334', 'IRS Publication 334, ch. 8 — Utilities for a business location', PUB_334, '2025 publication; Schedule C line 25',
    'Electricity, gas, water, trash and similar utilities for a separate business location are deductible on Schedule C line 25. Utilities for your home are personal except the business percentage claimed through a qualifying home office (Form 8829 actual-expense method; the simplified method already includes them), and phone or internet bills follow the business-use allocation rule instead. Eligibility needs the service address and whether it is a business location or your residence.'),
] as const;
export const TRANSACTION_EVIDENCE_IDS = TRANSACTION_TAX_EVIDENCE.map(item => item.id);

/**
 * Evidence that must back a completed or suggested category. The first entry is the
 * category-specific rule the server attaches so users see the applicable source even
 * when the model cited only the general §162 rule.
 */
export const CATEGORY_EVIDENCE: Record<ExpenseCategory, readonly string[]> = {
  advertising_marketing: ['advertising-334', 'business-162'],
  supplies_small_tools: ['supplies-263a', 'business-162', 'capital-263'],
  software_subscriptions: ['software-334', 'business-162'],
  contract_labor: ['contract-labor-334', 'information-returns-6041', 'business-162'],
  equipment: ['assets-946', 'capital-263', 'supplies-263a'],
  // §162 stays applicable: parking and tolls on a business trip are ordinary expenses that models correctly cite under it.
  vehicle_expense: ['travel-463', 'mileage-rates', 'business-162'],
  // Deductible in addition to the standard mileage rate (Pub 463); commuting parking is personal.
  parking_tolls: ['travel-463', 'business-162', 'mileage-rates'],
  travel: ['travel-463'],
  meals_50: ['meals-274'],
  home_office: ['home-587'],
  utilities_phone_internet: ['phone-internet-262', 'utilities-334', 'business-162'],
  education_training: ['education-reg-1.162-5', 'business-162'],
  dues_and_memberships: ['dues-274a3', 'business-162'],
  bank_and_payment_fees: ['bank-fees-334', 'platform-fees-1099k', 'business-162'],
  rent: ['rent-334', 'business-162', 'home-587'],
  insurance: ['insurance-334', 'business-162'],
  legal_professional: ['professional-fees-334', 'business-162'],
  taxes_licenses: ['taxes-licenses-sch-c', 'business-162'],
  // §263 leads: the repair-versus-improvement test is the rule a repair approval must survive, then §162 applies.
  repairs_maintenance: ['capital-263', 'business-162'],
  other: ['business-162', 'startup-195', 'professional-fees-334', 'taxes-licenses-sch-c', 'insurance-334', 'gifts-274b'],
};
/** Vehicle purchases/financing cite asset rules; operating costs cite the travel and mileage rules. */
const VEHICLE_PURCHASE_EVIDENCE = ['assets-946', 'capital-263', 'travel-463', 'mileage-rates'] as const;
/** Schedule C line per expense category (2025 Instructions for Schedule C); a matching merchant entry can refine it. */
export const CATEGORY_SCHEDULE_C_LINE: Record<ExpenseCategory, string | null> = {
  advertising_marketing: '8', supplies_small_tools: '22', software_subscriptions: '18', contract_labor: '11', equipment: '13',
  vehicle_expense: '9', parking_tolls: '9', travel: '24a', meals_50: '24b', home_office: '30', utilities_phone_internet: '25', education_training: '27a',
  dues_and_memberships: '27a', bank_and_payment_fees: '10', rent: '20b', insurance: '15', legal_professional: '17', taxes_licenses: '23',
  repairs_maintenance: '21', other: null,
};

/** Code sections, regulations and publications a model may name in prose, and the evidence IDs that back each. */
const SECTION_EVIDENCE: Record<string, readonly string[]> = {
  '162': ['business-162', 'software-334', 'advertising-334', 'contract-labor-334', 'education-reg-1.162-5', 'insurance-334', 'bank-fees-334', 'professional-fees-334', 'rent-334', 'utilities-334'],
  '262': ['personal-262', 'phone-internet-262'],
  '274': ['meals-274', 'dues-274a3', 'gifts-274b', 'mileage-rates'],
  // Employer-provided meals: §119(a) and §132(e) are cross-referenced by §274(o) and backed by the meals rule.
  '119': ['meals-274'], '132': ['meals-274'],
  '263': ['capital-263', 'supplies-263a'],
  '179': ['assets-946'], '168': ['assets-946'], '280f': ['assets-946', 'phone-internet-262'],
  '280a': ['home-587', 'rent-334'],
  '195': ['startup-195'],
  '6041': ['information-returns-6041'], '6050w': ['information-returns-6041', 'platform-fees-1099k'],
  '164': ['taxes-licenses-sch-c'], '275': ['taxes-licenses-sch-c'],
};
const REGULATION_EVIDENCE: Record<string, readonly string[]> = {
  '1.162-5': ['education-reg-1.162-5'],
  '1.263(a)-1': ['supplies-263a'],
};
const PUBLICATION_EVIDENCE: Record<string, readonly string[]> = {
  '463': ['travel-463', 'mileage-rates'], '946': ['assets-946'], '587': ['home-587'],
  '334': ['records-334', 'software-334', 'advertising-334', 'contract-labor-334', 'insurance-334', 'bank-fees-334', 'professional-fees-334', 'rent-334', 'utilities-334'],
};
/**
 * Statute, regulation and publication references in model prose that none of the selected
 * evidence IDs supports (for example "§199A", "Pub 535" or a section outside the packet).
 */
export function uncitedReferences(text: string, evidenceIds: readonly string[]): string[] {
  const missing: string[] = [];
  const normalized = text.normalize('NFKC');
  const backed = (ids: readonly string[] | undefined) => ids?.some(id => evidenceIds.includes(id)) === true;
  for (const match of normalized.matchAll(/(?:\bsections?\s+|§+\s*)(\d+(?:\.\d+)?[A-Za-z]?(?:\([A-Za-z0-9]+\))*(?:-\d+[A-Za-z]?)?)/gi)) {
    const reference = match[1].toLowerCase();
    const supported = reference.includes('.') ? REGULATION_EVIDENCE[reference] : SECTION_EVIDENCE[reference.replace(/\(.*$/, '')];
    if (!backed(supported)) missing.push(`§${match[1]}`);
  }
  for (const match of normalized.matchAll(/\bpub(?:lication)?\.?\s+(\d+[A-Za-z]?)\b/gi)) {
    if (!backed(PUBLICATION_EVIDENCE[match[1].toLowerCase()])) missing.push(`Pub ${match[1]}`);
  }
  return missing;
}

export function transactionTaxYear(transaction: TransactionInput): number | null {
  const date = transaction.date_iso || transaction.date || '';
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(date)) return null;
  const instant = new Date(date);
  const day = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(instant.getTime()) && day.toISOString().slice(0, 10) === date.slice(0, 10) ? Number(date.slice(0, 4)) : null;
}

export function transactionTaxPolicyPrompt(transaction: TransactionInput): string {
  return `TRUSTED SERVER TAX POLICY ${TRANSACTION_TAX_POLICY_VERSION}
Transaction tax year: ${transactionTaxYear(transaction) ?? 'unknown'}. Jurisdiction: US federal only.
Supported scope: selected 2025 and 2026 self-employed sole-proprietor/disregarded single-member LLC transactions. Categorize other transactions where possible but withhold a tax determination. Do not calculate state tax, complete returns, corporate/partnership treatment, annual limits, 2027 treatment or asset elections.
Use only the following evidence IDs for legal claims. Select up to three applicable IDs in evidence_ids, preferring the category-specific entry (for example software-334 for a software subscription, dues-274a3 for dues, mileage-rates for fuel or mileage) over business-162 alone; the server rejects evidence that does not fit the category. Return irs_refs=null; the server resolves titles and URLs. Do not invent sources, publication editions, Code sections, rates, deduction amounts or audit probabilities.
${TRANSACTION_TAX_EVIDENCE.map(item => `${item.id} | ${item.title} | ${item.edition}\n${item.rule}`).join('\n\n')}`;
}

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function contextText(tx: TransactionInput) {
  return [tx.business_purpose, tx.note, tx.notes, tx.description, tx.client_project, tx.meeting_notes].map(text).filter(Boolean).join(' ');
}
const descriptorKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
/**
 * Text the user typed. Imports copy the bank descriptor into the note, so a descriptor that
 * merely repeats the merchant or Plaid name never counts as a saved business purpose.
 */
export function userPurposeText(tx: TransactionInput): string {
  const descriptors = new Set([tx.merchant, tx.merchant_name, tx.description].map(text).filter(Boolean).map(descriptorKey));
  return [tx.business_purpose, tx.note, tx.notes, tx.client_project, tx.meeting_notes].map(text)
    .filter(value => value && !descriptors.has(descriptorKey(value))).join(' ');
}
/** A stated purpose of at least a short sentence (four words), rather than a label such as "Client snacks". */
export function isStatedSentence(value: string): boolean {
  return value.trim().length >= 16 && (value.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) >= 4;
}
/** One-tap confirmation of the merchant table's default purpose; acronyms such as "AI" keep their case. */
export function proposedPurposeQuestion(merchant: MerchantIntelligenceResult): string {
  const purpose = merchant.defaultPurpose ?? '';
  const phrased = /^[A-Z][a-z]/.test(purpose) ? purpose.charAt(0).toLowerCase() + purpose.slice(1) : purpose;
  return `Is this ${merchant.name} charge your ${phrased}? Confirm or edit the purpose.`;
}
/** Retain a little item context, never an earlier model tax conclusion, after a policy gate. */
function categoryContext(input: OutputType, transaction: TransactionInput): string | null {
  if (input.transaction_kind !== 'expense' || !input.category || input.category === 'other' ||
      !(transaction.amount_usd > 0)) return null;
  const genericWords = new Set(['this', 'that', 'these', 'your', 'their', 'from', 'with', 'which', 'have', 'been',
    'business', 'purchase', 'purchased', 'expense', 'transaction', 'recorded', 'notes', 'purpose', 'used', 'work']);
  const words = (value: string) => value.toLowerCase().match(/[a-z]{4,}/g)?.filter(word => !genericWords.has(word)) ?? [];
  // This overlap is only a relevance filter, not a factual or tax-eligibility verification.
  const recordedWords = new Set(words(contextText(transaction)));
  if (recordedWords.size < 2) return null;
  const taxOrOutcome = /\b(?:tax\w*|deduct\w*|write\w*|writing|written|wrote|expens\w*|claim\w*|eligib\w*|qualif\w*|approv\w*|allow\w*|permit\w*|entitl\w*|complian\w*|exempt\w*|credit\w*|sav(?:e|es|ed|ing|ings)|refund\w*|reduc\w*|offset\w*|income|profit\w*|earnings|liabilit\w*|limit\w*|percent\w*|portion|allocat\w*|basis|capitaliz\w*|deprecia\w*|bonus|election\w*|irs|audit\w*|section|publication|schedule|federal|state|return\w*|guarantee\w*|definite\w*|certain\w*|always|never|automatic\w*|completely|fully|entire\w*|exclusiv\w*|only|all|ordinary|necessary|dollars?|cents?|usd|meets?|satisf\w*|requirements?|tests?|legal\w*|lawful\w*|authoriz\w*|substantiat\w*|verified|validated|establish\w*|proof|proves?|protect\w*|safe\w*|risk\w*|conclusiv\w*)\b|[\p{N}$€£¥%§]/iu;
  for (const explanation of [input.customized_reason, input.key_analysis_factor, input.reasoning_summary]) {
    for (const part of text(explanation).split(/(?<=[.!?])\s+|\n+/u)) {
      const sentence = part.replace(/^About this purchase:\s*/i, '').trim();
      const normalized = sentence.normalize('NFKC').replace(/[\u2010-\u2015]/g, '-');
      // Keep one short, declarative sentence. Ambiguous claims and numerical/legal
      // statements use the existing policy-only explanation instead.
      if (sentence.length < 16 || sentence.length > 240 || /\?/.test(sentence) || taxOrOutcome.test(normalized) ||
          /^(?:keep|save|attach|upload|confirm|review|provide|add|check|record|retain|ensure|consider|please|answer)\b/i.test(normalized)) continue;
      const sharedWords = new Set(words(sentence).filter(word => recordedWords.has(word)));
      if (sharedWords.size >= 2) return sentence;
    }
  }
  return null;
}
function percentage(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/**
 * Item-recognition patterns used only to trigger additional review, never to approve.
 * Model text may feed them because asking a question is safe; approving is not.
 */
const HEALTH_INSURANCE_PATTERN = /\b(?:health|medical|dental|vision|long-?term\s+care)\s+(?:insurance|premiums?|plan|coverage)\b|\b(?:blue\s?cross|blue\s?shield|aetna|cigna|kaiser|unitedhealth(?:care)?|humana|oscar\s+health|anthem|ambetter|molina|healthcare\.gov)\b/i;
const CLUB_DUES_PATTERN = /\b(?:gym|fitness\s+(?:center|club|membership)|health\s+club|athletic\s+club|country\s+club|golf\s+club|planet\s+fitness|equinox|crossfit|orangetheory|la\s+fitness|24\s+hour\s+fitness|peloton|soulcycle|barry'?s\s+bootcamp)\b/i;
const HOME_RENT_PATTERN = /\b(?:apartment|apt\.?|home|house|residence|residential|landlord|housing|mortgage|rent\s+for\s+(?:my|our)\s+place)\b/i;
/** Payments to tax authorities are never Schedule C expenses (federal income and SE tax are nondeductible; state income tax belongs on Schedule A). */
const TAX_AUTHORITY_PATTERN = /\b(?:IRS|internal revenue|us treasury|u\.s\. treasury|usataxpymt|irs usataxpymt|estimated tax|1040-?es|form 1040|franchise tax b(?:oar)?d|\bftb\b|nys dtf|ny state tax|dept\.? of revenue|department of revenue|dept\.? of taxation|department of taxation|comptroller of|state tax payment|tax payment|edd|eftps)\b/i;
/** Federal payees and the individual-payment descriptors: always the tax-payment block, whatever the saved words say. */
const FEDERAL_TAX_AUTHORITY_PATTERN = /\b(?:IRS|internal revenue|us treasury|u\.s\. treasury|usataxpymt|1040-?es|form 1040|eftps|estimated tax)\b/i;
/** Business taxes remitted to a state or local agency: sales/use tax collected on sales and employer payroll taxes (Schedule C line 23). */
const BUSINESS_TAX_REMITTANCE_PATTERN = /\b(?:sales\s+(?:and\s+use\s+)?tax|use\s+tax|seller'?s?\s+permit|sales\s+tax\s+(?:remit\w*|return|filing)|payroll\s+tax(?:es)?|unemployment\s+(?:insurance|tax)|\bsuta\b|\bsui\b|employer\s+(?:share|portion|tax(?:es)?)|form\s+94[01]|withholding\s+deposit)\b/i;
/** Words that mark a payment as the taxpayer's own income or self-employment tax, which no saved purpose can turn into an expense. */
const INCOME_TAX_WORDS = /\b(?:income\s+tax|estimated\s+tax|self[- ]employment\s+tax|\bse\s+tax|quarterly\s+(?:tax|estimate)|1040|schedule\s+se|tax\s+bill|balance\s+due|extension\s+payment)\b/i;
/** Property tax: on the home it is a home-office item (Form 8829); on business assets or a business location it is line 23. */
const PROPERTY_TAX_PATTERN = /\b(?:property\s+tax(?:es)?|real\s+estate\s+tax(?:es)?|county\s+(?:tax\s+collector|treasurer|assessor)|tax\s+collector|personal\s+property\s+tax)\b/i;
const BUSINESS_PROPERTY_WORDS = /\b(?:equipment|machinery|inventory|business\s+(?:property|assets?|vehicle|truck|van|location|building)|studio|shop|warehouse|office\s+building|commercial|storefront|work\s+(?:truck|van|vehicle))\b/i;
/** Vehicle operating costs filed under another category still need the vehicle-method review (Pub 463). */
const VEHICLE_COST_PATTERN = /\b(?:auto|car|vehicle|truck|van|suv)\s+(?:insurance|premium|policy|registration|repair|repairs|maintenance|wash|payment|loan)\b|\b(?:geico|progressive|state farm auto|allstate|oil change|jiffy lube|tires?|autozone|o'?reilly auto|pep boys|dmv|smog check|car wash|commercial auto|brake (?:job|pads|repair|replacement)|transmission (?:repair|rebuild|flush)|wheel alignment)\b/i;
/** Parking and tolls on a business trip are deductible in addition to the standard mileage rate (Pub 463) and need no method review. */
const PARKING_TOLL_PATTERN = /\b(?:parking|parkmobile|spothero|paybyphone|laz parking|impark|parkwhiz|toll|tolls|tollway|e-?z\s?pass|fastrak|sunpass|txtag|peach pass|i-?pass|turnpike|thruway)\b/i;
/** Fines, tickets and penalties paid to a government are not expenses; a bare "ticket" (a plane ticket) is not a penalty. */
const PENALTY_PATTERN = /\b(?:parking|traffic|speeding|toll|red[- ]light|camera|moving)\s+(?:ticket|violation|citation|fine)s?\b|\b(?:violation|citation)\s+(?:notice|fee|payment)\b|\b(?:fine|penalt(?:y|ies))\s+(?:for|paid|notice|assessed)\b|\blate[- ](?:filing|payment)\s+penalt\w*/i;
/** The taxpayer's own word for the regular drive to a workplace; Pub 463 treats that parking and those tolls as personal. */
const COMMUTING_PATTERN = /\bcommut\w*\b/i;
const NEGATED_COMMUTING_PATTERN = /\b(?:not?|non|never|isn't|wasn't|instead\s+of|rather\s+than)[- ]?(?:a\s+|my\s+|the\s+)?commut\w*/i;
/** Auto words that keep a premium or repair on the vehicle-method review even when business coverage words appear. */
const AUTO_WORDS = /\b(?:auto|car|vehicle|truck|van|suv|rideshare)\b/i;
/** A repair whose saved words name the vehicle or a drivetrain part is a vehicle cost (Pub 463), not a line 21 repair. */
const VEHICLE_NOUNS = /\b(?:auto|car|vehicle|truck|van|suv|pickup|engine|transmission|brakes?|tires?|windshield|alternator|radiator)\b/i;
/**
 * Tax return preparation is deductible only for the business schedules (Rev. Rul. 92-29; Pub 334). Brand names and
 * return-preparation phrases only: a CPA's bookkeeping or an accountant's advisory fee is an ordinary professional fee.
 */
const TAX_PREP_PATTERN = /\b(?:h&r block|hrblock|turbotax|taxact|taxslayer|freetaxusa|jackson hewitt|liberty tax|tax prep(?:aration|arer)?|tax[- ]return\s+(?:prep\w*|fee|service|filing)|tax\s+filing\s+(?:fee|service|software)|(?:prepar\w+|fil(?:e|ed|ing))\s+(?:my|our|the)\s+(?:tax(?:es)?|return|1040)|(?:personal|individual)\s+(?:income\s+)?(?:tax\s+)?returns?|(?:my|our)\s+(?:1040|tax\s+returns?)|schedule\s+c\s+(?:prep\w*|filing)|tax\s+software)\b/i;
/** Words that name a legal, accounting or advisory service; with a personal matter they mark a personal fee. */
const PROFESSIONAL_SERVICE_WORDS = /\b(?:attorney|lawyer|law\s+(?:firm|office|group)|legal|esq\.?|paralegal|cpa|accountant|accounting|bookkeep\w*|consultant|advisor|tax\s+prep\w*|notary)\b/i;
/**
 * Personal legal and tax matters (Pub 334: wills, divorce, personal injury, a personal return, buying a residence). A fee
 * naming one of these is personal whatever account paid it; "personal return" is personal only without business schedules.
 */
const PERSONAL_LEGAL_MATTER_PATTERN = /\b(?:divorce|custody|child\s+support|alimony|prenup\w*|estate\s+plan\w*|(?:my|our)\s+will\b|will\s+(?:and|&)\s+trust|living\s+trust|personal\s+injury|dui|dwi|speeding\s+ticket|traffic\s+(?:ticket|court)|criminal\s+(?:defense|charge)|immigration\s+(?:attorney|lawyer|filing|case)|buying\s+(?:a|my|our)\s+(?:house|home|condo)|(?:my|our)\s+(?:house|home)\s+(?:purchase|closing)|residential\s+closing)\b/i;
const PERSONAL_RETURN_PATTERN = /\bpersonal\s+(?:tax\s+)?(?:return|taxes|1040)\b/i;
const BUSINESS_SCHEDULE_WORDS = /\b(?:schedule\s+c|schedule\s+se|business\s+(?:schedule|return|forms?|portion|share|taxes)|1099|llc|self[- ]employ\w*)\b/i;
/** State filings and licences a filing service may collect on the taxpayer's behalf (line 23), as opposed to its own service fee (line 17). */
const STATE_FILING_PATTERN = /\b(?:annual\s+report|biennial\s+report|statement\s+of\s+information|secretary\s+of\s+state|business\s+licen[cs]e|licen[cs]e\s+(?:renewal|fee)|(?:professional|state|nursing|real\s+estate|cosmetology|contractor'?s?|insurance|notary)\s+licen[cs]e|permit\s+fee|(?:city|county|state)\s+permit|llc\s+(?:annual|renewal|fee|tax|filing\s+fee)|franchise\s+tax|registration\s+fee|sales\s+tax\s+permit|dba\s+filing|fictitious\s+(?:business\s+)?name)\b/i;
/** Business coverage types (Pub 334: liability, professional/E&O, property, workers' compensation, business interruption, bonds). */
const BUSINESS_COVERAGE_PATTERN = /\b(?:general\s+liability|liability|e\s*&\s*o|errors?\s+(?:and|&)\s+omissions?|professional\s+(?:liability|indemnity|insurance|coverage)|malpractice|cyber|business\s+(?:owner'?s?|property|interruption|insurance|policy|coverage|liability)|\bbop\b|commercial\s+(?:property|general\s+liability|liability|insurance|policy)|workers'?\s+comp(?:ensation)?|surety|bond|equipment\s+(?:insurance|coverage|policy|floater)|inland\s+marine|product\s+liability|event\s+insurance|studio\s+insurance)\b/i;
/** A policy on the home the taxpayer lives in counts only through a qualifying home office (Form 8829). */
const HOME_INSURANCE_PATTERN = /\b(?:homeowner'?s?|renter'?s?|renters|home|house|condo|dwelling|residential|apartment)\s+(?:insurance|policy|premium|coverage)\b/i;
/** Life, disability, accident and pet coverage on the taxpayer or the household is personal (Pub 334); long-term care follows the health rule. */
const PERSONAL_COVERAGE_PATTERN = /\b(?:life|disability|term\s+life|whole\s+life|accident|pet)\s+(?:insurance|policy|premium|coverage)\b/i;
/** The taxpayer's own words for fixing existing property, used only to place a model's "other" in the repairs category. */
const REPAIR_WORDS = /\b(?:repair\w*|fix(?:ed|ing|es)?|servic(?:e|ed|ing)\s+(?:call|visit|fee|appointment)|maintenance|tune-?ups?|calibrat\w*|patch(?:ed|ing)?|mend(?:ed|ing)?)\b/i;
/** "Website maintenance" and "software maintenance plan" are office or software costs, not line 21 repairs. */
const NON_PROPERTY_MAINTENANCE = /\b(?:website|web\s*site|software|hosting|domain|app|plugin|theme|subscription)\b/i;
/** Repairs to the home the taxpayer lives in are home-office items (Form 8829), never line 21. */
const HOME_REPAIR_PATTERN = /\b(?:my|our)\s+(?:home|house|apartment|apt|condo|residence|kitchen|bathroom|bedroom|basement|garage|roof|yard|lawn|driveway)\b|\b(?:home|house|residential)\s+(?:repair|maintenance|improvement|remodel)\w*\b|\bhome\s+office\b/i;
/** Betterments, restorations and whole-unit replacements can be capital improvements (§263) rather than repairs. */
const IMPROVEMENT_PATTERN = /\b(?:improv\w+|remodel\w*|renovat\w*|upgrad\w+|rebuil\w+|overhaul\w*|restor(?:e|ed|ation)|betterment|addition|new\s+(?:roof|hvac|furnace|engine|transmission|flooring|floors?|windows|unit|system|compressor)|replac\w+\s+(?:\w+\s+){0,2}?(?:roof|hvac|furnace|water\s+heater|engine|transmission|flooring|floors?|windows|unit|system|machine|equipment|laptop|computer|camera|printer|monitor|appliance|compressor))\b/i;
/** A saved purpose describing space rented to serve clients is business rent, not club dues. */
const CLUB_BUSINESS_USE_PATTERN = /\b(?:rent(?:al|ed)?|leas(?:e|ed|ing)|space rental|studio rental)\b/i;
/** Certainty claims the model must not make in any displayed field ("it's fully deductible", "would be 100% deductible", "is completely deductible"). */
const UNCONDITIONAL_CLAIM = /\b((?:(?:is|are|it's|its|was|were|be|being|been|becomes?|remains?|would be|will be|can be|should be|considered|deemed|qualif(?:y|ies) as|treated as|counts? as)\s+(?:\w+\s+){0,2})?)(?:fully|100\s?%|completely|entirely|wholly)\s+(?:tax[- ])?deductible\b/i;
/**
 * The taxpayer's own note saying an item was personal outranks any merchant or profession prior.
 * A negated phrase ("not for personal use", "zero personal use") and a business object
 * ("vacation rental", "vacation photography", "paid vacation") are not personal notes.
 */
const EXPLICIT_PERSONAL_NOTE = /\b(?:(?<!\b(?:not?|zero|without|never|excludes?|excluding)\s+(?:for\s+|any\s+|of\s+)?)personal (?:use|expense|purchase|item|trip|dinner|meal|coffee|ride|subscription|only)|not (?:for )?(?:the )?business|non-?business|not deductible|not a business expense|family (?:dinner|trip|vacation|meal|purchase)|(?<!\bpaid\s)vacation(?!\s+(?:rental|rentals|home|homes|propert(?:y|ies)|photograph\w*|pay|payroll|package\w*|planning|tours?|clients?|business|listing))|date night|for (?:my|our) (?:kids?|family|wife|husband|spouse|partner)|for (?:my|our) (?:home|house)(?! office| studio| workspace| business|-based| based)|my own use|my (?:morning|daily|usual) coffee|coffee before work|(?:coffee|lunch|dinner|breakfast|meal) (?:by myself|alone|on my own)|(?:solo|my own) (?:coffee|lunch|dinner|breakfast|meal))\b/i;
/** Saved wording that establishes business income for a credit (a customer payment, an invoice, a platform payout). */
const INCOME_CONTEXT = /\b(client|customer|invoice|business sales|service revenue|platform payout)\b/i;
const LIKELY_ASSET_PATTERN = /\b(?:laptop|computer|macbook|imac|desktop|monitor|camera|lens|drone|printer|tablet|ipad|iphone|smartphone|desk|chair|tripod|microphone|mixer|guitar|piano|keyboard|server|router|projector|television|appliance|machine|equipment|furniture|tools?)\b/i;
/**
 * Specific durable items the model itself names. The category words ("supplies and small tools", "equipment",
 * "durable tool") are excluded: a model restating the category is not evidence that an asset was bought
 * (live round 4: $312 of lumber and fasteners was sent to asset review because the prose said "small tools").
 */
const LIKELY_ASSET_ITEM_PATTERN = /\b(?:laptop|computer|macbook|imac|desktop|monitor|camera|lens|drone|printer|tablet|ipad|iphone|smartphone|desk|chair|tripod|microphone|mixer|guitar|piano|keyboard|server|router|projector|television|appliance|machine|furniture)\b/i;
/** Reg. §1.263(a)-1(f)(1)(ii)(D): per-item/per-invoice ceiling for taxpayers without an applicable financial statement. */
export const DE_MINIMIS_ITEM_CEILING = 2500;
/** Below this amount an ordinary supply is not second-guessed even when it names a durable item. */
/** Reg. §1.162-3(c)(1)(iv): items costing $200 or less are materials and supplies; a durable item above that needs the de minimis election or depreciation. */
const ASSET_REVIEW_FLOOR = 200;

/**
 * Digits shaped like an SSN, ITIN or EIN inside free text, including unformatted nine-digit runs
 * and dotted or unicode-dash spellings; bank descriptors and notes never need them. Amounts survive.
 */
export function redactTaxIdentifiers(value: string): string {
  return redactIdentifierText(value).text;
}

/** Reject forged citations/contradictions; withhold eligibility when known gates require facts. */
export function groundTransactionAnalysis(
  input: OutputType, transaction: TransactionInput, context: UserContext | undefined, model: string,
): OutputType | null {
  const result: OutputType = { ...input };
  // Server-owned; a caller or model never supplies them.
  delete result.proposed_purpose; delete result.schedule_c_line;
  const ids = result.evidence_ids ?? [];
  if (!Array.isArray(ids) || !ids.length || ids.length > 3 || ids.some(id => !TRANSACTION_EVIDENCE_IDS.includes(id)) || new Set(ids).size !== ids.length) return null;
  const year = transactionTaxYear(transaction);
  const amount = transaction.amount_usd ?? transaction.amount;
  let kind = result.transaction_kind ?? 'unknown';
  result.transaction_kind = kind;
  const explanation = [result.customized_reason, result.reasoning_summary, result.key_analysis_factor].filter(Boolean).join(' ');
  // A model cannot smuggle arbitrary source links or imply a computed percentage unsupported by the fields.
  if (/https?:\/\//i.test(explanation)) return null;
  const uncited = uncitedReferences(explanation, ids);
  if (uncited.length) {
    // An approval must rest on the rules it names. A question-only answer that mentions a known
    // section ("Section 179") cites the packet rule for it instead of failing the whole analysis.
    if (result.status === 'ok') return null;
    for (const reference of uncited) {
      const key = reference.replace(/^§|^Pub\s+/i, '').toLowerCase();
      const mapped = reference.startsWith('Pub') ? PUBLICATION_EVIDENCE[key] : key.includes('.') ? REGULATION_EVIDENCE[key] : SECTION_EVIDENCE[key.replace(/\(.*$/, '')];
      if (!mapped?.length) return null;
      if (!ids.includes(mapped[0])) ids.push(mapped[0]);
    }
  }
  if (result.status === 'ok' && (result.is_deductible === true && result.expense_type !== 'business' ||
      kind === 'personal' && (result.expense_type !== 'personal' || result.is_deductible !== false) ||
      ['income', 'transfer'].includes(kind) && result.is_deductible !== false)) return null;
  const saved = contextText(transaction);
  // Saved context, merchant descriptor and the model's own item description. Only review
  // gates read this; nothing here can approve a deduction.
  const savedAndMerchant = `${saved} ${text(transaction.merchant)} ${text(transaction.merchant_name)}`;
  const reviewText = `${savedAndMerchant} ${explanation}`;
  const itemContext = categoryContext(input, transaction);
  // Merchant and profession intelligence choose the gate and its question; they never approve.
  const merchant = merchantIntelligence(transaction);
  const priors = matchProfessions(context?.profession);
  const hint = professionHint(priors, merchant.subtype);
  /** The profession's reading of this merchant, else the merchant's own question when it fits the proposed category. */
  const targetedQuestion = (category: string | undefined) =>
    hint?.question ?? (merchant.category !== null && merchant.category === category ? merchant.question : null);
  const purpose = userPurposeText(transaction);
  // Personal-leaning merchants and payment apps need a stated sentence, not a two-word label.
  const purposeMissing = purpose.length < 8 ||
    (['personal_likely', 'transfer_or_deposit'].includes(merchant.disposition) && !isStatedSentence(purpose));
  // --- Line placement (2026-09-18.3). A model's "other" is placed on the confirmable Schedule C line that a
  // high-confidence merchant match or the taxpayer's own words name. Placement is bookkeeping, never approval:
  // every gate below still runs on the placed category, and only the taxpayer's words (never the bank
  // descriptor) can move a payment away from the tax-authority block.
  const taxPrep = TAX_PREP_PATTERN.test(savedAndMerchant) || merchant.subtype === 'tax_prep';
  const propertyTax = PROPERTY_TAX_PATTERN.test(savedAndMerchant);
  const federalPayee = FEDERAL_TAX_AUTHORITY_PATTERN.test(savedAndMerchant);
  /**
   * A business tax in the taxpayer's own words — sales/use tax collected on sales, employer payroll tax, property tax on
   * business property — remitted to a state or local agency, with no income-tax words. Federal payees never qualify.
   */
  const remittedBusinessTax = !federalPayee && !INCOME_TAX_WORDS.test(purpose) &&
    (BUSINESS_TAX_REMITTANCE_PATTERN.test(purpose) || (PROPERTY_TAX_PATTERN.test(purpose) && BUSINESS_PROPERTY_WORDS.test(purpose)));
  /** A licence, permit or state filing fee paid to a payee that is not a tax authority. */
  const stateFilingFee = STATE_FILING_PATTERN.test(purpose) && !TAX_AUTHORITY_PATTERN.test(savedAndMerchant);
  /** The merchant table names a tax agency (IRS, a state tax agency, or Plaid's tax-payment category); a tax-prep service is not one. */
  const taxAgencyPayee = (merchant.disposition === 'not_an_expense' && /\btax\b|\bIRS\b/i.test(merchant.name ?? ''))
    || merchant.plaidCategory === 'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT';
  /** The taxpayer names a business coverage (liability, E&O, property, cyber, workers' comp) and not an auto policy. */
  const businessCoverageStated = BUSINESS_COVERAGE_PATTERN.test(purpose) && !AUTO_WORDS.test(purpose);
  /** An insurer that sells only business coverage (Hiscox, Next, Thimble, biBERK, The Hartford's small-business line). */
  const businessInsurer = merchant.category === 'insurance' && merchant.confidence === 'high' && merchant.disposition === 'business_likely';
  if (kind === 'expense' && result.expense_type !== 'personal') {
    const placeable = !result.category || result.category === 'other';
    if (placeable && merchant.confidence === 'high' && merchant.category && CONFIRMABLE_LINE_CATEGORIES.includes(merchant.category)) {
      result.category = merchant.category;
    } else if (placeable && REPAIR_WORDS.test(purpose) && !NON_PROPERTY_MAINTENANCE.test(purpose) && !VEHICLE_COST_PATTERN.test(savedAndMerchant)) {
      result.category = 'repairs_maintenance';
    }
    if (taxPrep && (!result.category || ['other', 'contract_labor', 'legal_professional', 'software_subscriptions'].includes(result.category))) {
      result.category = 'legal_professional';
    }
    if ((remittedBusinessTax || stateFilingFee) && (!result.category || ['other', 'legal_professional'].includes(result.category))) {
      result.category = 'taxes_licenses';
    }
  }
  function requireInfo(result: OutputType, field: string, question: string, reason: string, blocked = false) {
    result.status = blocked ? 'blocked' : 'needs_more_info';
    delete result.is_deductible;
    delete result.expense_type;
    delete result.deductible_percent;
    result.missing_fields = [field];
    result.questions = [question];
    // The policy limitation leads, including in compact two-line summaries.
    // Do not retain an expense rationale after the money-movement kind was rejected.
    const explanation = itemContext && result.transaction_kind === 'expense'
      ? `${reason} About this purchase: ${itemContext}` : reason;
    result.customized_reason = explanation;
    result.key_analysis_factor = reason.slice(0, 400);
    result.reasoning_summary = explanation;
    result.reason = reason;
  }
  const savedCategory = text(transaction.category).toUpperCase();
  const assetPurchase = /\b(bought|purchased?|acquired|financed|down payment|vehicle purchase|car purchase)\b/i.test(saved) || !!transaction.equipment_details;
  // Different provisions can support different aspects of the same bookkeeping
  // category. Vehicle purchase/depreciation evidence is not an operating-cost rule.
  // Kind survives an unresolved tax assessment even after expense_type is cleared.
  const categoryEvidence = result.category ? CATEGORY_EVIDENCE[result.category] : undefined;
  const applicableEvidence: readonly string[] = kind === 'personal' || result.expense_type === 'personal' ? ['personal-262', 'dues-274a3', 'taxes-licenses-sch-c', 'insurance-334', 'professional-fees-334', 'travel-463'] :
    ['income', 'refund', 'transfer'].includes(kind) ? ['records-334', 'platform-fees-1099k'] :
    kind === 'unknown' && amount <= 0 ? ['records-334', 'personal-262', 'business-162', 'platform-fees-1099k'] :
    result.category === 'vehicle_expense' && assetPurchase ? VEHICLE_PURCHASE_EVIDENCE :
    result.status !== 'ok' && (!result.category || result.category === 'other') ? [...CATEGORY_EVIDENCE.other, 'personal-262', 'records-334'] :
    categoryEvidence ?? CATEGORY_EVIDENCE.other;
  let evidenceIds = ids;
  let offCategoryCitation = false;
  if (!applicableEvidence.some(id => ids.includes(id))) {
    // Every id is a real packet source, just not the one this category rests on. Rejecting
    // outright was the main cause of dead-end "analysis failed" results in live evaluation, so the
    // category suggestion survives with the server's own citations, and nothing is approved on
    // that run: the result is forced to needs_more_info below. Explicit prose citations still fail closed.
    if (/(?:\bsection\s+|§\s*)\d|\bpub(?:lication)?\.?\s+\d/i.test(explanation)) return null;
    evidenceIds = applicableEvidence.slice(0, 2);
    offCategoryCitation = true;
  }
  // Rules a review gate names in its displayed text outrank the category rule when only three sources fit.
  const gateEvidence: string[] = [];
  const addEvidence = (id: string) => { if (!gateEvidence.includes(id)) gateEvidence.push(id); };
  /** The taxpayer's own words settle an expense as personal (§262): no deduction and no open question. */
  const markPersonal = (reason: string, factor: string) => {
    result.transaction_kind = 'personal'; kind = 'personal';
    result.expense_type = 'personal'; result.is_deductible = false; result.deductible_percent = 0; result.status = 'ok';
    addEvidence('personal-262');
    result.customized_reason = reason;
    result.reasoning_summary = reason;
    result.key_analysis_factor = factor;
    delete result.missing_fields; delete result.questions;
  };
  // Surface the category-specific rule whenever an expense category is proposed, so the
  // displayed sources name the applicable test rather than only the general §162 rule.
  const categoryRule = kind === 'expense' && categoryEvidence && categoryEvidence[0] !== 'business-162' && result.expense_type !== 'personal'
    ? (result.category === 'vehicle_expense' && assetPurchase ? VEHICLE_PURCHASE_EVIDENCE[0] : categoryEvidence[0]) : null;
  // Kind affects reporting even while eligibility is unresolved. Never let a tentative
  // model kind turn an unexplained deposit into income or a payment app into a transfer.
  // A credit from a vendor the taxpayer buys from (a software vendor, a store) is a refund or an unknown credit, never
  // income, however the saved purpose is worded ("Design software used for client branding projects" describes the
  // purchase); only platforms that pay out the taxpayer's own earnings are exempt (`paysOut`).
  const vendor = amount < 0 ? findMerchantEntry(merchantDescriptor(transaction)) : null;
  const purchaseVendorCredit = vendor !== null && vendor.disposition === 'business_likely' && vendor.category !== null && vendor.paysOut !== true;
  const savedIncomeEvidence = /^INCOME(?:_|$)|REVENUE|SALES/.test(savedCategory) ||
    (INCOME_CONTEXT.test(saved) && !purchaseVendorCredit);
  const unexplainedIncome = kind === 'income' && (amount >= 0 || !savedIncomeEvidence);
  const unexplainedRefund = kind === 'refund' && (amount >= 0 ||
    !/\b(refund|returned|reversal|rebate|reimbursement)\b/i.test(`${saved} ${transaction.merchant} ${transaction.transaction_code ?? ''}`));
  const unexplainedPersonalCredit = amount < 0 && kind === 'personal' && saved.length < 8;
  const unexplainedTransfer = kind === 'transfer' && !savedCategory.includes('TRANSFER') &&
    !/\b(between (?:my|our|own|my own|our own) accounts|own accounts?|credit card payment|internal transfer)\b/i.test(saved);
  const impossibleExpense = amount < 0 && kind === 'expense';
  if (unexplainedIncome || unexplainedRefund || unexplainedPersonalCredit || unexplainedTransfer || impossibleExpense || amount === 0) {
    kind = 'unknown'; result.transaction_kind = kind;
    requireInfo(result, 'transaction_kind', 'Was this a purchase, customer payment, refund, loan, owner contribution or movement between your own accounts?',
      'The bank record and saved context do not establish the type of money movement. Confirm its purpose before using it in tax totals.');
  }

  if (offCategoryCitation && result.status === 'ok' && result.is_deductible === true) {
    requireInfo(result, 'business_purpose', 'What did you buy or pay for, and how was it used in your business?',
      'The category is a suggestion; the tax basis the analysis relied on did not match this kind of expense, so confirm the purpose before including a deduction.');
  }
  /** An expense answer that is not a block: approved, asked about, or denied by the model. The taxpayer's words outrank all three. */
  const openExpense = kind === 'expense' && result.status !== 'blocked';
  if (openExpense && EXPLICIT_PERSONAL_NOTE.test(saved) && !/\bpersonal trainer|personal chef|personal assistant|personal brand/i.test(saved)) {
    // Live evaluation: models approved, or asked about, Zoom, Starbucks and Uber charges whose saved note said personal.
    markPersonal('Your note records this as personal, so it stays out of business deductions. Edit the note if part of it was for your business.',
      'Recorded as personal by your note.');
  }
  if (openExpense && PARKING_TOLL_PATTERN.test(savedAndMerchant) && COMMUTING_PATTERN.test(purpose) && !NEGATED_COMMUTING_PATTERN.test(purpose)) {
    // Pub 463: parking at a regular workplace and tolls on the drive there are commuting, whatever the model approved.
    addEvidence('travel-463');
    markPersonal('Your note describes commuting. Parking at a regular workplace and tolls on the drive there are personal commuting costs, so this stays out of business deductions. Edit the note if the trip was to a client, a job site or between work locations.',
      'Recorded as commuting by your note.');
  }
  /** A legal, accounting or tax-preparation fee: the model's category, the merchant table or the payee's own words. */
  const professionalFee = result.category === 'legal_professional' || ['legal', 'tax_prep'].includes(merchant.subtype ?? '') || PROFESSIONAL_SERVICE_WORDS.test(savedAndMerchant);
  if (openExpense && professionalFee &&
      (PERSONAL_LEGAL_MATTER_PATTERN.test(purpose) || (PERSONAL_RETURN_PATTERN.test(purpose) && !BUSINESS_SCHEDULE_WORDS.test(purpose)))) {
    // Pub 334: wills, divorce, personal injury, a personal return and buying a residence are personal matters whoever paid.
    addEvidence('professional-fees-334');
    markPersonal('Your note describes a personal matter. Legal, accounting and tax-preparation fees for personal matters (a divorce or custody case, a will or estate plan, a personal injury claim, your personal return, buying a home) are personal costs, not Schedule C expenses; whether any part is a personal itemized deduction is a question for your personal return, not this business review. Edit the note if part of the fee was for your business.',
      'Recorded as a personal legal or tax matter by your note.');
  }
  if (result.is_deductible === true && kind === 'expense' && PERSONAL_COVERAGE_PATTERN.test(purpose) && !BUSINESS_COVERAGE_PATTERN.test(purpose)) {
    // Pub 334: life, disability, accident and pet coverage on the taxpayer or the household is personal, not line 15.
    addEvidence('insurance-334');
    markPersonal('Your note describes life, disability, accident or pet coverage on yourself or your household. Those premiums are personal, not business insurance; only coverage of a business risk or business property belongs on Schedule C line 15. Edit the note if this policy covers your business.',
      'Recorded as personal coverage by your note.');
  }
  if (result.is_deductible === true && kind !== 'refund' && !remittedBusinessTax &&
      (TAX_AUTHORITY_PATTERN.test(savedAndMerchant) || (taxAgencyPayee && INCOME_TAX_WORDS.test(purpose)))) {
    // A live model approved a $1,500 IRS estimated-tax payment at 100%. Income tax and
    // self-employment tax payments are not business expenses and never reach Schedule C. Only the
    // taxpayer's own words naming a sales, payroll or business property tax to a non-federal agency pass;
    // a tax agency the merchant table knows plus the taxpayer's own income-tax words is the same block.
    addEvidence('taxes-licenses-sch-c'); addEvidence('records-334');
    result.category = 'other';
    requireInfo(result, 'tax_payment_recorded', 'Was this a federal or state income tax payment (including estimated tax)? Record it in the quarterly planner instead of as an expense.',
      'Payments to the IRS or a state tax agency are not business expenses. Federal income tax and self-employment tax are never deductible on Schedule C; record estimated payments in the quarterly planner so they count toward what you have already paid.', true);
  }
  if (year !== 2025 && year !== 2026) {
    requireInfo(result, 'supported_tax_year', 'Confirm the transaction date and review this tax year with your tax professional.',
      `The category is a suggestion only. This rule packet covers selected 2025 and 2026 federal transactions; ${year ?? 'this date'} is outside its verified scope.`, true);
  } else if (context?.business_entity && !['sole_proprietor', 'single_member_llc'].includes(context.business_entity)) {
    requireInfo(result, 'entity_tax_treatment', 'Is this for a sole-proprietor/disregarded LLC business, or should your entity tax preparer review it?',
      'The category may help organize this transaction, but its entity-specific tax treatment is outside this self-employed federal review.', true);
  } else if (result.status === 'ok') {
    if (!Number.isFinite(amount) || amount === 0 || kind === 'unknown') {
      requireInfo(result, 'transaction_kind', 'What did this payment or deposit represent?', 'The bank record does not yet establish whether this is spending, income, a refund or a transfer.');
    } else if (kind === 'refund') {
      addEvidence('records-334');
      requireInfo(result, 'original_expense', 'Which original purchase does this refund match, and in which tax year was that purchase deducted?',
        'Match this credit to its original purchase before adjusting tax totals. A same-year refund and a recovery of a prior-year deduction can have different tax treatment.');
    } else if (amount < 0 && kind === 'income' && !savedIncomeEvidence) {
      requireInfo(result, 'deposit_source', 'Was this payment for a customer sale, a refund, a loan, an owner contribution or a transfer?',
        'A bank deposit is not automatically taxable business income. Identify its source so it reaches the correct tax total.');
    } else if (kind === 'transfer' && !savedCategory.includes('TRANSFER') &&
      !/\b(between (?:my|our|own|my own|our own) accounts|own accounts?|credit card payment|internal transfer)\b/i.test(saved)) {
      requireInfo(result, 'transfer_purpose', 'Was this money moved between your own accounts, or a payment to someone for goods or services?',
        'A payment-app or bank name alone does not establish an internal transfer. Confirm where this money went.');
    } else if (amount < 0 && !['income', 'transfer', 'personal'].includes(kind) || amount > 0 && kind === 'income') {
      requireInfo(result, 'transaction_direction', 'Confirm whether money left or entered this account and what it was for.',
        'The proposed type does not match the recorded cash direction, so the tax treatment needs review.');
    } else if (result.is_deductible === true && kind !== 'expense') {
      requireInfo(result, 'transaction_kind', 'Is this a business purchase, a deposit or an account transfer?',
        'Only a supported business expense can be proposed as a new deduction.');
    } else if (result.is_deductible === true && !context?.business_entity) {
      requireInfo(result, 'business_entity', 'Is this for your sole-proprietor business or a disregarded single-member LLC?',
        'Confirm your business tax structure before applying this self-employed expense treatment.');
    } else if (result.is_deductible === true && merchant.disposition === 'not_an_expense' && !(remittedBusinessTax && taxAgencyPayee)) {
      // Tax payments, loan principal, investments, fines and donations are not expenses whatever the note says;
      // only a sales, payroll or business property tax the taxpayer names to a state or local agency is a line 23 expense.
      addEvidence(taxAgencyPayee ? 'taxes-licenses-sch-c' : 'records-334');
      requireInfo(result, 'transaction_kind', hint?.question ?? merchant.question ?? 'Was this a tax payment, loan payment, investment, fine or donation rather than a purchase for your business?',
        'Payments of this kind (taxes, loan principal, investments, fines or donations) are not Schedule C expenses even when paid from the business account. Confirm what this payment was before it is treated as an expense.');
    } else if (result.is_deductible === true && (merchant.disposition === 'schedule_1' || HEALTH_INSURANCE_PATTERN.test(reviewText))) {
      // §162(l) premiums are a Schedule 1 adjustment (Form 7206); on Schedule C they would wrongly reduce SE tax.
      const health = merchant.disposition !== 'schedule_1' || merchant.subtype === 'health_premium' || HEALTH_INSURANCE_PATTERN.test(reviewText);
      if (health) { addEvidence('insurance-334'); addEvidence('personal-262'); } else addEvidence('records-334');
      // A health premium is never line 15 business insurance, so it must not carry that line into the review.
      if (result.category === 'insurance') result.category = 'other';
      requireInfo(result, 'deduction_placement', hint?.question ?? (merchant.disposition === 'schedule_1' ? merchant.question : null)
        ?? 'Is this a health, dental or vision premium for you, your spouse or dependents, or coverage you provide to employees?',
      health ? 'Self-employed health insurance premiums are an adjustment to income on Schedule 1 (Form 7206), not a Schedule C expense, and they do not reduce self-employment tax. Record them under health insurance in Tax Organizer; only coverage you provide to employees belongs on Schedule C.'
        : 'Contributions to retirement or health savings accounts are not Schedule C business expenses. Confirm this was a contribution rather than a business purchase, and record it outside business expenses.');
    } else if (result.is_deductible === true && (merchant.subtype === 'gym' ||
      // The word "gym" in a note must not re-route a confidently identified clothing or hardware purchase (a non-gym subtype).
      (CLUB_DUES_PATTERN.test(savedAndMerchant) && !(merchant.confidence === 'high' && merchant.subtype))) && !CLUB_BUSINESS_USE_PATTERN.test(saved)) {
      // The statutory club-dues test outranks the generic purpose question: a purpose cannot cure §274(a)(3).
      addEvidence('dues-274a3'); addEvidence('personal-262');
      const gymHint = professionHint(priors, 'gym');
      if (gymHint?.category === 'rent') addEvidence('rent-334');
      requireInfo(result, 'club_dues_exception', gymHint?.question ?? 'Is this facility used only in your business (for example, space you rent to train clients), or is it a membership for your own use?',
        'Gym, health club and similar membership dues are generally personal and not deductible (§274(a)(3), §262) even when fitness supports your work. Only a facility used exclusively in the business qualifies.'
        + (gymHint?.category === 'rent' ? ' Space you rent to train your own clients is business rent rather than dues; confirm the arrangement.' : ''));
    } else if (result.is_deductible === true && (merchant.subtype === 'clothing' || merchant.subtype === 'beauty')) {
      // Everyday-wear clothing and grooming stay personal (§262) whatever the stated purpose; only the exception facts can change that.
      addEvidence('personal-262');
      requireInfo(result, 'personal_use_exception', hint?.question ?? merchant.question ?? 'Is this item unusable outside your business (a uniform, costume or protective gear) or a product used on your own clients, rather than clothing or grooming for yourself?',
        'Clothing, grooming and similar items suitable for everyday use are personal living costs even when bought for work or on-camera use. Only items unusable outside the business, such as uniforms, costumes or protective gear, or products used on your own clients can qualify; confirm which this was.');
    } else if (result.is_deductible === true && context?.taxpayer_context?.priors.merchant?.decision === 'personal'
      && context.taxpayer_context.priors.merchant.personalCount >= 2) {
      // The user's own repeated decisions outrank a model guess and the merchant table's proposed purpose.
      requireInfo(result, 'prior_decision_conflict', 'You previously marked purchases from this merchant as personal. Is this one different, and how was it used in your business?',
        'Your earlier confirmed decisions treated this merchant as personal. Confirm what changed before a business deduction is proposed.');
    } else if (result.is_deductible === true && purposeMissing) {
      const generic = 'What did you buy, and how did you use it in your business?';
      if (merchant.disposition === 'transfer_or_deposit') {
        addEvidence('records-334');
        requireInfo(result, 'transaction_kind', hint?.question ?? merchant.question ?? 'Was this money moved between your own accounts, or a payment to someone for goods or services, and what was bought?',
          `This ${merchant.name ?? 'payment'} record shows money moving, not what it paid for. Name the payee and the goods or services before it is treated as a business expense.`);
      } else if (merchant.disposition === 'personal_likely') {
        addEvidence('personal-262');
        requireInfo(result, 'business_purpose', hint?.question ?? merchant.question ?? generic,
          `Purchases from ${merchant.name ?? 'this merchant'} are ordinarily personal living costs. A deduction needs your own stated business purpose, a sentence rather than a label, before the suggested category is more than a bookkeeping hint.`);
      } else if (merchant.disposition === 'business_likely' && merchant.confidence === 'high' && merchant.defaultPurpose) {
        // Still needs_more_info: the user's confirmation of the proposed purpose is the only approval.
        requireInfo(result, 'business_purpose', proposedPurposeQuestion(merchant),
          `Charges from ${merchant.name} are commonly business purchases, but the merchant alone does not record your business use. Confirm or edit the proposed purpose so it is saved with this transaction.`);
        result.proposed_purpose = merchant.defaultPurpose;
      } else {
        requireInfo(result, 'business_purpose', hint?.question ?? merchant.question ?? generic,
          'The likely category helps organize the purchase, but the merchant and account do not establish its business purpose.');
      }
    } else if (result.is_deductible === true && PENALTY_PATTERN.test(savedAndMerchant)) {
      // A parking or toll violation paid to a government is a fine, not the parking or toll it was issued for.
      addEvidence('taxes-licenses-sch-c');
      requireInfo(result, 'expense_review', 'Was this a fine, penalty or ticket paid to a government, or a business permit, licence or filing fee?',
        'Fines, penalties and tickets paid to a government (parking and traffic tickets, late-filing penalties) are not deductible business expenses; permits, licences and filing fees are. Confirm which this was before it is included.');
    } else if (result.is_deductible === true && result.category !== 'vehicle_expense' &&
      (VEHICLE_COST_PATTERN.test(savedAndMerchant) || (result.category === 'repairs_maintenance' && VEHICLE_NOUNS.test(purpose))) &&
      // A carrier that also sells auto policies (Allstate, State Farm) is not an auto cost when the taxpayer names business coverage.
      !(result.category === 'insurance' && businessCoverageStated)) {
      // Auto insurance, registration or repairs filed as "other" is still a vehicle cost: the method decides whether it is deductible separately.
      addEvidence('travel-463');
      result.category = 'vehicle_expense';
      requireInfo(result, 'vehicle_method', 'Is this cost for a vehicle you drive for business, and do you use the standard mileage rate or actual expenses for it?',
        'Vehicle insurance, registration and repairs are part of the actual-expense method; under the standard mileage rate they are already included in the per-mile amount and cannot be deducted again. Confirm the vehicle and method before including this cost.');
    } else if (result.is_deductible === true && TAX_PREP_PATTERN.test(savedAndMerchant) && percentage(transaction.business_use_percentage) === null) {
      // Once the share is saved, the fee is approved below under legal_professional at that share.
      addEvidence('professional-fees-334');
      requireInfo(result, 'business_use_percentage', 'What share of this fee was for your business schedules (Schedule C, SE, business forms) rather than your personal return?',
        'Tax preparation and accounting fees are deductible on Schedule C only for the business portion; the personal-return portion is not deductible. Record the business share before including it.');
    } else if (result.is_deductible === true && PARKING_TOLL_PATTERN.test(savedAndMerchant) && saved.length >= 8) {
      // Business-trip parking and tolls are deductible in addition to the standard mileage rate and need no method review;
      // the commuting reading above already settled the personal case. Line 9 as parking_tolls so the approval is confirmable.
      // The share follows the ordinary-expense rule: a saved share is kept, a model share without one is asked, never assumed.
      result.category = 'parking_tolls';
      addEvidence('travel-463');
      const provided = percentage(transaction.business_use_percentage);
      if (provided === null && result.deductible_percent != null && result.deductible_percent < 100) {
        requireInfo(result, 'business_use_percentage', 'What share of this parking or toll cost was for business trips rather than personal or commuting driving, and what records support that split?',
          'Only the documented business portion of parking and tolls may qualify. No percentage has been assumed for this mixed-use cost.');
      } else if ((provided !== null && result.deductible_percent !== undefined && result.deductible_percent !== provided) || provided === 0) {
        return null;
      } else {
        result.deductible_percent = provided ?? 100;
      }
    } else if (result.is_deductible === true && HOME_INSURANCE_PATTERN.test(savedAndMerchant)) {
      // A policy on the home the taxpayer lives in is a Form 8829 item at the business percentage, never line 15.
      addEvidence('home-587'); addEvidence('insurance-334');
      result.category = 'home_office';
      requireInfo(result, 'home_office_eligibility', 'Is this policy on the home where you live? A homeowner\'s or renter\'s policy counts only through a qualifying home office (a space used regularly and exclusively for business), at the business share of the home.',
        'A homeowner\'s or renter\'s policy is a personal cost; only a qualifying home office deduction can include the business percentage of it (Form 8829). It is not business insurance on Schedule C line 15.');
    } else if (result.is_deductible === true && result.category === 'insurance' && !businessCoverageStated && !businessInsurer) {
      // Line 15 needs the insured business risk or property (Pub 334); a carrier that sells every kind of policy does not show it.
      addEvidence('insurance-334');
      requireInfo(result, 'insurance_coverage', targetedQuestion('insurance') ?? 'Which coverage is this: business liability, professional (E&O) or business property insurance, an auto policy, or health, life or home coverage?',
        'Only premiums that cover a business risk or business property are Schedule C insurance (line 15). Auto policies follow your vehicle method, your own health premiums belong on Schedule 1, and life, disability and home policies are personal; name the coverage before this premium is included.');
    } else if (result.is_deductible === true && result.category === 'rent' && HOME_RENT_PATTERN.test(savedAndMerchant)) {
      addEvidence('home-587');
      requireInfo(result, 'home_office_eligibility', 'Is this rent for a separate business location, or for the home where you live? If it is your home, is a space used regularly and exclusively for business?',
        'Rent for the home you live in is not a business rent expense; only a qualifying home office deduction can include part of it. Rent for a separate business location is generally deductible as business rent.');
    } else if (result.is_deductible === true && propertyTax && !remittedBusinessTax) {
      // Property tax on the home is a Form 8829 item; on business assets or a business location it is line 23 (approved below).
      addEvidence('home-587'); addEvidence('taxes-licenses-sch-c');
      result.category = 'home_office';
      requireInfo(result, 'home_office_eligibility', 'Is this property tax on the home where you live, or on business property (a shop, studio, business vehicle or equipment)? Tax on your home counts only through a qualifying home office.',
        'Property tax on the home you live in is a personal cost that only a qualifying home office deduction can include in part (Form 8829). Personal property tax on business assets or a separate business location is a line 23 expense; name the property before this payment is included.');
    } else if (result.is_deductible === true && result.category === 'repairs_maintenance' && HOME_REPAIR_PATTERN.test(purpose)) {
      // Repairs to the home are Form 8829 items (in full for the office itself, otherwise at the business percentage).
      addEvidence('home-587');
      result.category = 'home_office';
      requireInfo(result, 'home_office_eligibility', 'Was this repair to the home where you live? Repairs to your home count only through a qualifying home office: in full for the office space itself, otherwise at the business percentage of the home.',
        'A repair to the home you live in is a personal cost that only a qualifying home office deduction can include (Form 8829); it is not a business repair on Schedule C line 21. Repairs to a separate business location or to business equipment are.');
    } else if (result.is_deductible === true && result.category === 'repairs_maintenance' && (IMPROVEMENT_PATTERN.test(purpose) || amount > DE_MINIMIS_ITEM_CEILING)) {
      // Reg. §1.263(a)-3: a betterment, restoration or replacement of a major component is capitalized; a repair keeps property in ordinary working order.
      addEvidence('capital-263');
      requireInfo(result, 'asset_treatment', 'Did this work keep existing property in its ordinary operating condition (a repair), or improve, restore or replace it (an improvement)? When was the property first used in your business?',
        `A repair that keeps business property in ordinary working order is a current expense (Schedule C line 21), but a betterment, restoration or replacement of a major component is a capital improvement that is depreciated. ${amount > DE_MINIMIS_ITEM_CEILING ? `At over $${DE_MINIMIS_ITEM_CEILING.toLocaleString('en-US')} this` : 'The saved description of this'} work points to an improvement or replacement; review the treatment before deducting it in full.`);
    } else if (result.is_deductible === true && (!result.category || ['supplies_small_tools', 'other'].includes(result.category))
      && (amount > DE_MINIMIS_ITEM_CEILING || (amount >= ASSET_REVIEW_FLOOR &&
        // Between $200 and $2,500 the taxpayer's words and the descriptor decide; the model's prose counts only when it names a specific item.
        (LIKELY_ASSET_PATTERN.test(savedAndMerchant) || LIKELY_ASSET_ITEM_PATTERN.test(explanation))))) {
      // Choosing "supplies" must not bypass the asset gate that the equipment category triggers.
      addEvidence('capital-263');
      requireInfo(result, 'asset_treatment', hint?.question ?? 'What was purchased, when was it first used for business, and have you recorded the de minimis safe harbor election or a depreciation election for this year?',
        `This purchase looks like an asset rather than a supply. Items over $${DE_MINIMIS_ITEM_CEILING.toLocaleString('en-US')} generally must be capitalized and depreciated; items at or under that amount can be expensed only when the de minimis safe harbor election is recorded for the year. Review the asset treatment before deducting it in full.`);
    } else if (result.is_deductible === true && ['equipment', 'home_office', 'vehicle_expense', 'travel'].includes(result.category ?? '')) {
      const questions: Record<string, [string, string]> = {
        equipment: ['asset_treatment', 'What was purchased, when was it first used for business, and what business-use records and depreciation elections apply?'],
        home_office: ['home_office_eligibility', 'Is the space used regularly and exclusively for business, and which eligible method and business area apply?'],
        vehicle_expense: ['vehicle_method', 'Was this commuting or business driving, and do your mileage records and chosen vehicle method allow this cost separately?'],
        travel: ['travel_eligibility', 'What was your tax home, business destination, travel dates and personal portion of the trip?'],
      };
      const [field, question] = questions[result.category!];
      requireInfo(result, field, targetedQuestion(result.category) ?? question, 'The category is suggested, but this expense has additional eligibility or calculation rules. Review the supporting facts before including a deduction.');
    } else if (result.is_deductible === true && result.category === 'meals_50') {
      // The current UI does not collect every meal-condition fact; retain the useful category, never infer eligibility.
      addEvidence('meals-274');
      requireInfo(result, 'meal_conditions', targetedQuestion('meals_50') ?? 'Who attended, were you or your employee present, and was the meal non-lavish and separately billed from entertainment?',
        'A qualifying business meal generally has a 50% limit, but a restaurant charge or work shift alone does not qualify. Confirm the attendees, purpose and meal conditions before claiming it.');
    } else if (result.is_deductible === true) {
      const provided = percentage(transaction.business_use_percentage);
      // A mixed-use merchant (phone plans, household memberships, tax-prep bundles) needs the documented split.
      const mixed = context?.mixed_use_flag === true || result.category === 'utilities_phone_internet' || merchant.disposition === 'mixed_use' ||
        /\b(mixed use|partly personal|personal and business|business and personal|shared with family)\b/i.test(saved);
      if ((mixed && provided === null) || (result.deductible_percent != null && result.deductible_percent < 100 && provided === null)) {
        requireInfo(result, 'business_use_percentage',
          (merchant.disposition === 'mixed_use' ? targetedQuestion(result.category) : null) ?? 'What percentage of this specific expense was for business, and what records support that split?',
          'Only the documented business portion may qualify. No percentage has been assumed for this mixed-use expense.');
      } else if (provided !== null && result.deductible_percent !== undefined && result.deductible_percent !== provided) {
        return null;
      } else if (provided === 0) {
        return null;
      } else {
        result.deductible_percent = provided ?? 100;
      }
    }
    // A denial that still asks the taxpayer something is an open decision, not a settled non-deduction
    // (live round 4: "not deductible" plus "who attended?" / "which vehicle method?" on 12 expenses).
    if (result.status === 'ok' && result.is_deductible === false && kind === 'expense' && result.questions?.some(question => question.trim())) {
      const question = result.questions.find(entry => entry.trim())!.trim();
      requireInfo(result, purposeMissing ? 'business_purpose' : 'expense_review', question,
        'The analysis did not settle whether this is a business expense; your answer to the question decides it. Nothing has been treated as deductible.');
    }
    if (result.status === 'ok' && result.is_deductible === false) result.deductible_percent = 0;
  }
  if (result.status !== 'ok') {
    delete result.is_deductible; delete result.expense_type; delete result.deductible_percent;
    if (!result.questions?.some(question => question.trim())) {
      result.questions = [result.status === 'blocked'
        ? 'Confirm this was not a business purchase. If it was, describe what was bought and how it is used in your business.'
        : 'What was purchased or received, and what was its business or personal purpose?'];
    }
    const displayed = [result.customized_reason, result.reasoning_summary, result.key_analysis_factor, result.reason, result.audit_risk_rationale].filter(Boolean).join(' ');
    if (UNCONDITIONAL_CLAIM.test(displayed)) {
      result.customized_reason = 'The category is a suggestion; tax eligibility remains unresolved. Answer the follow-up questions before including a deduction.';
      result.reasoning_summary = result.customized_reason;
      result.key_analysis_factor = 'Category suggested; more tax facts are needed.';
      result.reason = result.customized_reason;
      if (result.audit_risk_rationale && UNCONDITIONAL_CLAIM.test(result.audit_risk_rationale)) delete result.audit_risk_rationale;
    }
  } else {
    // Even an approved ordinary expense is not "fully deductible" as a certainty; keep the claims policy wording.
    for (const field of ['customized_reason', 'reasoning_summary', 'key_analysis_factor', 'reason', 'audit_risk_rationale'] as const) {
      const value = result[field];
      if (typeof value === 'string' && UNCONDITIONAL_CLAIM.test(value)) result[field] = value.replace(UNCONDITIONAL_CLAIM, (_match, verb: string | undefined) => `${verb ?? ''}deductible as a business expense, subject to your records`);
    }
  }
  if (!result.documentation_required?.length && ['expense', 'refund'].includes(kind)) {
    result.documentation_required = kind === 'refund'
      ? ['Refund record and matching original invoice', 'Original expense tax year and treatment']
      : ['Itemized invoice or receipt', 'Recorded business purpose and any personal-use allocation'];
  }
  // A proposed purpose is offered whenever the purpose is the missing fact for a merchant that is confidently
  // business (the model itself may have asked); the user's confirmation remains the only approval.
  if (result.status === 'needs_more_info' && result.missing_fields?.includes('business_purpose') && purposeMissing
      && merchant.disposition === 'business_likely' && merchant.confidence === 'high' && merchant.defaultPurpose) {
    result.proposed_purpose = merchant.defaultPurpose;
  }
  // The Schedule C line names where a confirmed expense would be reported; it is display metadata, not an approval.
  if (result.transaction_kind === 'expense' && result.status !== 'blocked' && result.category && input.expense_type !== 'personal' && result.expense_type !== 'personal'
      && result.is_deductible !== false && !result.missing_fields?.includes('transaction_kind')) {
    const line = merchant.category === result.category && merchant.scheduleCLine ? merchant.scheduleCLine : CATEGORY_SCHEDULE_C_LINE[result.category];
    if (line) result.schedule_c_line = line;
  }
  // Model-selected ids lead, but a gate's cited rules and the category rule are never squeezed out by them.
  const required = [...new Set([...gateEvidence, ...(categoryRule ? [categoryRule] : [])])].slice(0, 3);
  result.evidence_ids = [...evidenceIds.filter(id => !required.includes(id)).slice(0, 3 - required.length), ...required];
  result.sources = result.evidence_ids.map(id => {
    const item = TRANSACTION_TAX_EVIDENCE.find(entry => entry.id === id)!;
    return { id: item.id, title: item.title, url: item.url, edition: item.edition, reviewed_at: item.reviewed_at };
  });
  result.irs_refs = result.sources.map(item => item.title);
  result.tax_year = year; result.jurisdiction = 'US-federal';
  result.policy_version = TRANSACTION_TAX_POLICY_VERSION;
  result.provenance = { provider: 'openai', model, kind: 'model_with_curated_tax_policy' };
  return result;
}
