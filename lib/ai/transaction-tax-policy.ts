import type { OutputType, TransactionInput, UserContext } from './analyzeTransaction';
import { BUSINESS_STANDARD_MILEAGE_RATES } from '@/lib/tax-rules/mileage-rates';

/** Selected, reviewed federal rules. This is not retrieval over the entire tax code. */
export const TRANSACTION_TAX_POLICY_VERSION = 'federal-transactions-2026-09-17.2';
export const TRANSACTION_KINDS = ['expense', 'income', 'transfer', 'refund', 'personal', 'unknown'] as const;
/** Expense categories the model may return; the single source for the zod enum, JSON schema and intelligence tables. */
export const EXPENSE_CATEGORIES = [
  'advertising_marketing', 'supplies_small_tools', 'software_subscriptions', 'contract_labor', 'equipment', 'vehicle_expense',
  'travel', 'meals_50', 'home_office', 'utilities_phone_internet', 'education_training', 'dues_and_memberships',
  'bank_and_payment_fees', 'rent', 'other',
] as const;
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
export interface TransactionTaxSource {
  id: string; title: string; url: string; edition: string; reviewed_at: string;
}
export interface TransactionTaxMetadata {
  tax_year: number | null;
  jurisdiction: 'US-federal';
  policy_version: string;
  sources: TransactionTaxSource[];
  provenance: { provider: 'openai'; model: string; kind: 'model_with_curated_tax_policy' };
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
  source('meals-274', '26 USC 274 — Meal conditions and entertainment limits', codeUrl(274), 'Current Code; selected 2025/2026 rules',
    'Ordinary qualifying business meals generally have a 50% limit, not automatic eligibility. Establish business purpose, participants, taxpayer/employee presence, non-lavish spending and separately stated food from entertainment. Entertainment is generally disallowed. Special meal exceptions and employer-furnished meals require separate review; employer convenience/eating-facility deductions change after 2025. A meal during a work shift alone is not enough.'),
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
  vehicle_expense: ['travel-463', 'mileage-rates'],
  travel: ['travel-463'],
  meals_50: ['meals-274'],
  home_office: ['home-587'],
  utilities_phone_internet: ['phone-internet-262', 'utilities-334', 'business-162'],
  education_training: ['education-reg-1.162-5', 'business-162'],
  dues_and_memberships: ['dues-274a3', 'business-162'],
  bank_and_payment_fees: ['bank-fees-334', 'platform-fees-1099k', 'business-162'],
  rent: ['rent-334', 'business-162', 'home-587'],
  other: ['business-162', 'startup-195', 'professional-fees-334', 'taxes-licenses-sch-c', 'insurance-334', 'gifts-274b'],
};
/** Vehicle purchases/financing cite asset rules; operating costs cite the travel and mileage rules. */
const VEHICLE_PURCHASE_EVIDENCE = ['assets-946', 'capital-263', 'travel-463', 'mileage-rates'] as const;

/** Code sections, regulations and publications a model may name in prose, and the evidence IDs that back each. */
const SECTION_EVIDENCE: Record<string, readonly string[]> = {
  '162': ['business-162', 'software-334', 'advertising-334', 'contract-labor-334', 'education-reg-1.162-5', 'insurance-334', 'bank-fees-334', 'professional-fees-334', 'rent-334', 'utilities-334'],
  '262': ['personal-262', 'phone-internet-262'],
  '274': ['meals-274', 'dues-274a3', 'gifts-274b', 'mileage-rates'],
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
const HEALTH_INSURANCE_PATTERN = /\b(?:health|medical|dental|vision)\s+(?:insurance|premiums?|plan|coverage)\b|\b(?:blue\s?cross|blue\s?shield|aetna|cigna|kaiser|unitedhealth(?:care)?|humana|oscar\s+health|anthem|ambetter|molina|healthcare\.gov)\b/i;
const CLUB_DUES_PATTERN = /\b(?:gym|fitness\s+(?:center|club|membership)|health\s+club|athletic\s+club|country\s+club|golf\s+club|planet\s+fitness|equinox|crossfit|orangetheory|la\s+fitness|24\s+hour\s+fitness|peloton|soulcycle|barry'?s\s+bootcamp)\b/i;
const HOME_RENT_PATTERN = /\b(?:apartment|apt\.?|home|house|residence|residential|landlord|housing|mortgage|rent\s+for\s+(?:my|our)\s+place)\b/i;
const LIKELY_ASSET_PATTERN = /\b(?:laptop|computer|macbook|imac|desktop|monitor|camera|lens|drone|printer|tablet|ipad|iphone|smartphone|desk|chair|tripod|microphone|mixer|guitar|piano|keyboard|server|router|projector|television|appliance|machine|equipment|furniture|tools?)\b/i;
/** Reg. §1.263(a)-1(f)(1)(ii)(D): per-item/per-invoice ceiling for taxpayers without an applicable financial statement. */
export const DE_MINIMIS_ITEM_CEILING = 2500;
/** Below this amount an ordinary supply is not second-guessed even when it names a durable item. */
const ASSET_REVIEW_FLOOR = 500;

/** Digits shaped like an SSN, ITIN or EIN inside free text; bank descriptors and notes never need them. */
export function redactTaxIdentifiers(value: string): string {
  return value.replace(/\b\d{3}[- ]\d{2}[- ]\d{4}\b/g, '[redacted-id]').replace(/\b\d{2}-\d{7}\b/g, '[redacted-id]');
}

/** Reject forged citations/contradictions; withhold eligibility when known gates require facts. */
export function groundTransactionAnalysis(
  input: OutputType, transaction: TransactionInput, context: UserContext | undefined, model: string,
): OutputType | null {
  const result: OutputType = { ...input };
  const ids = result.evidence_ids ?? [];
  if (!Array.isArray(ids) || !ids.length || ids.length > 3 || ids.some(id => !TRANSACTION_EVIDENCE_IDS.includes(id)) || new Set(ids).size !== ids.length) return null;
  const year = transactionTaxYear(transaction);
  const amount = transaction.amount_usd ?? transaction.amount;
  let kind = result.transaction_kind ?? 'unknown';
  result.transaction_kind = kind;
  const explanation = [result.customized_reason, result.reasoning_summary, result.key_analysis_factor].filter(Boolean).join(' ');
  // A model cannot smuggle arbitrary source links or imply a computed percentage unsupported by the fields.
  if (/https?:\/\//i.test(explanation)) return null;
  if (uncitedReferences(explanation, ids).length) return null;
  if (result.status === 'ok' && (result.is_deductible === true && result.expense_type !== 'business' ||
      kind === 'personal' && (result.expense_type !== 'personal' || result.is_deductible !== false) ||
      ['income', 'transfer'].includes(kind) && result.is_deductible !== false)) return null;
  const saved = contextText(transaction);
  // Saved context, merchant descriptor and the model's own item description. Only review
  // gates read this; nothing here can approve a deduction.
  const reviewText = `${saved} ${text(transaction.merchant)} ${text(transaction.merchant_name)} ${explanation}`;
  const itemContext = categoryContext(input, transaction);
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
  const applicableEvidence: readonly string[] = kind === 'personal' || result.expense_type === 'personal' ? ['personal-262', 'dues-274a3', 'taxes-licenses-sch-c', 'insurance-334'] :
    ['income', 'refund', 'transfer'].includes(kind) ? ['records-334', 'platform-fees-1099k'] :
    kind === 'unknown' && amount <= 0 ? ['records-334', 'personal-262', 'business-162', 'platform-fees-1099k'] :
    result.category === 'vehicle_expense' && assetPurchase ? VEHICLE_PURCHASE_EVIDENCE :
    result.status !== 'ok' && (!result.category || result.category === 'other') ? [...CATEGORY_EVIDENCE.other, 'personal-262', 'records-334'] :
    categoryEvidence ?? CATEGORY_EVIDENCE.other;
  if (!applicableEvidence.some(id => ids.includes(id))) return null;
  const evidence = [...ids];
  const addEvidence = (id: string) => { if (!evidence.includes(id)) evidence.push(id); };
  // Surface the category-specific rule whenever an expense category is proposed, so the
  // displayed sources name the applicable test rather than only the general §162 rule.
  if (kind === 'expense' && categoryEvidence && categoryEvidence[0] !== 'business-162' && result.expense_type !== 'personal') {
    addEvidence(result.category === 'vehicle_expense' && assetPurchase ? VEHICLE_PURCHASE_EVIDENCE[0] : categoryEvidence[0]);
  }
  // Kind affects reporting even while eligibility is unresolved. Never let a tentative
  // model kind turn an unexplained deposit into income or a payment app into a transfer.
  const unexplainedIncome = kind === 'income' && (amount >= 0 ||
    !/^INCOME(?:_|$)|REVENUE|SALES/.test(savedCategory) && !/\b(client|customer|invoice|business sales|service revenue|platform payout)\b/i.test(saved));
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
    } else if (amount < 0 && kind === 'income' && !/^INCOME(?:_|$)|REVENUE|SALES/.test(savedCategory) &&
      !/\b(client|customer|invoice|business sales|service revenue|platform payout)\b/i.test(saved)) {
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
    } else if (result.is_deductible === true && saved.length < 8) {
      requireInfo(result, 'business_purpose', 'What did you buy, and how did you use it in your business?',
        'The likely category helps organize the purchase, but the merchant and account do not establish its business purpose.');
    } else if (result.is_deductible === true && context?.taxpayer_context?.priors.merchant?.decision === 'personal'
      && context.taxpayer_context.priors.merchant.personalCount >= 2) {
      // The user's own repeated decisions outrank a model guess; ask before reversing them.
      requireInfo(result, 'prior_decision_conflict', 'You previously marked purchases from this merchant as personal. Is this one different, and how was it used in your business?',
        'Your earlier confirmed decisions treated this merchant as personal. Confirm what changed before a business deduction is proposed.');
    } else if (result.is_deductible === true && HEALTH_INSURANCE_PATTERN.test(reviewText)) {
      // §162(l) premiums are a Schedule 1 adjustment (Form 7206); on Schedule C they would wrongly reduce SE tax.
      addEvidence('personal-262');
      requireInfo(result, 'deduction_placement', 'Is this a health, dental or vision premium for you, your spouse or dependents, or coverage you provide to employees?',
        'Self-employed health insurance premiums are an adjustment to income on Schedule 1 (Form 7206), not a Schedule C expense, and they do not reduce self-employment tax. Record them under health insurance in Tax Organizer; only coverage you provide to employees belongs on Schedule C.');
    } else if (result.is_deductible === true && CLUB_DUES_PATTERN.test(reviewText)) {
      addEvidence('dues-274a3'); addEvidence('personal-262');
      requireInfo(result, 'club_dues_exception', 'Is this facility used only in your business (for example, space you rent to train clients), or is it a membership for your own use?',
        'Gym, health club and similar membership dues are generally personal and not deductible (§274(a)(3), §262) even when fitness supports your work. Only a facility used exclusively in the business qualifies.');
    } else if (result.is_deductible === true && result.category === 'rent' && HOME_RENT_PATTERN.test(reviewText)) {
      addEvidence('home-587');
      requireInfo(result, 'home_office_eligibility', 'Is this rent for a separate business location, or for the home where you live? If it is your home, is a space used regularly and exclusively for business?',
        'Rent for the home you live in is not a business rent expense; only a qualifying home office deduction can include part of it. Rent for a separate business location is generally deductible as business rent.');
    } else if (result.is_deductible === true && (!result.category || ['supplies_small_tools', 'other'].includes(result.category))
      && (amount > DE_MINIMIS_ITEM_CEILING || (amount >= ASSET_REVIEW_FLOOR && LIKELY_ASSET_PATTERN.test(reviewText)))) {
      // Choosing "supplies" must not bypass the asset gate that the equipment category triggers.
      addEvidence('capital-263');
      requireInfo(result, 'asset_treatment', 'What was purchased, when was it first used for business, and have you recorded the de minimis safe harbor election or a depreciation election for this year?',
        `This purchase looks like an asset rather than a supply. Items over $${DE_MINIMIS_ITEM_CEILING.toLocaleString('en-US')} generally must be capitalized and depreciated; items at or under that amount can be expensed only when the de minimis safe harbor election is recorded for the year. Review the asset treatment before deducting it in full.`);
    } else if (result.is_deductible === true && ['equipment', 'home_office', 'vehicle_expense', 'travel'].includes(result.category ?? '')) {
      const questions: Record<string, [string, string]> = {
        equipment: ['asset_treatment', 'What was purchased, when was it first used for business, and what business-use records and depreciation elections apply?'],
        home_office: ['home_office_eligibility', 'Is the space used regularly and exclusively for business, and which eligible method and business area apply?'],
        vehicle_expense: ['vehicle_method', 'Was this commuting or business driving, and do your mileage records and chosen vehicle method allow this cost separately?'],
        travel: ['travel_eligibility', 'What was your tax home, business destination, travel dates and personal portion of the trip?'],
      };
      const [field, question] = questions[result.category!];
      requireInfo(result, field, question, 'The category is suggested, but this expense has additional eligibility or calculation rules. Review the supporting facts before including a deduction.');
    } else if (result.is_deductible === true && result.category === 'meals_50') {
      // The current UI does not collect every meal-condition fact; retain the useful category, never infer eligibility.
      addEvidence('meals-274');
      requireInfo(result, 'meal_conditions', 'Who attended, were you or your employee present, and was the meal non-lavish and separately billed from entertainment?',
        'A qualifying business meal generally has a 50% limit, but a restaurant charge or work shift alone does not qualify. Confirm the attendees, purpose and meal conditions before claiming it.');
    } else if (result.is_deductible === true) {
      const provided = percentage(transaction.business_use_percentage);
      const mixed = context?.mixed_use_flag === true || result.category === 'utilities_phone_internet' ||
        /\b(mixed use|partly personal|personal and business|business and personal|shared with family)\b/i.test(saved);
      if ((mixed && provided === null) || (result.deductible_percent != null && result.deductible_percent < 100 && provided === null)) {
        requireInfo(result, 'business_use_percentage', 'What percentage of this specific expense was for business, and what records support that split?',
          'Only the documented business portion may qualify. No percentage has been assumed for this mixed-use expense.');
      } else if (provided !== null && result.deductible_percent !== undefined && result.deductible_percent !== provided) {
        return null;
      } else if (provided === 0) {
        return null;
      } else {
        result.deductible_percent = provided ?? 100;
      }
    }
    if (result.status === 'ok' && result.is_deductible === false) result.deductible_percent = 0;
  }
  if (result.status !== 'ok') {
    delete result.is_deductible; delete result.expense_type; delete result.deductible_percent;
    if (!result.questions?.some(question => question.trim())) {
      result.questions = ['What was purchased or received, and what was its business or personal purpose?'];
    }
    if (/\b(?:is|are)\s+(?:fully|100%|completely)\s+deductible\b/i.test(result.customized_reason ?? '')) {
      result.customized_reason = 'The category is a suggestion; tax eligibility remains unresolved. Answer the follow-up questions before including a deduction.';
      result.reasoning_summary = result.customized_reason;
      result.key_analysis_factor = 'Category suggested; more tax facts are needed.';
    }
  }
  if (!result.documentation_required?.length && ['expense', 'refund'].includes(kind)) {
    result.documentation_required = kind === 'refund'
      ? ['Refund record and matching original invoice', 'Original expense tax year and treatment']
      : ['Itemized invoice or receipt', 'Recorded business purpose and any personal-use allocation'];
  }
  result.evidence_ids = evidence.slice(0, 3);
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
