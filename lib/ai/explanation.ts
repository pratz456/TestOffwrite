/**
 * Server-composed, transaction-specific explanation for an AI analysis result.
 *
 * Pure: no model call, no database. Every sentence is authored here from the
 * grounded result, the owner's saved facts and the published federal rates, so
 * the model never writes an amount, a rule or a tax figure the user sees.
 */
import type { OutputType } from './analyzeTransaction';
import { CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { reviewCategory } from '@/lib/transactions/ai-review-contract';
import { getUserTaxRate } from '@/lib/tax-rules/federal-brackets';
import { SUPPORTED_TAX_YEARS, type SupportedTaxYear } from '@/lib/tax-rules/federal-year-rules';
import { normalizeFilingStatus } from '@/lib/tax-rules/filing-status';
import { calcScheduleSE } from '@/lib/reports/calcSE';

/** Optional metadata the tax-policy grounding may attach; absent on older results. */
export type ExplainableResult = OutputType & { proposed_purpose?: string | null; schedule_c_line?: string | null };

/** Saved transaction facts the explanation may cite. Accepts the API input shape or a raw saved record. */
export type ExplanationTransaction = {
  amount?: number | null; amount_usd?: number | null;
  iso_currency_code?: string | null; unofficial_currency_code?: string | null;
  merchant_name?: string | null; merchant?: string | null; name?: string | null;
  business_purpose?: string | null; business_use_percentage?: number | null;
  attendees?: readonly string[] | null; travel_destination?: string | null; client_project?: string | null;
  meeting_notes?: string | null; documentation_status?: string | null;
  equipment_details?: { make?: string | null; model?: string | null; year?: number | null; business_use_percentage?: number | null; depreciation_method?: string | null } | null;
  mileage_details?: { start_location?: string | null; end_location?: string | null; miles?: number | null; business_purpose?: string | null } | null;
};

/** Profile facts the estimate uses; the raw profile document and UserContext both satisfy it. */
export type ExplanationProfile = {
  income?: number | string | null; annual_gross_income_usd?: number | null;
  filing_status?: string | null; w2_income?: number | null;
};

export const ESTIMATE_LABEL = 'estimated federal tax effect; state not included';

export interface EstimatedTaxEffect {
  /** Whole dollars; newly composed estimates use the change in basic income plus SE tax. Legacy ranges remain readable. */
  low: number;
  high: number;
  label: typeof ESTIMATE_LABEL;
  basis: string;
}

export interface TransactionExplanation {
  headline: string;
  why: string;
  yourFacts: string[];
  scheduleCLine: string | null;
  estimatedTaxEffect: EstimatedTaxEffect | null;
  strengthen: string[];
  nextQuestion: string | null;
}

export interface ComposeExplanationInput {
  result: ExplainableResult;
  transaction?: ExplanationTransaction | Record<string, unknown> | null;
  profile?: ExplanationProfile | Record<string, unknown> | null;
  taxYear: number | null | undefined;
}

const text = (value: unknown, max = 160): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
};
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dollars = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const unique = (items: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const value = text(item, 200);
    if (!value) continue;
    const key = value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key); out.push(value);
  }
  return out;
};

/** Plain-English restatements keyed by the curated source id; the id, not model prose, selects the rule. */
const RULES: Record<string, string> = {
  'business-162': '26 USC 162 allows a cost that is ordinary and necessary for your existing trade or business. A merchant name or a business card does not show that; your recorded purpose does.',
  'supplies-263a': 'Supplies need a documented business use. Equipment may require an expensing election or depreciation; a merchant name or invoice total does not determine the treatment.',
  'personal-262': '26 USC 262 disallows personal, living and family costs even when they make work easier. Only a separately identifiable business portion can qualify, and no split is assumed.',
  'meals-274': '26 USC 274 limits a qualifying business meal to 50% and requires a business purpose, the people present, your attendance and a non-lavish food cost stated separately from entertainment, which is not deductible.',
  'travel-463': 'IRS Publication 463: commuting to a regular work location is personal. Overnight travel depends on your tax home, business purpose and dates. Vehicle costs depend on logged business miles and your chosen method.',
  'capital-263': '26 USC 263: an asset or improvement is generally capitalized rather than expensed in full. The item, the date it was first used for business and any election decide that, not the price or the merchant.',
  'assets-946': 'IRS Publication 946: depreciation, Section 179 and bonus depreciation are separate treatments that depend on the asset, the date it was placed in service and its business-use percentage.',
  'home-587': 'IRS Publication 587: a home workspace normally must be used regularly and exclusively for business and be your principal place of business or meet another listed use. The method and the business area set the amount.',
  'records-334': 'IRS Publication 334: customer receipts, owner contributions, loans, transfers and refunds are different flows. A bank credit alone does not establish income, and a refund needs the original purchase and tax year checked: it may reduce an expense or be a prior-year recovery, never a new deduction.',
  'insurance-334': 'IRS Publication 334: premiums that cover a business risk or business property (liability, professional or E&O, business property, workers\' compensation) are Schedule C insurance. Your own health premiums belong on Schedule 1, auto premiums follow your vehicle method, and life, disability and home policies are personal.',
  'professional-fees-334': 'IRS Publication 334: attorney, accountant, bookkeeper and consultant fees that relate to operating the business are deductible; a tax-preparation fee counts only for the business schedules, and fees for personal matters such as a will, a divorce or a personal return do not.',
  'taxes-licenses-sch-c': 'Instructions for Schedule C, line 23: business licences and employer payroll taxes may qualify. Sales tax imposed on the buyer and collected for remittance is neither income nor an expense; tax imposed on the seller may be deducted when included in gross receipts. Federal income and self-employment taxes are not Schedule C expenses.',
  'mileage-rates': 'IRS standard mileage rates: the per-mile rate already covers fuel, repairs, insurance and depreciation for the same miles, while parking and tolls on business trips stay separately deductible. Commuting is excluded under either method.',
};

const MISSING_FACT_LABELS: Record<string, string> = {
  formation_cost_treatment: 'whether this cost started, formed or operated the business',
  food_expense_treatment: 'who received the food and which food-expense rule applies',
  sales_tax_incidence: 'who legally owed this sales tax and how receipts were recorded',
  association_dues_allocation: 'the association’s nondeductible lobbying or political portion',
  solo_meal_context: 'whether this was a personal meal or qualifying overnight business travel',
  business_tax_components: 'the tax type and the deductible business component',
  business_purpose: 'what you bought and how it was used in your business',
  business_use_percentage: 'the business-use percentage and the records behind it',
  meal_conditions: 'who attended the meal and its business purpose',
  vehicle_method: 'the business miles driven and your vehicle deduction method',
  travel_eligibility: 'the trip dates, destination and business purpose',
  asset_treatment: 'how this asset is treated: an expensing election or depreciation',
  home_office_eligibility: 'whether the space is used regularly and exclusively for business',
  transaction_kind: 'what kind of money movement this was',
  deposit_source: 'where this deposit came from',
  transfer_purpose: 'whether this moved money between your own accounts',
  original_expense: 'which original purchase this refund matches',
  transaction_direction: 'whether money left or entered the account, and why',
  business_entity: 'your business tax structure',
  prior_decision_conflict: 'whether this purchase differs from the ones you marked personal',
  expense_category: 'which expense category this charge belongs to',
  business_use_allocation: 'whether this charge is 100% business or a shared item kept for your preparer',
  expense_review: 'your answer to the open question about this expense',
  deduction_placement: 'whether this is a health, dental or vision premium',
  club_dues_exception: 'whether this facility is used only in your business',
  insurance_coverage: 'which risk or property this policy covers',
  tax_payment_recorded: 'whether this was an income or estimated tax payment',
  personal_use_exception: 'whether this item is unusable outside your business',
};

/** Category-specific records that make a deduction defensible; merged with the model's documentation list. */
const RECORD_RULES: Record<string, string[]> = {
  meals_50: ['Receipt showing the restaurant, date and amount', 'Names and business relationship of everyone present', 'Business purpose of the meal, written at the time'],
  travel: ['Travel dates, with business days and personal days separated', 'Itemized lodging bill (lodging, meals and other charges shown separately)', 'Business purpose and the location of your tax home'],
  vehicle_expense: ['Mileage log with date, miles, destination and purpose for each trip', 'Total miles driven in the year, business and personal', 'Your chosen vehicle method for the year'],
  equipment: ['Invoice showing the item, price and purchase date', 'Date the item was first used in your business', 'Business-use percentage and any expensing or depreciation election'],
  home_office: ['Square footage of the workspace and of the whole home', 'Evidence of regular and exclusive business use (photo or floor plan)', 'Method used: simplified or actual expenses'],
  utilities_phone_internet: ['The bill for this period', 'Business-use percentage and how you measured it'],
  software_subscriptions: ['Subscription invoice', 'Note of the business work this tool is used for'],
  advertising_marketing: ['Invoice or ad receipt', 'What was promoted and where it ran'],
  supplies_small_tools: ['Itemized receipt', 'Note of the business use'],
  contract_labor: ['Invoice from the contractor', 'Signed Form W-9 and any Form 1099-NEC you issue'],
  education_training: ['Course description and receipt', 'How it maintains or improves skills in your current business'],
  dues_and_memberships: ['Membership invoice', 'The organization and its business purpose'],
  bank_and_payment_fees: ['Statement showing the fee on the business account or processor'],
  rent: ['Lease or rental agreement', 'Evidence the space is a separate business location'],
  parking_tolls: ['Parking or toll receipt or account statement', 'The trip: destination and business purpose (parking at a regular workplace is commuting)'],
  insurance: ['Policy declarations page naming the coverage and the insured business or property', 'Premium statement for the period'],
  legal_professional: ['Invoice describing the matter or service', 'How the matter relates to operating the business (for tax preparation, the business share)'],
  taxes_licenses: ['Licence, permit or filing confirmation, or the tax return remitted', 'The government payee and what the payment was for'],
  repairs_maintenance: ['Repair invoice describing the work and the property repaired', 'Evidence the property is used in the business (and the business share, for a home or vehicle)'],
  other: ['Itemized receipt or invoice', 'Written business purpose'],
};

const KIND_RECORDS: Record<string, string[]> = {
  income: ['Invoice or payment record that matches this deposit'],
  transfer: ['Statements from both accounts showing the matching movement'],
  refund: ['Refund record and the original invoice', 'Tax year and treatment of the original purchase'],
  personal: [],
};

const FLOW_HEADLINES: Record<string, string> = {
  personal: 'Personal purchase: not a business deduction',
  income: 'Business income: reported as receipts, not an expense',
  transfer: 'Transfer: not income and not an expense',
  refund: 'Refund: match the original purchase and tax year; not a new deduction',
};

const LINE_NAMES: Record<string, string> = Object.fromEntries(Object.values(CATEGORY_MAP).map(entry => [entry.line, entry.name]));

/** Prefer the policy's placement; otherwise the export taxonomy line for the suggested category. */
export function scheduleCLineFor(result: ExplainableResult): string | null {
  const supplied = text(result.schedule_c_line, 120);
  if (supplied) {
    if (/^(schedule|form|not)\b/i.test(supplied)) return supplied;
    if (/^\d{1,2}[a-z]?$/.test(supplied)) return `Schedule C line ${supplied}${LINE_NAMES[supplied] ? ` (${LINE_NAMES[supplied]})` : ''}`;
    if (/^line\b/i.test(supplied)) return `Schedule C ${supplied}`;
    return supplied;
  }
  const kind = result.transaction_kind ?? 'expense';
  if (kind !== 'expense' && kind !== 'unknown' || result.is_deductible === false) return null;
  const recorded = reviewCategory(result.category)?.recordedCategory;
  const entry = recorded ? CATEGORY_MAP[recorded] : undefined;
  return entry ? `Schedule C line ${entry.line} (${entry.name})` : null;
}

function headlineFor(result: ExplainableResult, label: string | undefined): string {
  const kind = result.transaction_kind ?? 'unknown';
  if (result.status === 'blocked') {
    const fields = result.missing_fields ?? [];
    if (fields.includes('supported_tax_year')) return 'Outside the reviewed tax years: category only';
    if (fields.includes('entity_tax_treatment')) return 'Entity return: category only; tax treatment needs your entity preparer';
    return 'Needs manual review';
  }
  if (result.status === 'needs_more_info') {
    const proposed = text(result.proposed_purpose, 120);
    if (proposed) return `Confirm: ${proposed}`;
    const missing = (result.missing_fields ?? []).map(field => MISSING_FACT_LABELS[field]).find(Boolean);
    return `Needs one fact: ${missing ?? 'what was bought and its business or personal purpose'}`;
  }
  if (result.is_deductible === true) {
    const percent = finite(result.deductible_percent);
    const share = percent !== null && percent < 100 && !(label ?? '').includes(`${percent}%`) ? ` at ${percent}% business use` : '';
    return `Likely deductible: ${label ?? 'business expense'}${share}`;
  }
  if (FLOW_HEADLINES[kind]) return FLOW_HEADLINES[kind];
  return result.is_deductible === false ? 'Not deductible as recorded' : 'Categorized; tax treatment still needs review';
}

function whyFor(result: ExplainableResult): string {
  const sources = (result.sources ?? []).slice(0, 3);
  if (!sources.length) return 'No reviewed source is attached to this suggestion, so no rule is stated. Run the analysis again for a source-backed explanation.';
  const kind = result.transaction_kind;
  if (kind === 'personal' && sources.some(source => source.id === 'personal-262')) return RULES['personal-262'];
  if (sources.some(source => source.id === 'records-334')) {
    if (kind === 'refund') return RULES['records-334'];
    if (kind === 'transfer') return 'IRS Publication 334 distinguishes transfers, loans and owner contributions from business receipts and expenses. Match the movement between accounts before assigning tax treatment.';
    if (kind === 'income') return 'IRS Publication 334 treats customer payments for business work as receipts. Keep the matching invoice and reconcile gross receipts, fees and information forms to avoid counting the same payment twice.';
  }
  // Lead with one applicable rule. Do not show the general income/refund discussion
  // on every ordinary expense just because the records publication was also cited.
  const general = new Set(['business-162', 'personal-262', 'records-334']);
  const source = sources.find(item => RULES[item.id] && !general.has(item.id))
    ?? sources.find(item => item.id !== 'records-334') ?? sources[0];
  return RULES[source.id] ?? `This suggestion relies on ${text(source.title, 120) ?? 'a reviewed federal source'}.`;
}

function factsFor(transaction: Record<string, unknown>): string[] {
  const equipment = record(transaction.equipment_details);
  const mileage = record(transaction.mileage_details);
  const facts: Array<string | null> = [];
  const purpose = text(transaction.business_purpose, 140);
  if (purpose) facts.push(`Purpose you saved: ${purpose}`);
  const use = finite(transaction.business_use_percentage) ?? finite(equipment.business_use_percentage);
  if (use !== null) facts.push(`Business use: ${use}%`);
  const attendees = Array.isArray(transaction.attendees) ? unique(transaction.attendees.map(item => text(item, 60))) : [];
  if (attendees.length) facts.push(`Attendees: ${attendees.slice(0, 4).join(', ')}${attendees.length > 4 ? ` and ${attendees.length - 4} more` : ''}`);
  const destination = text(transaction.travel_destination, 80);
  if (destination) facts.push(`Destination: ${destination}`);
  const project = text(transaction.client_project, 80);
  if (project) facts.push(`Client or project: ${project}`);
  const miles = finite(mileage.miles);
  if (miles !== null) {
    const route = [text(mileage.start_location, 40), text(mileage.end_location, 40)].filter(Boolean).join(' to ');
    facts.push(`Mileage: ${miles} miles${route ? ` (${route})` : ''}`);
  }
  const asset = [finite(equipment.year), text(equipment.make, 40), text(equipment.model, 40)].filter(value => value !== null).join(' ');
  if (asset) facts.push(`Equipment: ${asset}`);
  const method = text(equipment.depreciation_method, 40);
  if (method) facts.push(`Asset method you chose: ${method.replace(/_/g, ' ')}`);
  const notes = text(transaction.meeting_notes, 100);
  if (notes) facts.push(`Meeting notes: ${notes}`);
  const documentation = text(transaction.documentation_status, 20);
  if (documentation && ['complete', 'partial', 'missing'].includes(documentation)) facts.push(`Records marked ${documentation}`);
  return unique(facts);
}

function strengthenFor(result: ExplainableResult): string[] {
  const kind = result.transaction_kind ?? 'expense';
  const modelRecords = result.documentation_required ?? [];
  if (kind in KIND_RECORDS) return unique([...modelRecords, ...KIND_RECORDS[kind]]).slice(0, 5);
  if (result.status === 'ok' && result.is_deductible === false) return [];
  return unique([...modelRecords, ...(RECORD_RULES[result.category ?? 'other'] ?? RECORD_RULES.other)]).slice(0, 5);
}

const FILING_LABELS: Record<string, string> = { single: 'single', married_filing_jointly: 'married filing jointly', married_filing_separately: 'married filing separately', head_of_household: 'head of household' };

/** Only for a supported deduction in a published tax year; any unsupported input withholds the figure. */
export function estimateTaxEffect(result: ExplainableResult, amount: number | null, profile: Record<string, unknown>, taxYear: number | null | undefined): EstimatedTaxEffect | null {
  if (result.status !== 'ok' || result.is_deductible !== true || amount === null || !(amount > 0)) return null;
  if (!SUPPORTED_TAX_YEARS.includes(taxYear as SupportedTaxYear)) return null;
  const year = taxYear as SupportedTaxYear;
  try {
    const status = normalizeFilingStatus(profile.filing_status);
    const rawIncome = finite(profile.annual_gross_income_usd) ?? (typeof profile.income === 'string' ? Number(profile.income.replace(/[,$\s]/g, '')) : finite(profile.income));
    const seIncome = rawIncome !== null && Number.isFinite(rawIncome) && rawIncome > 0 ? rawIncome : null;
    if (seIncome === null) return null;
    const percent = Math.min(finite(result.deductible_percent) ?? 100, result.category === 'meals_50' ? 50 : 100);
    if (percent < 0) return null;
    const deductible = Math.round(amount * percent) / 100;
    // A loss needs additional scope facts. Do not invent its effect against W-2 income.
    if (deductible > seIncome) return null;
    const w2Income = profile.w2_income == null ? 0 : finite(profile.w2_income);
    if (w2Income === null || w2Income < 0) return null;
    if (w2Income > 0 && (profile.w2_social_security_wages == null || profile.w2_medicare_wages == null)) return null;
    const ssWages = profile.w2_social_security_wages == null ? 0 : finite(profile.w2_social_security_wages);
    const medicareWages = profile.w2_medicare_wages == null ? 0 : finite(profile.w2_medicare_wages);
    if (ssWages === null || ssWages < 0 || medicareWages === null || medicareWages < 0) return null;
    const taxAt = (profit: number) => {
      const basicProfile = { income: profit, w2_income: w2Income, w2_social_security_wages: ssWages, w2_medicare_wages: medicareWages, filing_status: status };
      const incomeTax = getUserTaxRate(basicProfile, year) * (profit + w2Income);
      const se = calcScheduleSE({ scheduleCNetProfit: profit, taxYear: year }, status, ssWages, medicareWages);
      return incomeTax + se.totalSETax + se.additionalMedicareTax;
    };
    // Difference of before/after basic calculations respects the SS cap, the $400 earnings
    // threshold, deduction/bracket crossings and the half-SE adjustment. No average-rate shortcut.
    const effect = Math.round(Math.max(0, taxAt(seIncome) - taxAt(seIncome - deductible)));
    if (!Number.isFinite(effect)) return null;
    const share = percent < 100 ? ` at ${percent}%` : '';
    return { low: effect, high: effect, label: ESTIMATE_LABEL,
      basis: `${money(deductible)} deductible${share} from ${money(amount)}. Uses saved income, ${FILING_LABELS[status] ?? status} status and ${year} rules for basic federal income and SE tax. Assumes standard deduction; excludes QBI, credits, other deductions and state tax. Not a refund.` };

  } catch {
    return null;
  }
}

export function composeExplanation({ result, transaction, profile, taxYear }: ComposeExplanationInput): TransactionExplanation {
  const tx = record(transaction);
  const saved = record(profile);
  const category = reviewCategory(result.category);
  const explicitUSD = finite(tx.amount_usd);
  const rawAmount = finite(tx.amount);
  const currency = typeof tx.iso_currency_code === 'string' && /^[A-Z]{3}$/.test(tx.iso_currency_code) && !tx.unofficial_currency_code
    ? tx.iso_currency_code : null;
  // API input can explicitly carry USD. Persisted raw amounts require recorded
  // currency before either a dollar headline or a dollar tax effect is composed.
  const usdAmount = tx.amount_usd != null ? explicitUSD : currency === 'USD' ? rawAmount : null;
  const amountLabel = explicitUSD !== null ? money(Math.abs(explicitUSD))
    : rawAmount !== null && currency === 'USD' ? money(Math.abs(rawAmount))
      : rawAmount !== null && currency ? Math.abs(rawAmount).toLocaleString('en-US', { style: 'currency', currency, currencyDisplay: 'code' }) : null;
  const merchant = text(tx.merchant_name, 60) ?? text(tx.merchant, 60) ?? text(tx.name, 60);
  const estimate = estimateTaxEffect(result, usdAmount, saved, taxYear);
  const facts = factsFor(tx);
  if (estimate) {
    try { facts.push(`Filing status used for the estimate: ${FILING_LABELS[normalizeFilingStatus(saved.filing_status)] ?? 'single'}`); } catch { /* the estimate already withheld itself */ }
  }
  const subject = merchant && amountLabel ? ` — ${merchant}, ${amountLabel}` : merchant ? ` — ${merchant}` : '';
  return {
    headline: `${headlineFor(result, category?.label)}${subject}`,
    why: whyFor(result),
    yourFacts: facts,
    scheduleCLine: scheduleCLineFor(result),
    estimatedTaxEffect: estimate,
    strengthen: strengthenFor(result),
    nextQuestion: result.questions?.map(question => text(question, 300)).find(Boolean) ?? null,
  };
}

/** Validates a stored `ai_explanation` payload before the UI renders it; any malformed record renders nothing. */
export function normalizeExplanation(value: unknown): TransactionExplanation | null {
  const data = record(value);
  const headline = text(data.headline, 200);
  const why = text(data.why, 1200);
  if (!headline || !why) return null;
  const strings = (input: unknown) => Array.isArray(input) ? unique(input.map(item => text(item, 300))) : [];
  const effect = record(data.estimatedTaxEffect);
  const low = finite(effect.low), high = finite(effect.high);
  const estimatedTaxEffect: EstimatedTaxEffect | null = low !== null && high !== null && effect.label === ESTIMATE_LABEL
    ? { low: Math.min(low, high), high: Math.max(low, high), label: ESTIMATE_LABEL, basis: text(effect.basis, 400) ?? '' } : null;
  return {
    headline, why, yourFacts: strings(data.yourFacts), scheduleCLine: text(data.scheduleCLine, 120),
    estimatedTaxEffect, strengthen: strings(data.strengthen), nextQuestion: text(data.nextQuestion, 300),
  };
}

/** "$14–$32" or "about $25" or "under $1"; the label is rendered separately. */
export function formatEstimatedTaxEffect(effect: EstimatedTaxEffect): string {
  if (effect.high < 1) return 'under $1';
  if (effect.low === effect.high) return `about ${dollars(effect.high)}`;
  return `${dollars(effect.low)}–${dollars(effect.high)}`;
}
