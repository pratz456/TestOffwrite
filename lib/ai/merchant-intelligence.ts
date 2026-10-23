/**
 * Merchant intelligence: a curated table of descriptor patterns common in U.S. freelancer bank
 * feeds plus the Plaid personal-finance-category taxonomy, each mapped to the most likely
 * expense category, Schedule C line and a *disposition*.
 *
 * Dispositions drive prompt hints and grounding questions only. Nothing in this module sets
 * `is_deductible`; the user's confirmation of a purpose remains the only approval.
 *
 * Plaid taxonomy: https://plaid.com/documents/transactions-personal-finance-category-taxonomy.csv
 * (104 detailed values, fetched 2026-09-17). Schedule C line numbers follow the 2025 Instructions
 * for Schedule C and this app's export mapping in lib/schedule-c/aggregate.ts.
 */
import type { TransactionInput } from './analyzeTransaction';
import type { ExpenseCategory } from './transaction-tax-policy';

export const MERCHANT_DISPOSITIONS = [
  /** Overwhelmingly a business tool for self-employed users; still needs the user's one-tap purpose confirmation. */
  'business_likely',
  /** Ordinarily a personal living cost (§262); a deduction needs a stated business purpose of at least a sentence. */
  'personal_likely',
  /** Typically shared between personal and business use; a documented business-use percentage is required. */
  'mixed_use',
  /** Could be either; the item or trip purpose decides. */
  'needs_purpose',
  /** Not an expense at all (tax payments, loan principal, investments, cash). */
  'not_an_expense',
  /** Money moved between accounts, a payout of sales, or a payment-app transfer whose purpose is unknown. */
  'transfer_or_deposit',
  /** Belongs on Schedule 1 (self-employed health insurance, retirement contributions), not Schedule C. */
  'schedule_1',
] as const;
export type MerchantDisposition = typeof MERCHANT_DISPOSITIONS[number];
/** Finer merchant signal the grounding layer and profession priors use to pick a targeted question. */
export type MerchantSubtype =
  | 'local_transport' | 'fuel' | 'parking_tolls' | 'auto_service' | 'auto_insurance' | 'rental_car' | 'travel_air' | 'travel_lodging'
  | 'meal' | 'groceries' | 'streaming' | 'gym' | 'beauty' | 'clothing' | 'sporting_goods' | 'health_premium'
  | 'electronics' | 'hardware' | 'general_merchandise' | 'software' | 'phone_internet' | 'home_utility' | 'rent' | 'coworking'
  | 'education' | 'legal' | 'tax_prep' | 'insurance' | 'gift' | 'postage' | 'processor' | 'repair';

export interface MerchantIntelligenceEntry {
  pattern: RegExp;
  name: string;
  category: ExpenseCategory | null;
  /** Schedule C line ('8', '9', '10', '11', '13', '15', '16b', '17', '18', '20a', '20b', '21', '22', '23', '24a', '24b', '25', '27a', '30') or null. */
  scheduleCLine: string | null;
  disposition: MerchantDisposition;
  /** One-line purpose the USER can confirm or edit; never a tax conclusion. */
  defaultPurpose?: string;
  /** The single most useful question when the purpose is not established. */
  question?: string;
  notes?: string;
  subtype?: MerchantSubtype;
  /**
   * Credits from this merchant can legitimately be payouts of the taxpayer's own sales or earnings
   * (marketplaces, gig platforms, creator platforms). Without this flag a credit from a merchant the
   * taxpayer buys from is a refund or an unknown credit, never income, whatever the saved text says.
   */
  paysOut?: boolean;
}

type Detail = Pick<MerchantIntelligenceEntry, 'defaultPurpose' | 'question' | 'notes' | 'subtype' | 'paysOut'>;
const entry = (pattern: RegExp, name: string, category: ExpenseCategory | null, scheduleCLine: string | null,
  disposition: MerchantDisposition, detail: Detail = {}): MerchantIntelligenceEntry =>
  ({ pattern, name, category, scheduleCLine, disposition, ...detail, subtype: detail.subtype ?? inferSubtype(detail.question) });

// --- Question templates shared by many merchants (no tax conclusions, one fact each) -------------
const Q = {
  item: (name: string) => `What did you buy at ${name}, and how is it used in your business? Household or personal items stay out.`,
  meal: 'Who was at this meal and what business was discussed? A meal or coffee by yourself during a work day is personal.',
  fuel: 'Was this fuel for business driving, and do you use the standard mileage rate (which already includes fuel) or actual vehicle expenses?',
  localRide: 'Where did this ride go? Rides between business locations or to a client are deductible; commuting from home to a regular workplace and personal rides are not.',
  parking: 'Was this parking or toll for a business trip? Parking at your regular workplace is commuting, and business parking and tolls are deductible even under standard mileage.',
  airfare: 'What business activity required this trip, what were the dates, and were any days personal?',
  lodging: 'What business activity required an overnight stay away from your tax home, which nights were business, and is the bill itemized?',
  rentalCar: 'Was this rental used for business travel or local business driving, and were any days personal?',
  phone: (name: string) => `What percentage of this ${name} plan is business use, and what records support that split?`,
  software: (name: string) => `Is this ${name} plan used in your business, or is it a personal or family plan?`,
  streaming: 'Streaming, music and entertainment services are personal unless you can show a specific business use, such as licensed content for a client project. Was this for business?',
  groceries: 'Groceries are personal living costs. Were these items bought for a business purpose, such as food for a client event or products for resale?',
  pharmacy: 'Pharmacy and medical purchases are personal (medical costs belong on Schedule A, not Schedule C). Was this actually a business supply purchase?',
  clothing: 'Clothing suitable for everyday wear is personal even when worn for work or on camera; only uniforms, costumes and protective gear that are unsuitable for ordinary wear qualify. Which was this?',
  gym: 'Is this facility used only in your business (for example, space you rent to train clients), or is it a membership for your own use? Club and gym dues are generally not deductible.',
  healthPremium: 'Is this a health, dental or vision premium for you, your spouse or dependents (Schedule 1 via Form 7206, not Schedule C), or coverage you provide to employees?',
  autoInsurance: 'Is this auto policy on a vehicle used for business, and do you use actual vehicle expenses (premiums count at the business percentage) or the standard mileage rate (premiums are already included)?',
  insurance: 'Is this business liability, professional or property coverage (Schedule C line 15), an auto policy (follows your vehicle method), or health or life coverage (not a Schedule C expense)?',
  taxPrep: 'Only the part of a tax-preparation fee for your business schedules (Schedule C, SE and related forms) is a business expense. What portion related to the business?',
  legal: 'What matter was this for? Legal and professional fees are deductible when they relate to operating the business, not to personal matters.',
  education: 'What course or program was this, and does it maintain or improve skills in the business you already run rather than qualify you for a new trade?',
  bankFee: 'Is this fee on an account or card you use for the business, or on a personal account?',
  cardPayment: 'Is this a payment toward a card or loan balance (a transfer, not an expense) or a fee? The purchases on the card are the expenses.',
  processor: 'Is this a payout of your sales (business income at the gross amount, before fees), a processing fee, or a purchase you paid through the processor?',
  marketplacePayout: 'Is this a payout of your own sales (business income at the gross amount, before fees), a seller or listing fee, or a purchase?',
  freelancePlatform: 'Did you pay a freelancer through this platform for business work (contract labor), or is this a payout of your own earnings (business income at the gross amount)?',
  p2p: 'Was this a transfer between your own accounts, a payment to someone for business goods or services, or a personal payment? Name the payee and what it was for.',
  cash: 'Cash withdrawals are not expenses. What did you buy with the cash, and do you have a receipt?',
  taxPayment: 'Federal and state income or estimated tax payments are not business expenses. Was this an income or estimated tax payment, or a business license, sales tax remittance or payroll tax deposit (Schedule C line 23)?',
  investment: 'Investment purchases and retirement contributions are not business expenses (SEP-IRA and solo 401(k) contributions are a Schedule 1 adjustment). Confirm this was not a business purchase.',
  loan: 'Loan principal is not an expense; only the business share of interest may be deductible (Schedule C line 16b). Which loan is this, and how much of the payment was interest?',
  mortgage: 'Mortgage payments are not a business expense; a qualifying home office deducts a share of mortgage interest and taxes through Form 8829. Is this the home you live in?',
  homeUtility: 'Is this utility for a separate business location, or for your home? Home utilities count only through a qualifying home office (Form 8829, actual method).',
  rent: 'Is this rent for a separate business location, studio, booth or storage unit (deductible rent), or for the home you live in (home office rules only)?',
  postage: 'Was this postage or shipping for business shipments and mailings, or personal mail?',
  vehicleRegistration: 'Is this registration or licensing for a vehicle used in the business, and do you use actual expenses (fees count at the business percentage) or the standard mileage rate?',
  government: 'What was this government payment for? Business licenses, permits and regulatory fees are deductible (line 23); fines, personal registrations and court fees are not.',
  donation: 'Charitable donations are personal itemized deductions, not business expenses, unless you received advertising in return (a sponsorship). Which was this?',
  gift: 'Who received this gift and what is the business relationship? Business gifts are capped at $25 per recipient per year.',
  hardware: 'What did you buy, and was it material or a tool for a client job or business space, or for your home? Items over $2,500 need asset review.',
  electronics: 'What was purchased, when was it first used for business, and is it shared with personal use? Durable items may need depreciation or the de minimis election.',
  furniture: 'Is this furniture for a business location or a qualifying home office, or household furniture?',
  repair: 'Was this a repair to business property or equipment (line 21), or to your home (only a home-office share through Form 8829)?',
  storage: 'Is this storage for business inventory or equipment, or for household items?',
  beauty: 'Hair, makeup and grooming are personal even for client-facing or on-camera work. Was this a salon supply purchase for your own clients instead?',
  dryCleaning: 'Dry cleaning of everyday clothing is personal; cleaning while away on business travel is a travel expense. Which was this?',
  childcare: 'Childcare is not a business expense (it may qualify for the Form 2441 credit). Confirm this was not a business purchase.',
  medical: 'Medical and dental costs are personal itemized deductions (Schedule A), not business expenses. Was this actually a business supply?',
  entertainment: 'Entertainment such as tickets, shows and recreation is not deductible even when discussed with clients. Was this something else, such as a purchase for resale?',
  convenience: 'Was this fuel for business driving, or snacks and personal items?',
  sportingGoods: 'Sporting and fitness goods are personal unless used exclusively in your business, for example a trainer\'s client equipment or a product you resell. Which was this?',
  pet: 'Pet costs are personal unless the animal is part of the business (for example a breeder, groomer or a certified guard animal). Which was this?',
  deposit: 'Was this deposit a customer payment (business income), an owner contribution, a loan, a refund or a transfer between your own accounts?',
  transfer: 'Was this money moved between your own accounts, or a payment to someone for goods or services?',
  wages: 'W-2 wages, pensions, unemployment and tax refunds are not Schedule C income. Confirm this deposit is not a customer payment.',
  otherIncome: 'Was this deposit a customer payment for your business, or other non-business income?',
};
/** Shared templates imply the merchant signal; entries with a bespoke question set `subtype` explicitly when it matters. */
const SUBTYPE_BY_QUESTION = new Map<string, MerchantSubtype>([
  [Q.meal, 'meal'], [Q.fuel, 'fuel'], [Q.convenience, 'fuel'], [Q.localRide, 'local_transport'], [Q.parking, 'parking_tolls'],
  [Q.airfare, 'travel_air'], [Q.lodging, 'travel_lodging'], [Q.rentalCar, 'rental_car'], [Q.streaming, 'streaming'],
  [Q.groceries, 'groceries'], [Q.clothing, 'clothing'], [Q.gym, 'gym'], [Q.beauty, 'beauty'], [Q.sportingGoods, 'sporting_goods'],
  [Q.healthPremium, 'health_premium'], [Q.autoInsurance, 'auto_insurance'], [Q.insurance, 'insurance'], [Q.taxPrep, 'tax_prep'],
  [Q.legal, 'legal'], [Q.education, 'education'], [Q.gift, 'gift'], [Q.hardware, 'hardware'], [Q.electronics, 'electronics'],
  [Q.furniture, 'general_merchandise'], [Q.homeUtility, 'home_utility'], [Q.rent, 'rent'], [Q.postage, 'postage'],
  [Q.processor, 'processor'], [Q.marketplacePayout, 'processor'], [Q.repair, 'repair'],
]);
function inferSubtype(question: string | undefined): MerchantSubtype | undefined {
  if (!question) return undefined;
  const known = SUBTYPE_BY_QUESTION.get(question);
  if (known) return known;
  if (question.startsWith('What percentage of this ')) return 'phone_internet';
  if (/^Is this .* plan used in your business/.test(question)) return 'software';
  if (question.startsWith('What did you buy at ')) return 'general_merchandise';
  return undefined;
}

// --- Merchant table. Order matters: specific patterns before generic ones; first match wins. ------
// Section order: payment apps that carry a payee's name → brand patterns → generic keywords → processor prefixes.
export const MERCHANT_INTELLIGENCE: readonly MerchantIntelligenceEntry[] = [
  // Person-to-person payment apps: the descriptor names the payee, so these win over merchant names.
  entry(/\bvenmo\b/i, 'Venmo', null, null, 'transfer_or_deposit', { question: Q.p2p }),
  entry(/\bzelle\b/i, 'Zelle', null, null, 'transfer_or_deposit', { question: Q.p2p }),
  entry(/\bapple\s*cash\b|\bwise\s*(?:inc|us|transfer)\b|\bwise\.com\b|\bremitly\b|\bwestern\s*union\b|\bmoneygram\b/i, 'Payment app', null, null, 'transfer_or_deposit', { question: Q.p2p }),
  // Plain PayPal (transfers, fees). "PAYPAL *MERCHANT" purchases fall through to the brand table and the prefix fallback.
  entry(/\bpaypal\b(?!\s*\*)/i, 'PayPal', 'bank_and_payment_fees', '10', 'transfer_or_deposit', { question: Q.processor, subtype: 'processor' }),

  // Software, SaaS and web services (Schedule C line 18) -------------------------------------
  entry(/\badobe\b/i, 'Adobe', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Design and creative software subscription used for client work' }),
  entry(/\bfigma\b/i, 'Figma', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Design software subscription used for client work' }),
  entry(/\bcanva\b/i, 'Canva', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Design tool subscription used for business marketing and client deliverables' }),
  entry(/\bnotion\s*labs\b|\bnotion\b/i, 'Notion', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Workspace and project-notes software used to run the business' }),
  entry(/\bslack\b/i, 'Slack', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Team and client messaging software used in the business' }),
  entry(/\bzoom(?:\.us|\s*video|\s*communications)?\b/i, 'Zoom', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Video-conferencing plan used for client and business calls' }),
  entry(/\bgoogle\s*\*?\s*(?:ads?(?=\b|\d)|adwords|adwo)/i, 'Google Ads', 'advertising_marketing', '8', 'business_likely', { defaultPurpose: 'Online advertising promoting the business' }),
  entry(/\bgoogle\s*\*?\s*(?:workspace|gsuite|g\s*suite|svcs\s*apps|svcsapps)\b/i, 'Google Workspace', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Business email, calendar and document suite' }),
  entry(/\bgoogle\s*\*?\s*cloud\b/i, 'Google Cloud', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Cloud hosting and infrastructure for business or client projects' }),
  entry(/\bgoogle\s*\*?\s*(?:youtube|youtubeprem|yt\s*premium)\b|\byoutube\s*(?:premium|tv|music)\b/i, 'YouTube Premium', null, null, 'personal_likely', { question: Q.streaming }),
  entry(/\bgoogle\s*\*?\s*(?:storage|one|drive)\b/i, 'Google One / Drive storage', 'software_subscriptions', '18', 'mixed_use', { question: Q.software('Google storage') }),
  entry(/\bgoogle\s*\*?\s*fi\b|\bgoogle\s*fi\b/i, 'Google Fi', 'utilities_phone_internet', '25', 'mixed_use', { question: Q.phone('Google Fi') }),
  entry(/\bmicrosoft\s*\*?\s*(?:365|office|m365)\b|\bmsft\s*\*?\s*(?:365|office)|\boffice\s*365\b/i, 'Microsoft 365', 'software_subscriptions', '18', 'mixed_use', { question: Q.software('Microsoft 365'), notes: 'Family and personal plans are common; business plans are business_likely once the user confirms.' }),
  entry(/\bxbox\b|\bmicrosoft\s*\*?\s*xbox\b/i, 'Xbox', null, null, 'personal_likely', { question: Q.streaming }),
  entry(/\bmicrosoft\b/i, 'Microsoft', 'software_subscriptions', '18', 'needs_purpose', { question: Q.software('Microsoft') }),
  entry(/\bdropbox\b/i, 'Dropbox', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Cloud storage and file sharing for business files and client deliverables' }),
  entry(/\bgithub\b/i, 'GitHub', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Code hosting used for client and business software work' }),
  entry(/\bvercel\b/i, 'Vercel', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Web hosting for business or client sites' }),
  entry(/\bamazon\s*web\s*services\b|\baws\s*(?:emea|inc|services)?\b/i, 'Amazon Web Services', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Cloud hosting and infrastructure for business or client projects' }),
  entry(/\bsquarespace\b/i, 'Squarespace', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Business website hosting and builder subscription' }),
  entry(/\bwix\.?com\b|\bwix\b/i, 'Wix', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Business website hosting and builder subscription' }),
  entry(/\bshopify\b/i, 'Shopify', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Online store platform subscription for the business', notes: 'Negative amounts are Shopify Payments payouts (gross receipts before fees).', paysOut: true }),
  entry(/\bmailchimp\b|\bintuit\s*\*?\s*mailchimp\b/i, 'Mailchimp', 'advertising_marketing', '8', 'business_likely', { defaultPurpose: 'Email marketing platform for business newsletters and campaigns' }),
  entry(/\bquickbooks\b|\bintuit\s*\*?\s*(?:qbooks|qbo|quickbooks)\b|\bqbo\b/i, 'QuickBooks', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Bookkeeping software for the business' }),
  entry(/\bintuit\s*\*?\s*turbotax\b|\bturbotax\b/i, 'TurboTax', 'legal_professional', '17', 'mixed_use', { question: Q.taxPrep, subtype: 'tax_prep' }),
  entry(/\bintuit\b/i, 'Intuit', 'software_subscriptions', '18', 'needs_purpose', { question: 'Which Intuit product is this: QuickBooks (business bookkeeping), TurboTax (business portion only) or Mailchimp?' }),
  entry(/\bcalendly\b/i, 'Calendly', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Client scheduling software' }),
  entry(/\bloom\b/i, 'Loom', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Screen-recording tool for client communication' }),
  entry(/\b1password\b/i, '1Password', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Password manager securing business accounts' }),
  entry(/\bopenai\b|\bchatgpt\b/i, 'OpenAI / ChatGPT', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'AI assistant subscription used for business work' }),
  entry(/\bmidjourney\b/i, 'Midjourney', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'AI image tool used for client and marketing visuals' }),
  entry(/\bgrammarly\b/i, 'Grammarly', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Writing assistant used for client deliverables and business communication' }),
  entry(/\bzapier\b/i, 'Zapier', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Workflow automation for business systems' }),
  entry(/\bairtable\b/i, 'Airtable', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Database and project-tracking software for the business' }),
  entry(/\basana\b/i, 'Asana', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Project-management software for client work' }),
  entry(/\batlassian\b|\btrello\b|\bjira\b/i, 'Atlassian (Trello/Jira)', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Project-tracking software for client work' }),
  entry(/\bmonday\.com\b|\bmonday\s*com\b/i, 'monday.com', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Project-management software for the business' }),
  entry(/\bhubspot\b/i, 'HubSpot', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'CRM and marketing software for the business' }),
  entry(/\bsalesforce\b/i, 'Salesforce', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'CRM software for the business' }),
  entry(/\bsemrush\b|\bahrefs\b/i, 'SEO tools (Semrush/Ahrefs)', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'SEO research software for business or client marketing' }),
  entry(/\bbuffer\b|\bhootsuite\b|\blater\.com\b|\bplanoly\b/i, 'Social scheduling tool', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Social-media scheduling software for business marketing' }),
  entry(/\bgodaddy\b|\bnamecheap\b|\bcloudflare\b|\bhover\.com\b/i, 'Domain registrar / DNS', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Domain and DNS services for the business website' }),
  entry(/\bdigitalocean\b|\bheroku\b|\bnetlify\b|\blinode\b|\brender\.com\b/i, 'Cloud hosting provider', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Hosting for business or client applications' }),
  entry(/\btwilio\b|\bsendgrid\b/i, 'Twilio / SendGrid', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Messaging and email delivery services for business applications' }),
  entry(/\bdocusign\b|\bpandadoc\b|\bhellosign\b|\bdropbox\s*sign\b/i, 'E-signature service', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Contract e-signature service for client agreements' }),
  entry(/\bfreshbooks\b|\bwave\s*(?:apps|financial|accounting)\b|\bxero\b|\bbench\s*accounting\b|\bbill\.com\b/i, 'Bookkeeping software', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Bookkeeping and invoicing software for the business' }),
  entry(/\bhoneybook\b|\bdubsado\b|\b17hats\b|\bhellobonsai\b|\bbonsai\s*(?:inc|tech)\b/i, 'Client management platform', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Client contracts, invoicing and booking software for the business', paysOut: true }),
  entry(/\bgetharvest\b|\bharvest\s*(?:app|inc|time)\b|\btoggl\b|\bexpensify\b/i, 'Time and expense tracking', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Time and expense tracking software for the business' }),
  entry(/\bgusto\b|\badp\b|\bpaychex\b/i, 'Payroll service', 'other', '27a', 'business_likely', { defaultPurpose: 'Payroll or contractor-payment service fees for the business', notes: 'Wages paid through the service are line 26; contractor payments are line 11; only the service fee is line 27a.' }),
  entry(/\bkajabi\b|\bteachable\b|\bthinkific\b|\bpodia\b/i, 'Course platform', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Course and membership platform for selling the business\'s content', paysOut: true }),
  entry(/\bconvertkit\b|\bkit\.com\b|\bflodesk\b|\bklaviyo\b|\bbeehiiv\b|\bconstant\s*contact\b/i, 'Email marketing platform', 'advertising_marketing', '8', 'business_likely', { defaultPurpose: 'Email marketing platform for business newsletters' }),
  entry(/\bsubstack\b/i, 'Substack', 'software_subscriptions', '18', 'needs_purpose', { question: 'Is this a subscription you pay for reading (personal unless it is research for your business) or a payout of your own publication (business income)?' }),
  entry(/\bpatreon\b/i, 'Patreon', null, null, 'needs_purpose', { question: 'Is this a pledge you pay to a creator (personal) or a payout of your own Patreon (business income at the gross amount)?' }),
  entry(/\bepidemic\s*sound\b|\bartlist\b|\bmusicbed\b|\bsoundstripe\b/i, 'Licensed music library', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Licensed music for client videos and business content' }),
  entry(/\benvato\b|\bshutterstock\b|\bgetty\s*images\b|\badobe\s*stock\b|\bistock\b/i, 'Stock assets', 'supplies_small_tools', '22', 'business_likely', { defaultPurpose: 'Stock images, templates or footage used in client deliverables' }),
  entry(/\bdescript\b|\briverside\.?fm\b|\bcapcut\b|\bfinal\s*cut\b|\bdavinci\s*resolve\b/i, 'Video/audio editing software', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Editing software used to produce client or business content' }),
  entry(/\bpixieset\b|\bshootproof\b|\bpic-?time\b|\bsmugmug\b|\bzenfolio\b/i, 'Photo gallery delivery service', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Client photo gallery and delivery service for the photography business' }),
  entry(/\bbackblaze\b|\bcarbonite\b|\bidrive\b/i, 'Backup service', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Backup service protecting business and client files' }),
  entry(/\bmindbody\b|\btrainerize\b|\bmy\s*pt\s*hub\b/i, 'Fitness client software', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Client scheduling and training software for the fitness business' }),
  entry(/\bvagaro\b|\bstyleseat\b|\bbooksy\b|\bglossgenius\b|\bsquare\s*appointments\b/i, 'Salon booking software', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Client booking and payment software for the salon or studio business' }),
  entry(/\bsimplepractice\b|\btherapynotes\b|\btherapy\s*notes\b|\bdoxy\.me\b|\bheadway\s*(?:health|inc)?\b|\bhelloalma\b|\balma\s*(?:health|care)\b/i, 'Practice management software', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Practice management and telehealth software for the private practice' }),
  entry(/\bpsychology\s*today\b/i, 'Psychology Today listing', 'advertising_marketing', '8', 'business_likely', { defaultPurpose: 'Directory listing advertising the private practice' }),
  entry(/\bdistrokid\b|\btunecore\b|\bcd\s*baby\b/i, 'Music distribution service', 'other', '27a', 'business_likely', { defaultPurpose: 'Music distribution fees for the performing/recording business', notes: 'Negative amounts are royalty payouts (business income).', paysOut: true }),
  entry(/\bsplice\b|\bnative\s*instruments\b|\bableton\b|\bizotope\b/i, 'Music production software', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Music production software used for paid work' }),
  entry(/\bshipstation\b|\bpirate\s*ship\b|\bstamps\.com\b|\bshippo\b|\beasypost\b/i, 'Shipping software', 'supplies_small_tools', '22', 'business_likely', { defaultPurpose: 'Shipping labels and postage for business orders' }),
  entry(/\bprintful\b|\bprintify\b|\bgooten\b/i, 'Print-on-demand supplier', 'supplies_small_tools', '22', 'business_likely', { defaultPurpose: 'Products fulfilled for customer orders (cost of goods sold)', notes: 'Cost of goods sold belongs in Schedule C Part III (line 4) rather than line 22; the app records it as supplies pending COGS support.' }),
  entry(/\bdat\s*(?:solutions|load|freight|one)\b|\btruckstop\.?com\b/i, 'Load board subscription', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Freight load board subscription for the trucking business' }),
  entry(/\bkeeptruckin\b|\bmotive\s*(?:technologies|eld)?\b|\bsamsara\b/i, 'ELD / fleet software', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Electronic logging device and fleet software for the trucking business' }),
  entry(/\bgridwise\b|\beverlance\b|\bmileiq\b|\bstride\s*(?:tax|health)?\b|\bhurdlr\b/i, 'Mileage tracking app', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Mileage and expense tracking app for the driving business' }),
  entry(/\bzillow\b|\brealtor\.com\b|\bhomes\.com\b/i, 'Real estate lead platform', 'advertising_marketing', '8', 'business_likely', { defaultPurpose: 'Lead generation and listing advertising for the real estate business' }),
  entry(/\bshowingtime\b|\bdotloop\b|\bskyslope\b|\bsupra\b|\bsentrilock\b/i, 'Real estate transaction tools', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Showing, lockbox and transaction software for the real estate business' }),
  entry(/\bsnapdocs\b|\bsigning\s*order\b|\bnotary\s*rotary\b|\bsigningagent\.com\b/i, 'Notary signing platform', 'software_subscriptions', '18', 'business_likely', { defaultPurpose: 'Signing-order platform and notary tools for the loan signing business' }),
  entry(/\bnipr\b|\bsircon\b/i, 'Insurance licensing service', 'taxes_licenses', '23', 'business_likely', { defaultPurpose: 'State insurance license and appointment fees for the agency business' }),
  entry(/\bnursys\b|\bncsbn\b|\bboard\s*of\s*nursing\b/i, 'Nursing license service', 'taxes_licenses', '23', 'business_likely', { defaultPurpose: 'Nursing license verification or renewal fee for contract work' }),
  entry(/\bvistaprint\b|\bmoo\.com\b|\bmoo\s*print\b|\bgotprint\b/i, 'Print marketing (Vistaprint/MOO)', 'advertising_marketing', '8', 'business_likely', { defaultPurpose: 'Business cards and printed marketing materials' }),

  // Marketplaces, processors and freelance platforms -------------------------------------------
  entry(/\bupwork\b/i, 'Upwork', 'contract_labor', '11', 'needs_purpose', { question: Q.freelancePlatform, notes: 'Client-side payments are contract labor (line 11); freelancer-side payouts are income and Upwork fees are line 10.' }),
  entry(/\bfiverr\b/i, 'Fiverr', 'contract_labor', '11', 'needs_purpose', { question: Q.freelancePlatform }),
  entry(/\bstripe\b/i, 'Stripe', 'bank_and_payment_fees', '10', 'transfer_or_deposit', { question: Q.processor, subtype: 'processor' }),
  entry(/\bsquareup\b|\bsquare\s*(?:inc|fees?|subscription|capital)\b/i, 'Square', 'bank_and_payment_fees', '10', 'transfer_or_deposit', { question: Q.processor, subtype: 'processor' }),
  entry(/\betsy\b/i, 'Etsy', 'bank_and_payment_fees', '10', 'needs_purpose', { question: Q.marketplacePayout, notes: 'Seller fees are line 10; purchases of supplies are line 22; payouts are gross receipts.' }),
  entry(/\bamazon\s*(?:seller|services|svcs|payments\s*seller)\b|\bamzn\s*seller\b|\bamazon\.com\s*services\s*llc\b/i, 'Amazon Seller Services', 'bank_and_payment_fees', '10', 'needs_purpose', { question: Q.marketplacePayout }),
  entry(/\bebay\b/i, 'eBay', null, null, 'needs_purpose', { question: 'Was this an eBay purchase for the business (what item?), a seller fee (line 10), or a payout of your sales (income at the gross amount)?' }),
  entry(/\bfaire\b/i, 'Faire wholesale', 'supplies_small_tools', '22', 'business_likely', { defaultPurpose: 'Wholesale inventory purchased for resale', notes: 'Inventory is cost of goods sold (Schedule C Part III); recorded as supplies pending COGS support.' }),

  // Advertising ----------------------------------------------------------------------------------
  entry(/\bmeta\s*(?:ads?|platforms|pay)\b|\bfacebk\b|\bfacebook\s*(?:ads?|adverts?)\b|\binstagram\s*ads?\b/i, 'Meta Ads (Facebook/Instagram)', 'advertising_marketing', '8', 'business_likely', { defaultPurpose: 'Social-media advertising promoting the business' }),
  entry(/\blinkedin\s*(?:learning|lrn)\b/i, 'LinkedIn Learning', 'education_training', '27a', 'needs_purpose', { question: Q.education }),
  entry(/\blinkedin\s*(?:ads?|marketing)\b/i, 'LinkedIn Ads', 'advertising_marketing', '8', 'business_likely', { defaultPurpose: 'Professional-network advertising promoting the business' }),
  entry(/\blinkedin\b|\blnkd\b/i, 'LinkedIn Premium', 'software_subscriptions', '18', 'needs_purpose', { question: 'Is this LinkedIn Premium used to find clients or work for your business, or a job-search or personal plan?' }),
  entry(/\btiktok\s*(?:ads?|for\s*business)\b|\bpinterest\s*ads?\b|\bsnap(?:chat)?\s*ads?\b|\bx\s*ads\b|\btwitter\s*ads?\b/i, 'Social ads platform', 'advertising_marketing', '8', 'business_likely', { defaultPurpose: 'Social-media advertising promoting the business' }),
  entry(/\byelp\b/i, 'Yelp', 'advertising_marketing', '8', 'business_likely', { defaultPurpose: 'Business listing advertising on Yelp' }),
  entry(/\bangi\b|\bhomeadvisor\b|\bthumbtack\b|\bbark\.com\b|\bnextdoor\s*ads\b/i, 'Lead-generation service', 'advertising_marketing', '8', 'business_likely', { defaultPurpose: 'Paid customer leads for the service business' }),

  // Travel: airlines, lodging, rentals, rail (Schedule C line 24a) ---------------------------------
  entry(/\bdelta\s*dental\b/i, 'Delta Dental', 'other', null, 'schedule_1', { question: Q.healthPremium }),
  entry(/\bdelta\s*air(?:lines)?\b|\bdelta\s+\d{3,}/i, 'Delta Air Lines', 'travel', '24a', 'needs_purpose', { question: Q.airfare }),
  entry(/\bunited\s*health(?:care)?\b|\buhc\b/i, 'UnitedHealthcare', 'other', null, 'schedule_1', { question: Q.healthPremium }),
  entry(/\bunited\s*air(?:lines)?\b|\bunited\s+\d{3,}/i, 'United Airlines', 'travel', '24a', 'needs_purpose', { question: Q.airfare }),
  entry(/\bamerican\s*air(?:lines)?\b|\baa\.com\b|\bamerican\s+air\s+\d{3,}/i, 'American Airlines', 'travel', '24a', 'needs_purpose', { question: Q.airfare }),
  entry(/\bsouthwest\s*air(?:lines)?\b|\bsouthwes\b/i, 'Southwest Airlines', 'travel', '24a', 'needs_purpose', { question: Q.airfare }),
  entry(/\bjetblue\b/i, 'JetBlue', 'travel', '24a', 'needs_purpose', { question: Q.airfare }),
  entry(/\balaska\s*air(?:lines)?\b/i, 'Alaska Airlines', 'travel', '24a', 'needs_purpose', { question: Q.airfare }),
  entry(/\bspirit\s*air(?:lines)?\b|\bfrontier\s*air(?:lines)?\b|\ballegiant\b/i, 'Budget airline', 'travel', '24a', 'needs_purpose', { question: Q.airfare }),
  entry(/\bmarriott\b|\bwestin\b|\bsheraton\b|\bcourtyard\b|\bresidence\s*inn\b/i, 'Marriott', 'travel', '24a', 'needs_purpose', { question: Q.lodging }),
  entry(/\bhilton\b|\bhampton\s*inn\b|\bdoubletree\b|\bembassy\s*suites\b/i, 'Hilton', 'travel', '24a', 'needs_purpose', { question: Q.lodging }),
  entry(/\bhyatt\b/i, 'Hyatt', 'travel', '24a', 'needs_purpose', { question: Q.lodging }),
  entry(/\bholiday\s*inn\b|\bihg\b|\bbest\s*western\b|\bla\s*quinta\b|\bmotel\s*6\b/i, 'Hotel chain', 'travel', '24a', 'needs_purpose', { question: Q.lodging }),
  entry(/\bairbnb\b/i, 'Airbnb', 'travel', '24a', 'needs_purpose', { question: Q.lodging }),
  entry(/\bvrbo\b|\bhomeaway\b/i, 'Vrbo', 'travel', '24a', 'needs_purpose', { question: Q.lodging }),
  entry(/\bexpedia\b|\bbooking\.com\b|\bhotels\.com\b|\bpriceline\b|\bkayak\b/i, 'Travel booking site', 'travel', '24a', 'needs_purpose', { question: Q.airfare }),
  entry(/\bhertz\b/i, 'Hertz', 'travel', '24a', 'needs_purpose', { question: Q.rentalCar }),
  entry(/\benterprise\s*(?:rent|car)/i, 'Enterprise Rent-A-Car', 'travel', '24a', 'needs_purpose', { question: Q.rentalCar }),
  entry(/\bavis\b|\bbudget\s*(?:rent|car|truck)|\bnational\s*car\s*rental\b|\balamo\s*rent/i, 'Car rental', 'travel', '24a', 'needs_purpose', { question: Q.rentalCar }),
  entry(/\bturo\b/i, 'Turo', 'travel', '24a', 'needs_purpose', { question: Q.rentalCar }),
  entry(/\buber\s*\*?\s*eats\b|\bubereats\b/i, 'Uber Eats', 'meals_50', '24b', 'needs_purpose', { question: Q.meal }),
  entry(/\buber\b/i, 'Uber', 'vehicle_expense', '9', 'needs_purpose', { question: Q.localRide, subtype: 'local_transport', notes: 'Negative amounts on a driver\'s account are Uber payouts (business income at the gross amount).' }),
  entry(/\blyft\b/i, 'Lyft', 'vehicle_expense', '9', 'needs_purpose', { question: Q.localRide, subtype: 'local_transport' }),
  entry(/\bamtrak\b/i, 'Amtrak', 'travel', '24a', 'needs_purpose', { question: Q.airfare }),
  entry(/\bmta\b|\bmetrocard\b|\bomny\b|\bbart\b|\bwmata\b|\bsepta\b|\bcta\s*(?:ventra|transit)\b|\bventra\b|\bclipper\b/i, 'Public transit', 'vehicle_expense', '9', 'needs_purpose', { question: Q.localRide, subtype: 'local_transport' }),
  // Parking and tolls (Schedule C line 9, deductible beside the standard mileage rate). A parking ticket is a fine, matched below.
  entry(/\bparkmobile\b|\bspothero\b|\bpaybyphone\b|\blaz\s*parking\b|\bimpark(?:\d|\b)|\bpark\s*whiz\b|\bparking\b(?!\s*(?:ticket|violation|citation|fine))/i, 'Parking', 'parking_tolls', '9', 'needs_purpose', { question: Q.parking, subtype: 'parking_tolls' }),
  entry(/\be-?z\s*pass\b|\bfastrak\b|\bsunpass\b|\btxtag\b|\bpeach\s*pass\b|\bipass\b|\bturnpike\b|\bthruway\b|\btoll(?:s|way|\s*road)?\b(?!\s*(?:violation|citation))/i, 'Tolls', 'parking_tolls', '9', 'needs_purpose', { question: Q.parking, subtype: 'parking_tolls' }),
  entry(/\bprepass\b|\bbestpass\b/i, 'Trucking toll service', 'parking_tolls', '9', 'business_likely', { defaultPurpose: 'Toll and weigh-station bypass service for the trucking business', subtype: 'parking_tolls' }),

  // Fuel and vehicle (Schedule C line 9) ---------------------------------------------------------
  entry(/\bcostco\s*(?:gas|fuel)\b/i, 'Costco Gas', 'vehicle_expense', '9', 'needs_purpose', { question: Q.fuel, subtype: 'fuel' }),
  entry(/\bshell\s*(?:oil|serv|gas|\d)/i, 'Shell', 'vehicle_expense', '9', 'needs_purpose', { question: Q.fuel, subtype: 'fuel' }),
  entry(/\bchevron\b|\btexaco\b/i, 'Chevron', 'vehicle_expense', '9', 'needs_purpose', { question: Q.fuel, subtype: 'fuel' }),
  entry(/\bexxon(?:mobil)?\b|\bmobil\s*(?:oil|gas|\d|#)/i, 'ExxonMobil', 'vehicle_expense', '9', 'needs_purpose', { question: Q.fuel, subtype: 'fuel' }),
  entry(/\bbp\s*(?:#|\d|products|oil|gas|amoco)|\bamoco\b/i, 'BP', 'vehicle_expense', '9', 'needs_purpose', { question: Q.fuel, subtype: 'fuel' }),
  entry(/\bspeedway\b|\bsunoco\b|\barco\b|\bvalero\b|\bcitgo\b|\bphillips\s*66\b|\bconoco\b|\bmarathon\s*(?:petro|gas|oil|#|\d)|\bsinclair\b|\bracetrac\b|\bquiktrip\b|\bqt\s*\d/i, 'Gas station', 'vehicle_expense', '9', 'needs_purpose', { question: Q.fuel, subtype: 'fuel' }),
  entry(/\bpilot\s*(?:travel|flying|fj|#|\d)|\blove'?s\s*(?:travel|country|#|\d)|\btravelcenters\b|\bta\s*petro\b|\bta\s*#\s*\d/i, 'Truck stop', 'vehicle_expense', '9', 'business_likely', { defaultPurpose: 'Diesel fuel and truck stop costs for the trucking business', subtype: 'fuel', notes: 'Owner-operators of heavy trucks generally must use actual expenses, not standard mileage.' }),
  entry(/\bwawa\b|\bcircle\s*k\b|\b7-?\s?eleven\b|\bsheetz\b|\bcasey'?s\b|\bkwik\s*trip\b/i, 'Convenience store / fuel', 'vehicle_expense', '9', 'needs_purpose', { question: Q.convenience, subtype: 'fuel' }),
  entry(/\bjiffy\s*lube\b|\bvalvoline\b|\bpep\s*boys\b|\bautozone\b|\bo'?reilly\s*auto\b|\badvance\s*auto\b|\bfirestone\b|\bdiscount\s*tire\b|\bcar\s*wash\b/i, 'Auto service / parts', 'vehicle_expense', '9', 'needs_purpose', { question: 'Is this vehicle used for business, what share of its miles are business, and do you use actual expenses (repairs and parts count) or the standard mileage rate (they are already included)?', subtype: 'auto_service' }),
  entry(/\bgeico\b/i, 'GEICO', 'vehicle_expense', '9', 'needs_purpose', { question: Q.autoInsurance, subtype: 'auto_insurance' }),
  entry(/\bprogressive\s*(?:ins|insurance|casualty|\*|$)/i, 'Progressive Insurance', 'vehicle_expense', '9', 'needs_purpose', { question: Q.autoInsurance, subtype: 'auto_insurance' }),
  entry(/\bmercury\s*(?:ins|insurance|general)\b|\broot\s*insurance\b/i, 'Auto insurer', 'vehicle_expense', '9', 'needs_purpose', { question: Q.autoInsurance, subtype: 'auto_insurance' }),
  entry(/\blemonade\s*(?:ins|insurance)?\b/i, 'Lemonade', 'insurance', '15', 'needs_purpose', { question: Q.insurance, notes: 'Renters, homeowners, pet and car policies; a home policy belongs to the home office review, not to business insurance.' }),
  entry(/\bstate\s*farm\b/i, 'State Farm', 'insurance', '15', 'needs_purpose', { question: Q.insurance }),
  entry(/\ballstate\b|\bliberty\s*mutual\b|\bfarmers\s*ins(?:urance)?\b|\bnationwide\s*ins(?:urance)?\b|\busaa\s*(?:p&c|insurance)\b|\btravelers\s*ins(?:urance)?\b/i, 'Insurance carrier', 'insurance', '15', 'needs_purpose', { question: Q.insurance }),
  entry(/\bdmv\b|\bdept\.?\s*of\s*motor\s*vehicles\b|\bmotor\s*vehicle\s*(?:admin|division|dept)/i, 'DMV', 'vehicle_expense', '9', 'needs_purpose', { question: Q.vehicleRegistration }),

  // Office, supplies, hardware and general merchandise (Schedule C line 22 / asset review) --------
  entry(/\bstaples\b/i, 'Staples', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.item('Staples') }),
  entry(/\boffice\s*depot\b|\bofficemax\b|\boffice\s*max\b/i, 'Office Depot / OfficeMax', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.item('Office Depot') }),
  entry(/\bamazon\s*prime\b|\bprime\s*video\b|\bamzn\s*prime\b/i, 'Amazon Prime', 'software_subscriptions', '18', 'mixed_use', { question: 'Amazon Prime is a household membership unless it is used mainly for business shipping and purchases. What share is business?', subtype: 'software' }),
  entry(/\bamazon\b|\bamzn\b/i, 'Amazon', 'supplies_small_tools', '22', 'needs_purpose', { question: 'What did you order from Amazon, and how is it used in your business? Household items are personal; durable items over $2,500 need asset review.', subtype: 'general_merchandise' }),
  // Repair services (Schedule C line 21): Geek Squad is billed under the Best Buy name, so it must come before the store entry.
  entry(/\bgeek\s*squad\b/i, 'Best Buy Geek Squad', 'repairs_maintenance', '21', 'needs_purpose', { question: Q.repair }),
  entry(/\bubreakifix\b|\bu\s*break\s*i\s*fix\b|\bcpr\s*cell\s*phone\s*repair\b|\bappliance\s*repair\b|\bmr\.?\s*appliance\b|\bsears\s*home\s*serv/i, 'Repair service', 'repairs_maintenance', '21', 'needs_purpose', { question: Q.repair }),
  entry(/\bbest\s*buy\b/i, 'Best Buy', 'equipment', '13', 'needs_purpose', { question: Q.electronics }),
  entry(/\bapple\.com\/bill\b|\bapple\s*\.?com\s*bill\b|\bitunes\b|\bapple\s*services\b/i, 'Apple services (iCloud/apps)', 'software_subscriptions', '18', 'mixed_use', { question: 'Apple.com/bill covers iCloud, apps, music and TV. Which subscription is this, and what share is business use?', subtype: 'software' }),
  entry(/\bapple\s*store\b|\bapple\.com\b|\bapple\s*retail\b/i, 'Apple Store', 'equipment', '13', 'needs_purpose', { question: Q.electronics }),
  entry(/\bb\s*&\s*h\s*(?:photo|foto)?\b|\bbhphoto\b/i, 'B&H Photo Video', 'equipment', '13', 'needs_purpose', { question: Q.electronics }),
  entry(/\badorama\b|\bkeh\s*camera\b|\bmpb\.com\b|\bmpb\b/i, 'Camera retailer', 'equipment', '13', 'needs_purpose', { question: Q.electronics }),
  entry(/\blensrentals\b|\bborrowlenses\b|\bshare\s*grid\b/i, 'Camera gear rental', 'rent', '20a', 'business_likely', { defaultPurpose: 'Camera and lens rental for a paid shoot' }),
  entry(/\bmicro\s*center\b|\bnewegg\b/i, 'Computer retailer', 'equipment', '13', 'needs_purpose', { question: Q.electronics }),
  entry(/\bhome\s*depot\b|\bhomedepot\b/i, 'The Home Depot', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.hardware }),
  entry(/\blowe'?s\b/i, "Lowe's", 'supplies_small_tools', '22', 'needs_purpose', { question: Q.hardware }),
  entry(/\bharbor\s*freight\b|\bace\s*hardware\b|\bmenards\b|\btrue\s*value\b/i, 'Hardware store', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.hardware }),
  entry(/\bferguson\b|\bsiteone\b|\bgrainger\b|\bzoro\b|\bfastenal\b/i, 'Trade supplier', 'supplies_small_tools', '22', 'business_likely', { defaultPurpose: 'Materials and supplies for client jobs' }),
  entry(/\bikea\b/i, 'IKEA', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.furniture }),
  entry(/\bcostco\b/i, 'Costco', 'supplies_small_tools', '22', 'needs_purpose', { question: 'What did you buy at Costco, and how much of it is for the business? A household run is personal, and the membership itself is mixed use.', subtype: 'general_merchandise' }),
  entry(/\bsam'?s\s*club\b/i, "Sam's Club", 'supplies_small_tools', '22', 'needs_purpose', { question: Q.item("Sam's Club") }),
  entry(/\btarget\b/i, 'Target', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.item('Target') }),
  entry(/\bwal-?mart\b|\bwm\s*supercenter\b|\bwalmart\b/i, 'Walmart', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.item('Walmart') }),
  entry(/\buline\b/i, 'Uline', 'supplies_small_tools', '22', 'business_likely', { defaultPurpose: 'Packaging and shipping supplies for business orders' }),
  entry(/\bfedex\s*office\b|\bfedex\s*kinkos\b/i, 'FedEx Office', 'supplies_small_tools', '22', 'business_likely', { defaultPurpose: 'Printing and copying for business documents' }),
  entry(/\bfedex\b|\bups\s*store\b|\bunited\s*parcel\b|\bups\b/i, 'Shipping carrier', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.postage }),
  entry(/\busps\b|\bpostal\s*service\b|\bpost\s*office\b|\bstamps\b/i, 'USPS', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.postage }),
  entry(/\bsweetwater\b|\bguitar\s*center\b|\bsam\s*ash\b|\breverb\.com\b|\breverb\b|\bmusician'?s\s*friend\b/i, 'Music gear retailer', 'equipment', '13', 'needs_purpose', { question: Q.electronics }),
  entry(/\bsally\s*beauty\b|\bcosmoprof\b|\bsalon\s*centric\b/i, 'Salon supply', 'supplies_small_tools', '22', 'business_likely', { defaultPurpose: 'Professional salon products and supplies used on clients' }),
  entry(/\bmassage\s*warehouse\b|\bearthlite\b/i, 'Massage supply', 'supplies_small_tools', '22', 'business_likely', { defaultPurpose: 'Massage table, linens and oils used with clients' }),

  // Meals (Schedule C line 24b) -------------------------------------------------------------------
  entry(/\bstarbucks\b/i, 'Starbucks', 'meals_50', '24b', 'needs_purpose', { question: Q.meal }),
  entry(/\bchipotle\b/i, 'Chipotle', 'meals_50', '24b', 'needs_purpose', { question: Q.meal }),
  entry(/\bdoordash\b|\bdd\s*\*\s*doordash\b/i, 'DoorDash', 'meals_50', '24b', 'needs_purpose', { question: Q.meal, notes: 'Negative amounts on a Dasher\'s account are DoorDash payouts (business income).' }),
  entry(/\bgrubhub\b|\bseamless\b/i, 'Grubhub', 'meals_50', '24b', 'needs_purpose', { question: Q.meal }),
  entry(/\bsweetgreen\b/i, 'Sweetgreen', 'meals_50', '24b', 'needs_purpose', { question: Q.meal }),
  entry(/\bpanera\b|\bdunkin\b|\bmcdonald'?s\b|\bwendy'?s\b|\btaco\s*bell\b|\bsubway\b|\bpeet'?s\b|\bblue\s*bottle\b|\bphilz\b/i, 'Quick-service restaurant', 'meals_50', '24b', 'needs_purpose', { question: Q.meal }),
  entry(/\binstacart\b/i, 'Instacart', null, null, 'personal_likely', { question: Q.groceries, notes: 'Negative amounts on a shopper\'s account are Instacart payouts (business income).' }),

  // Telecom and utilities (Schedule C line 25) -----------------------------------------------------
  entry(/\bverizon\b|\bvzw(?:rlss)?\b/i, 'Verizon', 'utilities_phone_internet', '25', 'mixed_use', { question: Q.phone('Verizon') }),
  entry(/\bat\s*&\s*t\b|\batt\s*\*|\battbill\b|\bat&t\b/i, 'AT&T', 'utilities_phone_internet', '25', 'mixed_use', { question: Q.phone('AT&T') }),
  entry(/\bt-?mobile\b|\bmetro\s*by\s*t-?mobile\b|\bmetropcs\b/i, 'T-Mobile', 'utilities_phone_internet', '25', 'mixed_use', { question: Q.phone('T-Mobile') }),
  entry(/\bmint\s*mobile\b|\bvisible\b|\bcricket\s*wireless\b|\bboost\s*mobile\b/i, 'Mobile carrier', 'utilities_phone_internet', '25', 'mixed_use', { question: Q.phone('mobile') }),
  entry(/\bcomcast\b|\bxfinity\b/i, 'Comcast / Xfinity', 'utilities_phone_internet', '25', 'mixed_use', { question: Q.phone('internet') }),
  entry(/\bspectrum\b|\bcharter\s*comm/i, 'Spectrum', 'utilities_phone_internet', '25', 'mixed_use', { question: Q.phone('internet') }),
  entry(/\bcox\s*comm(?:unications)?\b|\bfrontier\s*comm(?:unications)?\b|\bcenturylink\b|\blumen\b|\boptimum\b|\bastound\b|\bgoogle\s*fiber\b|\bstarlink\b/i, 'Internet provider', 'utilities_phone_internet', '25', 'mixed_use', { question: Q.phone('internet') }),
  entry(/\bpg&e\b|\bpacific\s*gas\b|\bcon\s*ed(?:ison)?\b|\bduke\s*energy\b|\bsouthern\s*california\s*edison\b|\bsce\b|\bnational\s*grid\b|\bxcel\s*energy\b|\bdominion\s*energy\b|\bfpl\b|\bgeorgia\s*power\b|\bcomed\b|\bpse&g\b|\bdte\s*energy\b|\bameren\b|\bentergy\b|\bwater\s*(?:dept|district|utility|bill)\b|\bwaste\s*management\b/i, 'Utility company', 'utilities_phone_internet', '25', 'needs_purpose', { question: Q.homeUtility }),

  // Coworking and rent (Schedule C line 20b) -------------------------------------------------------
  entry(/\bwework\b/i, 'WeWork', 'rent', '20b', 'business_likely', { defaultPurpose: 'Coworking space rented for business work', subtype: 'coworking' }),
  entry(/\bregus\b|\biwg\b|\bspaces\s*(?:coworking|works)\b/i, 'Regus', 'rent', '20b', 'business_likely', { defaultPurpose: 'Office or coworking space rented for the business', subtype: 'coworking' }),
  entry(/\bindustrious\b|\bconvene\b|\bthe\s*wing\b|\bcoworking\b/i, 'Coworking space', 'rent', '20b', 'business_likely', { defaultPurpose: 'Coworking space rented for business work', subtype: 'coworking' }),
  entry(/\bpublic\s*storage\b|\bextra\s*space\s*storage\b|\bcubesmart\b|\blife\s*storage\b|\bu-?haul\s*storage\b/i, 'Self storage', 'rent', '20b', 'needs_purpose', { question: Q.storage }),
  entry(/\bproperty\s*management\b|\bapartments?\b|\brealty\b.*\brent\b|\brent\s*payment\b|\bbilt\b|\bavail\s*rent\b/i, 'Rent payment', 'rent', '20b', 'needs_purpose', { question: Q.rent }),
  entry(/\bsola\s*salon\b|\bphenix\s*salon\b|\bsalon\s*suite\b|\bbooth\s*rent\b|\bchair\s*rent\b/i, 'Salon suite / booth rent', 'rent', '20b', 'business_likely', { defaultPurpose: 'Booth or suite rent for serving my own clients', subtype: 'rent' }),

  // Business, auto and health insurance ------------------------------------------------------------
  entry(/\bhiscox\b/i, 'Hiscox', 'insurance', '15', 'business_likely', { defaultPurpose: 'Business liability or professional (E&O) insurance for the business', subtype: 'insurance' }),
  entry(/\bnext\s*insurance\b|\bnextinsurance\b/i, 'Next Insurance', 'insurance', '15', 'business_likely', { defaultPurpose: 'Small-business liability insurance for the business', subtype: 'insurance' }),
  entry(/\bthimble\b|\bsimply\s*business\b|\bthe\s*hartford\b|\bbiberk\b|\binsureon\b|\bcoverwallet\b/i, 'Business insurer', 'insurance', '15', 'business_likely', { defaultPurpose: 'Business liability or professional insurance for the business', subtype: 'insurance' }),
  entry(/\bblue\s*(?:shield|cross)\b|\banthem\b|\bbcbs\b|\bcarefirst\b|\bpremera\b|\bregence\b|\bhighmark\b/i, 'Blue Cross / Blue Shield', 'other', null, 'schedule_1', { question: Q.healthPremium }),
  entry(/\baetna\b/i, 'Aetna', 'other', null, 'schedule_1', { question: Q.healthPremium }),
  entry(/\bcigna\b/i, 'Cigna', 'other', null, 'schedule_1', { question: Q.healthPremium }),
  entry(/\bkaiser\s*(?:permanente|foundation|fdn)?\b/i, 'Kaiser Permanente', 'other', null, 'schedule_1', { question: Q.healthPremium }),
  entry(/\boscar\s*health\b|\bhumana\b|\bmolina\b|\bambetter\b|\bhealthcare\.gov\b|\bcovered\s*california\b|\bhealth\s*net\b|\bcentene\b/i, 'Health insurer / exchange', 'other', null, 'schedule_1', { question: Q.healthPremium }),
  entry(/\bvsp\b|\beyemed\b|\bguardian\s*dental\b|\bmetlife\s*dental\b/i, 'Dental / vision plan', 'other', null, 'schedule_1', { question: Q.healthPremium }),

  // Legal, tax and professional services (Schedule C line 17) ------------------------------------
  // Formation and filing services bill their own service fee (line 17); a state filing fee the taxpayer names in the
  // purpose (annual report, business licence) is re-placed on line 23 by the grounding layer.
  entry(/\blegalzoom\b/i, 'LegalZoom', 'legal_professional', '17', 'business_likely', { defaultPurpose: 'Business formation, registered agent or legal filing service', subtype: 'legal', notes: 'State filing fees collected on the taxpayer\'s behalf are line 23; the service fee is line 17.' }),
  entry(/\brocket\s*lawyer\b|\bzenbusiness\b|\bincfile\b|\bbizee\b|\bnorthwest\s*registered\s*agent\b/i, 'Business legal service', 'legal_professional', '17', 'business_likely', { defaultPurpose: 'Business legal document or registered agent service', subtype: 'legal', notes: 'State filing fees collected on the taxpayer\'s behalf are line 23; the service fee is line 17.' }),
  entry(/\bh\s*&\s*r\s*block\b|\bhrblock\b/i, 'H&R Block', 'legal_professional', '17', 'mixed_use', { question: Q.taxPrep, subtype: 'tax_prep' }),
  entry(/\btaxact\b|\btaxslayer\b|\bfreetaxusa\b|\bjackson\s*hewitt\b|\bliberty\s*tax\b/i, 'Tax preparation service', 'legal_professional', '17', 'mixed_use', { question: Q.taxPrep, subtype: 'tax_prep' }),
  entry(/\bcpa\b|\baccounting\b|\bbookkeep/i, 'Accounting / bookkeeping service', 'legal_professional', '17', 'needs_purpose', { question: Q.legal }),
  entry(/\blaw\s*(?:office|firm|group)\b|\battorney\b|\besq\b/i, 'Law firm', 'legal_professional', '17', 'needs_purpose', { question: Q.legal }),

  // Education and training (Schedule C line 27a) --------------------------------------------------
  entry(/\budemy\b/i, 'Udemy', 'education_training', '27a', 'needs_purpose', { question: Q.education }),
  entry(/\bcoursera\b/i, 'Coursera', 'education_training', '27a', 'needs_purpose', { question: Q.education }),
  entry(/\bmasterclass\b/i, 'MasterClass', 'education_training', '27a', 'needs_purpose', { question: Q.education }),
  entry(/\bskillshare\b|\bdomestika\b|\bcreativelive\b/i, 'Skillshare', 'education_training', '27a', 'needs_purpose', { question: Q.education }),
  entry(/\bpluralsight\b|\bfrontend\s*masters\b|\begghead\b|\bcodecademy\b|\bdatacamp\b/i, 'Developer training', 'education_training', '27a', 'needs_purpose', { question: Q.education }),
  entry(/\bwyzant\b|\boutschool\b|\bvarsity\s*tutors\b/i, 'Tutoring platform', null, null, 'needs_purpose', { question: 'Is this a platform fee or payout for tutoring you provide (business), or tutoring you bought for your family (personal)?' }),
  entry(/\bkaplan\b|\bprinceton\s*review\b|\bbar\s*review\b|\bbarbri\b|\bthemis\b/i, 'Exam prep', 'education_training', '27a', 'personal_likely', { question: 'Exam preparation that qualifies you for a new profession or license is not deductible; continuing education in your current business is. Which was this?', subtype: 'education' }),

  // Dues: gyms and clubs (personal) vs. professional associations (deductible) --------------------
  entry(/\bplanet\s*fitness\b/i, 'Planet Fitness', 'dues_and_memberships', '27a', 'personal_likely', { question: Q.gym }),
  entry(/\bequinox\b/i, 'Equinox', 'dues_and_memberships', '27a', 'personal_likely', { question: Q.gym }),
  entry(/\bla\s*fitness\b|\b24\s*hour\s*fitness\b|\bcrunch\s*fitness\b|\banytime\s*fitness\b|\bymca\b|\blifetime\s*fitness\b|\blife\s*time\b|\bgold'?s\s*gym\b|\borangetheory\b|\bcrossfit\b|\bsoulcycle\b|\bbarry'?s\b|\bf45\b|\bpure\s*barre\b|\bcorepower\b/i, 'Gym / fitness studio', 'dues_and_memberships', '27a', 'personal_likely', { question: Q.gym }),
  entry(/\bpeloton\b/i, 'Peloton', 'dues_and_memberships', '27a', 'personal_likely', { question: Q.gym }),
  entry(/\bclasspass\b/i, 'ClassPass', 'dues_and_memberships', '27a', 'personal_likely', { question: Q.gym }),
  entry(/\bcountry\s*club\b|\bgolf\s*club\b|\bathletic\s*club\b|\bsoho\s*house\b|\byacht\s*club\b/i, 'Social / country club', 'dues_and_memberships', '27a', 'personal_likely', { question: 'Club membership dues (country, golf, athletic, social and dining clubs) are not deductible even when used for networking. Was this a separately billed business meal or event instead?' }),
  entry(/\baiga\b/i, 'AIGA (design association)', 'dues_and_memberships', '27a', 'business_likely', { defaultPurpose: 'Professional design association dues' }),
  entry(/\bnational\s*association\s*of\s*realtors\b|\bnar\s*dues\b|\brealtor(?:s)?\s*(?:association|assn|board)\b|\bassociation\s*of\s*realtors\b|\bmls\s*(?:dues|fee|listing)/i, 'REALTOR association / MLS', 'dues_and_memberships', '27a', 'business_likely', { defaultPurpose: 'REALTOR association and MLS dues for the real estate business' }),
  entry(/\baicpa\b|\bstate\s*society\s*of\s*cpas\b|\bnatp\b|\bnaea\b/i, 'Accounting association', 'dues_and_memberships', '27a', 'business_likely', { defaultPurpose: 'Professional accounting association dues' }),
  entry(/\bamerican\s*bar\s*association\b|\bstate\s*bar\b|\bbar\s*association\b/i, 'Bar association', 'dues_and_memberships', '27a', 'business_likely', { defaultPurpose: 'Bar association dues and license fees for the law practice' }),
  entry(/\bppa\b|\bprofessional\s*photographers\b|\basmp\b|\bwppi\b/i, 'Photography association', 'dues_and_memberships', '27a', 'business_likely', { defaultPurpose: 'Professional photography association dues' }),
  entry(/\bamta\b|\babmp\b/i, 'Massage therapy association', 'dues_and_memberships', '27a', 'business_likely', { defaultPurpose: 'Massage therapy association dues and liability coverage' }),
  entry(/\bnna\b|\bnational\s*notary\b/i, 'National Notary Association', 'dues_and_memberships', '27a', 'business_likely', { defaultPurpose: 'Notary association dues and signing-agent certification' }),
  entry(/\bnasw\b|\bapa\s*(?:membership|dues)\b|\bamerican\s*counseling\b|\baamft\b/i, 'Counseling association', 'dues_and_memberships', '27a', 'business_likely', { defaultPurpose: 'Professional counseling association dues' }),
  entry(/\bieee\b|\bacm\s*(?:membership|dues)\b|\bshrm\b|\bpmi\s*(?:membership|dues)\b|\bnahb\b|\bnfib\b/i, 'Professional association', 'dues_and_memberships', '27a', 'business_likely', { defaultPurpose: 'Professional or trade association dues' }),
  entry(/\bchamber\s*of\s*commerce\b/i, 'Chamber of Commerce', 'dues_and_memberships', '27a', 'business_likely', { defaultPurpose: 'Chamber of commerce membership for the business' }),
  entry(/\bnasm\b|\bace\s*fitness\b|\bissa\b|\bacsm\b/i, 'Fitness certification body', 'education_training', '27a', 'business_likely', { defaultPurpose: 'Personal-trainer certification renewal and continuing education' }),

  // Banks, cards and fees ------------------------------------------------------------------------
  entry(/\bmonthly\s*(?:service|maintenance)\s*fee\b|\bservice\s*charge\b|\bwire\s*(?:transfer\s*)?fee\b|\boverdraft\s*fee\b|\bnsf\s*fee\b|\bforeign\s*transaction\s*fee\b|\batm\s*fee\b/i, 'Bank fee', 'bank_and_payment_fees', '10', 'needs_purpose', { question: Q.bankFee }),
  entry(/\bautopay\b|\bpayment\s*thank\s*you\b|\bcard\s*(?:pmt|payment)\b|\bcredit\s*crd\s*(?:autopay|epay)\b|\bonline\s*payment\b.*\bcard\b|\bepay\b/i, 'Card payment', null, null, 'transfer_or_deposit', { question: Q.cardPayment }),
  entry(/\bamerican\s*express\b|\bamex\b/i, 'American Express', 'bank_and_payment_fees', '10', 'needs_purpose', { question: 'Is this the card\'s annual fee (deductible when the card is used for the business) or a payment toward the balance (a transfer, not an expense)?' }),
  entry(/\bmercury\b|\bnovo\s*(?:platform|bank|inc)\b|\bbanknovo\b|\brelay\s*(?:financial|fi|bank)\b|\brelayfi\b|\bbluevine\b|\bfound\s*(?:bank|financial)\b|\blili\s*(?:app|bank|inc)\b|\bgrasshopper\s*bank\b/i, 'Business bank', 'bank_and_payment_fees', '10', 'business_likely', { defaultPurpose: 'Business banking fee on the account used for the business' }),
  entry(/\bchase\b|\bjpmorgan\b/i, 'Chase', 'bank_and_payment_fees', '10', 'needs_purpose', { question: Q.cardPayment }),
  entry(/\bbank\s*of\s*america\b|\bbofa\b|\bbkofamerica\b/i, 'Bank of America', 'bank_and_payment_fees', '10', 'needs_purpose', { question: Q.cardPayment }),
  entry(/\bwells\s*fargo\b/i, 'Wells Fargo', 'bank_and_payment_fees', '10', 'needs_purpose', { question: Q.cardPayment }),
  entry(/\bcapital\s*one\b|\bciti(?:bank|\s*card|\s*cards)?\b|\bdiscover\s*(?:card|bank|fin)/i, 'Bank / card issuer', 'bank_and_payment_fees', '10', 'needs_purpose', { question: Q.cardPayment }),
  entry(/\bbrex\b|\bramp\b|\bdivvy\b/i, 'Business card platform', 'bank_and_payment_fees', '10', 'needs_purpose', { question: Q.cardPayment }),

  // Government, taxes and licenses (Schedule C line 23 or not an expense) ---------------------------
  entry(/\birs\b|\busataxpymt\b|\bus\s*treasury\b|\binternal\s*revenue\b|\beftps\b/i, 'IRS', null, null, 'not_an_expense', { question: Q.taxPayment, notes: 'Federal income and estimated tax payments (§275) are never Schedule C expenses; payroll tax deposits through EFTPS need the payroll context.' }),
  entry(/\bfranchise\s*tax\s*b(?:oar)?d\b|\bftb\b|\bnys\s*dtf\b|\bny\s*state\s*(?:tax|dtf)\b|\bdept\.?\s*of\s*revenue\b|\bdepartment\s*of\s*revenue\b|\bcomptroller\b|\bstate\s*tax\b|\btax\s*commission\b|\bdept\.?\s*of\s*taxation\b/i, 'State tax agency', null, null, 'not_an_expense', { question: Q.taxPayment, notes: 'State income tax is personal (Schedule A); sales tax remitted, state LLC taxes and business licenses can be line 23.' }),
  entry(/\bsecretary\s*of\s*state\b|\bsec\s*of\s*state\b|\bsos\s*(?:business|filing|llc)\b|\bcorporations?\s*division\b|\bllc\s*(?:annual|renewal|fee)\b|\bbusiness\s*licen[cs]e\b|\bcity\s*of\s*\w+\s*licen|\bsunbiz\b|\bbizfile\b/i, 'State / local business registration', 'taxes_licenses', '23', 'business_likely', { defaultPurpose: 'Business registration, LLC annual report or business license fee' }),
  entry(/\b(?:superior|district|municipal|circuit|traffic|county|justice)\s*court\b|\bcourt\s*(?:clerk|fees?|fines?|services)\b|\bclerk\s*of\s*(?:the\s*)?court\b|\bcounty\s*clerk\b|\bmunicipal\s*fine\b|\bparking\s*(?:ticket|violation|citation)\b|\bviolation\b|\bcitation\b|\bred\s*light\s*camera\b/i, 'Government fine or fee', null, null, 'not_an_expense', { question: 'Fines, penalties and tickets paid to a government are not deductible. Was this a fine, or a business permit or filing fee?' }),
  entry(/\bifta\b|\birp\s*(?:registration|renewal|plate)\b|\bheavy\s*(?:highway|vehicle)\s*use\b|\bform\s*2290\b|\bucr\s*(?:registration|fee)\b|\bfmcsa\b/i, 'Trucking taxes and permits', 'taxes_licenses', '23', 'business_likely', { defaultPurpose: 'Fuel tax, apportioned registration or carrier permit for the trucking business' }),

  // Personal signals: entertainment, groceries, pharmacies, clothing -------------------------------
  entry(/\bnetflix\b/i, 'Netflix', null, null, 'personal_likely', { question: Q.streaming }),
  entry(/\bspotify\b/i, 'Spotify', null, null, 'personal_likely', { question: Q.streaming }),
  entry(/\bhulu\b|\bdisney\s*(?:plus|\+)\b|\bdisneyplus\b|\bhbo\s*max\b|\bmax\.com\b|\bparamount\s*(?:plus|\+)\b|\bpeacock\b|\bapple\s*tv\b|\bsling\b|\bfubo\b/i, 'Streaming service', null, null, 'personal_likely', { question: Q.streaming }),
  entry(/\baudible\b|\bkindle\s*(?:unlimited|svcs)\b|\bscribd\b|\beverand\b/i, 'Audiobook / reading subscription', null, null, 'personal_likely', { question: 'Reading and audiobook subscriptions are personal unless the material is research for your business. Was this for business?' }),
  entry(/\bplaystation\b|\bnintendo\b|\bsteam\s*games\b|\bsteampowered\b|\bepic\s*games\b|\btwitch\b/i, 'Gaming', null, null, 'personal_likely', { question: Q.entertainment }),
  entry(/\bticketmaster\b|\bstubhub\b|\blive\s*nation\b|\bamc\s*(?:theatres|theaters)\b|\bregal\s*cinemas\b|\bcinemark\b|\bseatgeek\b/i, 'Tickets / entertainment', null, null, 'personal_likely', { question: Q.entertainment }),
  entry(/\bwhole\s*foods\b|\bwholefds\b/i, 'Whole Foods', null, null, 'personal_likely', { question: Q.groceries }),
  entry(/\btrader\s*joe'?s\b|\bkroger\b|\bsafeway\b|\bpublix\b|\baldi\b|\bwegmans\b|\bh-?e-?b\b|\balbertsons\b|\bralphs\b|\bfred\s*meyer\b|\bstop\s*&\s*shop\b|\bgiant\s*(?:food|eagle)\b|\bsprouts\b|\bfood\s*lion\b|\bmeijer\b|\bwinco\b|\bvons\b|\bharris\s*teeter\b/i, 'Grocery store', null, null, 'personal_likely', { question: Q.groceries }),
  entry(/\bcvs\b/i, 'CVS', null, null, 'personal_likely', { question: Q.pharmacy }),
  entry(/\bwalgreens\b|\brite\s*aid\b|\bduane\s*reade\b/i, 'Pharmacy', null, null, 'personal_likely', { question: Q.pharmacy }),
  entry(/\bnordstrom\b|\bzara\b|\bh&m\b|\buniqlo\b|\bgap\b|\bold\s*navy\b|\blululemon\b|\bnike\b|\badidas\b|\bmacy'?s\b|\bsephora\b|\bulta\b|\bshein\b|\basos\b|\bfashion\s*nova\b|\brevolve\b/i, 'Clothing / beauty retailer', null, null, 'personal_likely', { question: Q.clothing, subtype: 'clothing' }),
  entry(/\bgreat\s*clips\b|\bsupercuts\b|\bdrybar\b|\bbarber\s*shop\b|\bbarbershop\b|\bnail\s*salon\b|\bday\s*spa\b|\bspa\b/i, 'Salon / grooming', null, null, 'personal_likely', { question: Q.beauty }),
  entry(/\bpetco\b|\bpetsmart\b|\bchewy\b/i, 'Pet store', null, null, 'personal_likely', { question: Q.pet }),
  entry(/\bcash\s*app\b|\bsquare\s*cash\b/i, 'Cash App', null, null, 'transfer_or_deposit', { question: Q.p2p }),
  entry(/\batm\s*(?:withdrawal|w\/d|wd|cash)\b|\bcash\s*withdrawal\b|\bwithdrawal\b/i, 'ATM / cash withdrawal', null, null, 'transfer_or_deposit', { question: Q.cash }),
  entry(/\bonline\s*transfer\b|\btransfer\s*(?:to|from)\b|\bxfer\b|\binternal\s*transfer\b|\bmobile\s*deposit\b|\bcheck\s*deposit\b|\bdirect\s*dep(?:osit)?\b/i, 'Bank transfer / deposit', null, null, 'transfer_or_deposit', { question: Q.deposit }),
  entry(/\brobinhood\b|\bcoinbase\b|\bfidelity\b|\bvanguard\b|\bschwab\b|\betrade\b|\be\*trade\b|\bwebull\b|\bbetterment\b|\bwealthfront\b|\bacorns\b|\bstash\b|\bkraken\b|\bbinance\b/i, 'Brokerage / crypto exchange', null, null, 'not_an_expense', { question: Q.investment }),
  entry(/\bsofi\b/i, 'SoFi', null, null, 'transfer_or_deposit', { question: 'SoFi covers loans, banking and investing. Was this a loan payment (not an expense), a transfer between your own accounts, or a fee on an account used for the business?' }),
  entry(/\bnelnet\b|\bmohela\b|\bsallie\s*mae\b|\bnavient\b|\baidvantage\b|\bgreat\s*lakes\s*(?:educational|higher|loan|ed)\b|\bglelsi\b|\bstudent\s*loan\b|\bearnest\s*(?:operations|loan)/i, 'Student loan servicer', null, null, 'not_an_expense', { question: 'Student loan payments are not business expenses (up to $2,500 of interest may be a Schedule 1 adjustment). Confirm this was not a business purchase.' }),
  entry(/\bmortgage\b|\brocket\s*mtg\b|\bmr\.?\s*cooper\b|\bpennymac\b|\bfreedom\s*mortgage\b|\bloandepot\b|\bnewrez\b/i, 'Mortgage servicer', null, null, 'not_an_expense', { question: Q.mortgage }),
  entry(/\btoyota\s*financial\b|\bhonda\s*financial\b|\bford\s*credit\b|\bgm\s*financial\b|\bally\s*(?:auto|financial)\b|\bcapital\s*one\s*auto\b|\bauto\s*loan\b|\bcar\s*payment\b/i, 'Auto loan', 'vehicle_expense', '9', 'not_an_expense', { question: 'Car loan principal is not an expense. Under actual expenses the business share of the interest and depreciation may count; under standard mileage neither does. Which method do you use, and what share of miles are business?' }),
  entry(/\bsep\s*ira\b|\bsolo\s*401\b|\bira\s*contribution\b|\bhsa\s*contribution\b|\bhealth\s*savings\b|\blively\s*(?:hsa|inc)\b|\bhealthequity\b/i, 'Retirement / HSA contribution', null, null, 'schedule_1', { question: 'SEP-IRA, solo 401(k) and HSA contributions are Schedule 1 adjustments, not Schedule C expenses. Confirm this was a contribution rather than a business purchase.', notes: 'Schedule 1 placement of self-employed retirement (§404(h), §62(a)(6)) and HSA (§223) contributions is outside the evidence packet; the question asks rather than applies it.' }),
  entry(/\bgo\s*fund\s*me\b|\bgofundme\b|\bred\s*cross\b|\bunited\s*way\b|\bsalvation\s*army\b|\bdonation\b|\bcharity\b|\bfoundation\b|\bchurch\b|\bministr(?:y|ies)\b/i, 'Charity / donation', null, null, 'not_an_expense', { question: Q.donation }),
  entry(/\bkindercare\b|\bbright\s*horizons\b|\bcare\.com\b|\bdaycare\b|\bchild\s*care\b|\bpreschool\b/i, 'Childcare', null, null, 'personal_likely', { question: Q.childcare }),
  entry(/\btuition\b|\bcommunity\s*college\b|\buniversity\b|\bcollege\b/i, 'Tuition / school', 'education_training', '27a', 'needs_purpose', { question: `${Q.education} Tuition for a family member is personal.`, subtype: 'education' }),

  // Processor prefixes: the real merchant follows the prefix, so these come after every brand pattern.
  entry(/\bpaypal\s*\*/i, 'PayPal purchase', null, null, 'needs_purpose', { question: 'What was bought through PayPal, from whom, and how is it used in your business?' }),
  entry(/\bsq\s*\*/i, 'Square-processed merchant', null, null, 'needs_purpose', { question: 'This charge was processed by Square for another merchant. What did you buy and from whom?' }),
  entry(/\btst\s*\*/i, 'Toast-processed restaurant', 'meals_50', '24b', 'needs_purpose', { question: Q.meal }),
  entry(/\bclover\s*\*|\btoast\s*\*|\bsp\s*\*|\bwpy\s*\*|\bpp\s*\*/i, 'Processor-billed merchant', null, null, 'needs_purpose', { question: 'This charge was billed through a payment processor for another merchant. What did you buy and from whom?' }),
];

// --- Plaid personal_finance_category.detailed → category / disposition ---------------------------
export interface PlaidCategoryMapping {
  detailed: string;
  category: ExpenseCategory | null;
  scheduleCLine: string | null;
  disposition: MerchantDisposition;
  defaultPurpose?: string;
  question?: string;
  subtype?: MerchantSubtype;
}
const plaid = (detailed: string, category: ExpenseCategory | null, scheduleCLine: string | null, disposition: MerchantDisposition,
  detail: Pick<PlaidCategoryMapping, 'defaultPurpose' | 'question' | 'subtype'> = {}): PlaidCategoryMapping =>
  ({ detailed, category, scheduleCLine, disposition, ...detail, subtype: detail.subtype ?? inferSubtype(detail.question) });

export const PLAID_CATEGORY_MAP: readonly PlaidCategoryMapping[] = [
  // INCOME (7): bank-labelled income is never automatically business receipts.
  plaid('INCOME_DIVIDENDS', null, null, 'transfer_or_deposit', { question: Q.wages }),
  plaid('INCOME_INTEREST_EARNED', null, null, 'transfer_or_deposit', { question: Q.wages }),
  plaid('INCOME_RETIREMENT_PENSION', null, null, 'transfer_or_deposit', { question: Q.wages }),
  plaid('INCOME_TAX_REFUND', null, null, 'transfer_or_deposit', { question: Q.wages }),
  plaid('INCOME_UNEMPLOYMENT', null, null, 'transfer_or_deposit', { question: Q.wages }),
  plaid('INCOME_WAGES', null, null, 'transfer_or_deposit', { question: Q.wages }),
  plaid('INCOME_OTHER_INCOME', null, null, 'transfer_or_deposit', { question: Q.otherIncome }),
  // TRANSFER_IN (6)
  plaid('TRANSFER_IN_CASH_ADVANCES_AND_LOANS', null, null, 'transfer_or_deposit', { question: 'Loan proceeds and cash advances are not income. Confirm this deposit is a loan rather than a customer payment.' }),
  plaid('TRANSFER_IN_DEPOSIT', null, null, 'transfer_or_deposit', { question: Q.deposit }),
  plaid('TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS', null, null, 'transfer_or_deposit', { question: Q.transfer }),
  plaid('TRANSFER_IN_SAVINGS', null, null, 'transfer_or_deposit', { question: Q.transfer }),
  plaid('TRANSFER_IN_ACCOUNT_TRANSFER', null, null, 'transfer_or_deposit', { question: Q.transfer }),
  plaid('TRANSFER_IN_OTHER_TRANSFER_IN', null, null, 'transfer_or_deposit', { question: Q.deposit }),
  // TRANSFER_OUT (5)
  plaid('TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS', null, null, 'not_an_expense', { question: Q.investment }),
  plaid('TRANSFER_OUT_SAVINGS', null, null, 'transfer_or_deposit', { question: Q.transfer }),
  plaid('TRANSFER_OUT_WITHDRAWAL', null, null, 'transfer_or_deposit', { question: Q.cash }),
  plaid('TRANSFER_OUT_ACCOUNT_TRANSFER', null, null, 'transfer_or_deposit', { question: Q.transfer }),
  plaid('TRANSFER_OUT_OTHER_TRANSFER_OUT', null, null, 'transfer_or_deposit', { question: Q.p2p }),
  // LOAN_PAYMENTS (6): principal is never an expense; the card's purchases are.
  plaid('LOAN_PAYMENTS_CAR_PAYMENT', 'vehicle_expense', '9', 'not_an_expense', { question: Q.loan }),
  plaid('LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', null, null, 'transfer_or_deposit', { question: Q.cardPayment }),
  plaid('LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT', null, null, 'not_an_expense', { question: Q.loan }),
  plaid('LOAN_PAYMENTS_MORTGAGE_PAYMENT', null, null, 'not_an_expense', { question: Q.mortgage }),
  plaid('LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT', null, null, 'not_an_expense', { question: Q.loan }),
  plaid('LOAN_PAYMENTS_OTHER_PAYMENT', null, null, 'not_an_expense', { question: Q.loan }),
  // BANK_FEES (6)
  plaid('BANK_FEES_ATM_FEES', 'bank_and_payment_fees', '10', 'needs_purpose', { question: Q.bankFee }),
  plaid('BANK_FEES_FOREIGN_TRANSACTION_FEES', 'bank_and_payment_fees', '10', 'needs_purpose', { question: Q.bankFee }),
  plaid('BANK_FEES_INSUFFICIENT_FUNDS', 'bank_and_payment_fees', '10', 'needs_purpose', { question: Q.bankFee }),
  plaid('BANK_FEES_INTEREST_CHARGE', 'other', '16b', 'needs_purpose', { question: 'Interest is deductible only for the business share of the balance it was charged on. Is this card or loan used for the business, and what share?' }),
  plaid('BANK_FEES_OVERDRAFT_FEES', 'bank_and_payment_fees', '10', 'needs_purpose', { question: Q.bankFee }),
  plaid('BANK_FEES_OTHER_BANK_FEES', 'bank_and_payment_fees', '10', 'needs_purpose', { question: Q.bankFee }),
  // ENTERTAINMENT (6): §274(a) disallows entertainment; music/streaming is personal.
  plaid('ENTERTAINMENT_CASINOS_AND_GAMBLING', null, null, 'personal_likely', { question: Q.entertainment }),
  plaid('ENTERTAINMENT_MUSIC_AND_AUDIO', null, null, 'personal_likely', { question: Q.streaming }),
  plaid('ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS', null, null, 'personal_likely', { question: Q.entertainment }),
  plaid('ENTERTAINMENT_TV_AND_MOVIES', null, null, 'personal_likely', { question: Q.streaming }),
  plaid('ENTERTAINMENT_VIDEO_GAMES', null, null, 'personal_likely', { question: Q.entertainment }),
  plaid('ENTERTAINMENT_OTHER_ENTERTAINMENT', null, null, 'personal_likely', { question: Q.entertainment }),
  // FOOD_AND_DRINK (7)
  plaid('FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR', null, null, 'personal_likely', { question: 'Alcohol purchases are personal unless part of a documented business meal or a client gift (capped at $25 per recipient). Which was this?' }),
  plaid('FOOD_AND_DRINK_COFFEE', 'meals_50', '24b', 'needs_purpose', { question: Q.meal }),
  plaid('FOOD_AND_DRINK_FAST_FOOD', 'meals_50', '24b', 'needs_purpose', { question: Q.meal }),
  plaid('FOOD_AND_DRINK_GROCERIES', null, null, 'personal_likely', { question: Q.groceries }),
  plaid('FOOD_AND_DRINK_RESTAURANT', 'meals_50', '24b', 'needs_purpose', { question: Q.meal }),
  plaid('FOOD_AND_DRINK_VENDING_MACHINES', 'meals_50', '24b', 'personal_likely', { question: Q.meal }),
  plaid('FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK', 'meals_50', '24b', 'needs_purpose', { question: Q.meal }),
  // GENERAL_MERCHANDISE (14)
  plaid('GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS', 'supplies_small_tools', '22', 'needs_purpose', { question: 'Were these professional books, references or trade publications for your business, or personal reading?' }),
  plaid('GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES', null, null, 'personal_likely', { question: Q.clothing, subtype: 'clothing' }),
  plaid('GENERAL_MERCHANDISE_CONVENIENCE_STORES', null, null, 'needs_purpose', { question: Q.convenience }),
  plaid('GENERAL_MERCHANDISE_DEPARTMENT_STORES', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.item('this store') }),
  plaid('GENERAL_MERCHANDISE_DISCOUNT_STORES', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.item('this store') }),
  plaid('GENERAL_MERCHANDISE_ELECTRONICS', 'equipment', '13', 'needs_purpose', { question: Q.electronics }),
  plaid('GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES', 'other', '27a', 'needs_purpose', { question: Q.gift, subtype: 'gift' }),
  plaid('GENERAL_MERCHANDISE_OFFICE_SUPPLIES', 'supplies_small_tools', '22', 'business_likely', { defaultPurpose: 'Office supplies used in the business' }),
  plaid('GENERAL_MERCHANDISE_ONLINE_MARKETPLACES', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.item('this marketplace') }),
  plaid('GENERAL_MERCHANDISE_PET_SUPPLIES', null, null, 'personal_likely', { question: Q.pet }),
  plaid('GENERAL_MERCHANDISE_SPORTING_GOODS', null, null, 'personal_likely', { question: Q.sportingGoods }),
  plaid('GENERAL_MERCHANDISE_SUPERSTORES', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.item('this store') }),
  plaid('GENERAL_MERCHANDISE_TOBACCO_AND_VAPE', null, null, 'personal_likely', { question: 'Tobacco and vape purchases are personal. Confirm this was not a business supply.' }),
  plaid('GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.item('this merchant') }),
  // HOME_IMPROVEMENT (5)
  plaid('HOME_IMPROVEMENT_FURNITURE', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.furniture }),
  plaid('HOME_IMPROVEMENT_HARDWARE', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.hardware }),
  plaid('HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE', 'repairs_maintenance', '21', 'needs_purpose', { question: Q.repair }),
  plaid('HOME_IMPROVEMENT_SECURITY', 'other', '27a', 'needs_purpose', { question: 'Is this security service for a business location (deductible) or for your home (only a home-office share through Form 8829)?' }),
  plaid('HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT', null, null, 'needs_purpose', { question: Q.repair }),
  // MEDICAL (7): Schedule A, not Schedule C.
  plaid('MEDICAL_DENTAL_CARE', null, null, 'personal_likely', { question: Q.medical }),
  plaid('MEDICAL_EYE_CARE', null, null, 'personal_likely', { question: Q.medical }),
  plaid('MEDICAL_NURSING_CARE', null, null, 'personal_likely', { question: Q.medical }),
  plaid('MEDICAL_PHARMACIES_AND_SUPPLEMENTS', null, null, 'personal_likely', { question: Q.pharmacy }),
  plaid('MEDICAL_PRIMARY_CARE', null, null, 'personal_likely', { question: Q.medical }),
  plaid('MEDICAL_VETERINARY_SERVICES', null, null, 'personal_likely', { question: Q.pet }),
  plaid('MEDICAL_OTHER_MEDICAL', null, null, 'personal_likely', { question: Q.medical }),
  // PERSONAL_CARE (4)
  plaid('PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS', 'dues_and_memberships', '27a', 'personal_likely', { question: Q.gym }),
  plaid('PERSONAL_CARE_HAIR_AND_BEAUTY', null, null, 'personal_likely', { question: Q.beauty }),
  plaid('PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING', null, null, 'personal_likely', { question: Q.dryCleaning }),
  plaid('PERSONAL_CARE_OTHER_PERSONAL_CARE', null, null, 'personal_likely', { question: Q.beauty }),
  // GENERAL_SERVICES (9)
  plaid('GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING', 'legal_professional', '17', 'needs_purpose', { question: 'Was this bookkeeping, accounting or the business portion of tax preparation (line 17), or personal financial planning and investment advice (not a business expense)?', subtype: 'tax_prep' }),
  plaid('GENERAL_SERVICES_AUTOMOTIVE', 'vehicle_expense', '9', 'needs_purpose', { question: 'Is this vehicle used for business, what share of its miles are business, and do you use actual expenses (repairs count) or the standard mileage rate (already included)?', subtype: 'auto_service' }),
  plaid('GENERAL_SERVICES_CHILDCARE', null, null, 'personal_likely', { question: Q.childcare }),
  plaid('GENERAL_SERVICES_CONSULTING_AND_LEGAL', 'legal_professional', '17', 'needs_purpose', { question: Q.legal }),
  plaid('GENERAL_SERVICES_EDUCATION', 'education_training', '27a', 'needs_purpose', { question: Q.education }),
  plaid('GENERAL_SERVICES_INSURANCE', 'insurance', '15', 'needs_purpose', { question: Q.insurance }),
  plaid('GENERAL_SERVICES_POSTAGE_AND_SHIPPING', 'supplies_small_tools', '22', 'needs_purpose', { question: Q.postage }),
  plaid('GENERAL_SERVICES_STORAGE', 'rent', '20b', 'needs_purpose', { question: Q.storage }),
  plaid('GENERAL_SERVICES_OTHER_GENERAL_SERVICES', 'other', '27a', 'needs_purpose', { question: 'What service was this, and how does it relate to operating your business?' }),
  // GOVERNMENT_AND_NON_PROFIT (4)
  plaid('GOVERNMENT_AND_NON_PROFIT_DONATIONS', null, null, 'not_an_expense', { question: Q.donation }),
  plaid('GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES', 'taxes_licenses', '23', 'needs_purpose', { question: Q.government }),
  plaid('GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT', null, null, 'not_an_expense', { question: Q.taxPayment }),
  plaid('GOVERNMENT_AND_NON_PROFIT_OTHER_GOVERNMENT_AND_NON_PROFIT', null, null, 'needs_purpose', { question: Q.government }),
  // TRANSPORTATION (7)
  plaid('TRANSPORTATION_BIKES_AND_SCOOTERS', 'vehicle_expense', '9', 'needs_purpose', { question: Q.localRide, subtype: 'local_transport' }),
  plaid('TRANSPORTATION_GAS', 'vehicle_expense', '9', 'needs_purpose', { question: Q.fuel, subtype: 'fuel' }),
  plaid('TRANSPORTATION_PARKING', 'parking_tolls', '9', 'needs_purpose', { question: Q.parking, subtype: 'parking_tolls' }),
  plaid('TRANSPORTATION_PUBLIC_TRANSIT', 'vehicle_expense', '9', 'needs_purpose', { question: Q.localRide, subtype: 'local_transport' }),
  plaid('TRANSPORTATION_TAXIS_AND_RIDE_SHARES', 'vehicle_expense', '9', 'needs_purpose', { question: Q.localRide, subtype: 'local_transport' }),
  plaid('TRANSPORTATION_TOLLS', 'parking_tolls', '9', 'needs_purpose', { question: Q.parking, subtype: 'parking_tolls' }),
  plaid('TRANSPORTATION_OTHER_TRANSPORTATION', 'vehicle_expense', '9', 'needs_purpose', { question: Q.localRide, subtype: 'local_transport' }),
  // TRAVEL (4)
  plaid('TRAVEL_FLIGHTS', 'travel', '24a', 'needs_purpose', { question: Q.airfare }),
  plaid('TRAVEL_LODGING', 'travel', '24a', 'needs_purpose', { question: Q.lodging }),
  plaid('TRAVEL_RENTAL_CARS', 'travel', '24a', 'needs_purpose', { question: Q.rentalCar }),
  plaid('TRAVEL_OTHER_TRAVEL', 'travel', '24a', 'needs_purpose', { question: Q.airfare }),
  // RENT_AND_UTILITIES (7)
  plaid('RENT_AND_UTILITIES_GAS_AND_ELECTRICITY', 'utilities_phone_internet', '25', 'needs_purpose', { question: Q.homeUtility }),
  plaid('RENT_AND_UTILITIES_INTERNET_AND_CABLE', 'utilities_phone_internet', '25', 'mixed_use', { question: Q.phone('internet') }),
  plaid('RENT_AND_UTILITIES_RENT', 'rent', '20b', 'needs_purpose', { question: Q.rent }),
  plaid('RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT', 'utilities_phone_internet', '25', 'needs_purpose', { question: Q.homeUtility }),
  plaid('RENT_AND_UTILITIES_TELEPHONE', 'utilities_phone_internet', '25', 'mixed_use', { question: Q.phone('phone') }),
  plaid('RENT_AND_UTILITIES_WATER', 'utilities_phone_internet', '25', 'needs_purpose', { question: Q.homeUtility }),
  plaid('RENT_AND_UTILITIES_OTHER_UTILITIES', 'utilities_phone_internet', '25', 'needs_purpose', { question: Q.homeUtility }),
];
const PLAID_BY_DETAILED = new Map(PLAID_CATEGORY_MAP.map(item => [item.detailed, item]));
/** Legacy/primary-only values saved by older syncs; mapped to the movement questions only. */
const PLAID_PRIMARY_FALLBACK: Record<string, PlaidCategoryMapping> = {
  INCOME: plaid('INCOME', null, null, 'transfer_or_deposit', { question: Q.otherIncome }),
  TRANSFER_IN: plaid('TRANSFER_IN', null, null, 'transfer_or_deposit', { question: Q.deposit }),
  TRANSFER_OUT: plaid('TRANSFER_OUT', null, null, 'transfer_or_deposit', { question: Q.transfer }),
  LOAN_PAYMENTS: plaid('LOAN_PAYMENTS', null, null, 'not_an_expense', { question: Q.loan }),
  BANK_FEES: plaid('BANK_FEES', 'bank_and_payment_fees', '10', 'needs_purpose', { question: Q.bankFee }),
};

/** Plaid `personal_finance_category.detailed` (or a primary) → our category and disposition; null when unknown. */
export function mapPlaidCategory(detailed: string | null | undefined): PlaidCategoryMapping | null {
  const key = typeof detailed === 'string' ? detailed.trim().toUpperCase() : '';
  if (!key) return null;
  return PLAID_BY_DETAILED.get(key) ?? PLAID_PRIMARY_FALLBACK[key] ?? null;
}

export type MerchantConfidence = 'high' | 'medium' | 'none';
export interface MerchantIntelligenceResult {
  name: string | null;
  category: ExpenseCategory | null;
  scheduleCLine: string | null;
  disposition: MerchantDisposition;
  defaultPurpose: string | null;
  question: string | null;
  notes: string | null;
  subtype: MerchantSubtype | null;
  /** high: exact brand/descriptor pattern; medium: Plaid category only; none: nothing matched. */
  confidence: MerchantConfidence;
  source: 'merchant_table' | 'plaid_category' | 'none';
  plaidCategory: string | null;
}

const NONE: MerchantIntelligenceResult = {
  name: null, category: null, scheduleCLine: null, disposition: 'needs_purpose', defaultPurpose: null, question: null,
  notes: null, subtype: null, confidence: 'none', source: 'none', plaidCategory: null,
};

type Counterparty = { name?: unknown };
/** Bank-supplied descriptor text only. User notes never feed merchant matching. */
export function merchantDescriptor(transaction: Partial<TransactionInput>): string {
  const counterparties = Array.isArray(transaction.counterparties)
    ? (transaction.counterparties as Counterparty[]).map(party => typeof party?.name === 'string' ? party.name : '')
    : [];
  return [transaction.merchant, transaction.merchant_name, transaction.description, ...counterparties]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.normalize('NFKC').replace(/\s+/g, ' ').trim())
    .join(' | ');
}

export function findMerchantEntry(descriptor: string): MerchantIntelligenceEntry | null {
  if (!descriptor) return null;
  return MERCHANT_INTELLIGENCE.find(item => item.pattern.test(descriptor)) ?? null;
}

const CREDIT_QUESTION = 'Money came into the account from this merchant. Is this a payout of your sales or earnings (business income at the gross amount, before fees), a refund of an earlier purchase, or a transfer?';

/**
 * Best available merchant knowledge for a transaction. A credit (negative amount) from any
 * merchant is a payout, refund or transfer question rather than an expense disposition.
 */
export function merchantIntelligence(transaction: Partial<TransactionInput>): MerchantIntelligenceResult {
  const plaidDetailed = transaction.personal_finance_category?.detailed ?? transaction.category ?? null;
  const plaidMapping = mapPlaidCategory(plaidDetailed);
  const plaidCategory = plaidMapping?.detailed ?? null;
  const amount = transaction.amount_usd ?? transaction.amount;
  const credit = typeof amount === 'number' && amount < 0;
  const matched = findMerchantEntry(merchantDescriptor(transaction));
  if (matched) {
    const paysOut = credit && matched.disposition !== 'transfer_or_deposit';
    return {
      name: matched.name, category: paysOut ? null : matched.category, scheduleCLine: paysOut ? null : matched.scheduleCLine,
      disposition: paysOut ? 'transfer_or_deposit' : matched.disposition,
      defaultPurpose: paysOut ? null : matched.defaultPurpose ?? null,
      question: paysOut ? CREDIT_QUESTION : matched.question ?? null,
      notes: matched.notes ?? null, subtype: paysOut ? null : matched.subtype ?? null,
      confidence: 'high', source: 'merchant_table', plaidCategory,
    };
  }
  if (plaidMapping) {
    const paysOut = credit && plaidMapping.disposition !== 'transfer_or_deposit';
    return {
      name: null, category: paysOut ? null : plaidMapping.category, scheduleCLine: paysOut ? null : plaidMapping.scheduleCLine,
      disposition: paysOut ? 'transfer_or_deposit' : plaidMapping.disposition,
      defaultPurpose: paysOut ? null : plaidMapping.defaultPurpose ?? null,
      question: paysOut ? CREDIT_QUESTION : plaidMapping.question ?? null,
      notes: null, subtype: paysOut ? null : plaidMapping.subtype ?? null,
      confidence: 'medium', source: 'plaid_category', plaidCategory,
    };
  }
  return { ...NONE, plaidCategory, question: credit ? CREDIT_QUESTION : null, disposition: credit ? 'transfer_or_deposit' : 'needs_purpose' };
}

/** Compact, model-facing view included in the analysis prompt's transaction context. */
export function merchantIntelligenceForModel(result: MerchantIntelligenceResult) {
  if (result.confidence === 'none') return null;
  return {
    name: result.name, category: result.category, schedule_c_line: result.scheduleCLine, disposition: result.disposition,
    default_purpose: result.defaultPurpose, question: result.question, confidence: result.confidence, source: result.source,
    note: 'A merchant match is a category hint and a question, never proof of business use or deductibility.',
  };
}
