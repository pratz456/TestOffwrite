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
import { getMarginalTaxRate, getUserTaxRate } from '@/lib/tax-rules/federal-brackets';
import { getFederalTaxRules, SUPPORTED_TAX_YEARS, type SupportedTaxYear } from '@/lib/tax-rules/federal-year-rules';
import { normalizeFilingStatus } from '@/lib/tax-rules/filing-status';
import { calcCombinedSERate } from '@/lib/tax-rules/kpi-calculations';

/** Optional metadata the tax-policy grounding may attach; absent on older results. */
export type ExplainableResult = OutputType & { proposed_purpose?: string | null; schedule_c_line?: string | null };

/** Saved transaction facts the explanation may cite. Accepts the API input shape or a raw saved record. */
export type ExplanationTransaction = {
  amount?: number | null; amount_usd?: number | null;
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
  /** Whole dollars; low uses the effective federal rate, high the marginal bracket, both plus SE tax. */
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
  'personal-262': '26 USC 262 disallows personal, living and family costs even when they make work easier. Only a separately identifiable business portion can qualify, and no split is assumed.',
  'meals-274': '26 USC 274 limits a qualifying business meal to 50% and requires a business purpose, the people present, your attendance and a non-lavish food cost stated separately from entertainment, which is not deductible.',
  'travel-463': 'IRS Publication 463: commuting to a regular work location is personal. Overnight travel depends on your tax home, business purpose and dates. Vehicle costs depend on logged business miles and your chosen method.',
  'capital-263': '26 USC 263: an asset or improvement is generally capitalized rather than expensed in full. The item, the date it was first used for business and any election decide that, not the price or the merchant.',
  'assets-946': 'IRS Publication 946: depreciation, Section 179 and bonus depreciation are separate treatments that depend on the asset, the date it was placed in service and its business-use percentage.',
  'home-587': 'IRS Publication 587: a home workspace normally must be used regularly and exclusively for business and be your principal place of business or meet another listed use. The method and the business area set the amount.',
  'records-334': 'IRS Publication 334: customer receipts, owner contributions, loans, transfers and refunds are different flows. A bank credit alone does not establish income, and a refund reduces the original expense instead of creating a deduction.',
};

const MISSING_FACT_LABELS: Record<string, string> = {
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
  deduction_placement: 'whether this is a health, dental or vision premium',
  club_dues_exception: 'whether this facility is used only in your business',
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
  refund: 'Refund: reduces the original expense, not a new deduction',
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
  return sources.map(source => RULES[source.id] ?? `This suggestion relies on ${text(source.title, 120) ?? 'a reviewed federal source'}.`).join(' ');
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

const SE_RATE = 0.9235 * 0.153;          // Schedule SE: 15.3% of 92.35% of net profit
const SE_MEDICARE_ONLY = 0.9235 * 0.029; // above the Social Security wage base only the Medicare part applies
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
    const percent = finite(result.deductible_percent) ?? 100;
    const deductible = amount * Math.min(Math.max(percent, 0), 100) / 100;
    const w2Income = Math.max(finite(profile.w2_income) ?? 0, 0);
    const seRate = seIncome === null ? SE_RATE
      : seIncome * 0.9235 >= getFederalTaxRules(year).socialSecurityWageBase ? SE_MEDICARE_ONLY
        : calcCombinedSERate(seIncome, status, 0, year).seTaxRate / 100;
    // The bracket lookup needs total income; W-2 wages push the last self-employment dollar into a higher bracket.
    const marginal = getMarginalTaxRate({ income: seIncome === null ? undefined : seIncome + w2Income, filing_status: status }, year) / 100;
    const effective = seIncome === null ? 0 : getUserTaxRate({ income: seIncome, filing_status: status, w2_income: w2Income }, year);
    const bounds = [deductible * (seRate + effective), deductible * (seRate + marginal)].map(value => Math.round(value));
    const low = Math.min(...bounds), high = Math.max(...bounds);
    if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
    const share = percent < 100 ? ` at ${percent}%` : '';
    const income = seIncome === null
      ? 'No income is saved in your profile, so this uses a 25% federal fallback rate; add your income for a closer estimate.'
      : `Based on your saved self-employment income and ${FILING_LABELS[status] ?? status} filing status for ${year}.`;
    return { low, high, label: ESTIMATE_LABEL,
      basis: `${money(deductible)} deductible${share} from this ${money(amount)} charge. Federal income tax plus self-employment tax; state tax is not included and this is not a refund amount. ${income}` };
  } catch {
    return null;
  }
}

export function composeExplanation({ result, transaction, profile, taxYear }: ComposeExplanationInput): TransactionExplanation {
  const tx = record(transaction);
  const saved = record(profile);
  const category = reviewCategory(result.category);
  const rawAmount = finite(tx.amount_usd) ?? finite(tx.amount);
  const merchant = text(tx.merchant_name, 60) ?? text(tx.merchant, 60) ?? text(tx.name, 60);
  const estimate = estimateTaxEffect(result, rawAmount, saved, taxYear);
  const facts = factsFor(tx);
  if (estimate) {
    try { facts.push(`Filing status used for the estimate: ${FILING_LABELS[normalizeFilingStatus(saved.filing_status)] ?? 'single'}`); } catch { /* the estimate already withheld itself */ }
  }
  const subject = merchant && rawAmount !== null ? ` — ${merchant}, ${money(Math.abs(rawAmount))}` : merchant ? ` — ${merchant}` : '';
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
