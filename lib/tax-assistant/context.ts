import { learningMerchantKey } from '@/lib/ai/learning-engine';
import { transactionNeedsTaxReview } from '@/lib/utils/transaction-tax-review';
import { guidanceSource } from './knowledge';

/** Last-N read the assistant is allowed; merchant facts never come from an unbounded scan. */
export const ASSISTANT_TRANSACTION_LIMIT = 200;

/** Saved profile facts the server may state back to the user. Never model-written. */
export interface AssistantProfileFacts {
  profession: string | null;
  filingStatus: string | null;
  state: string | null;
  entityType: string | null;
  homeOfficeMethod: 'simplified' | 'actual' | null;
  vehicleMethod: 'standard_mileage' | 'actual_expense' | null;
}

/** Aggregated from the owner's own transactions when the question names a merchant they pay. */
export interface AssistantMerchantFacts {
  merchantKey: string;
  displayName: string;
  taxYear: number;
  count: number;
  totalCents: number;
  unreviewedCount: number;
}

export interface AssistantContext {
  profile: AssistantProfileFacts;
  merchant: AssistantMerchantFacts | null;
}

export interface ForYou {
  paragraph: string;
  /** The UI turns this into a "Review these N charges" button; the server decides the target. */
  action: { screen: 'transactions'; merchantKey: string; count: number; label: string } | null;
}

/** Minimal transaction shape the aggregate needs; matches the projected server read. */
export interface AssistantTransactionRow {
  merchant_name?: unknown;
  merchant?: unknown;
  name?: unknown;
  amount?: unknown;
  date?: unknown;
  type?: unknown;
  pending?: unknown;
  is_deductible?: boolean | null;
  user_classification_reason?: string | null;
  review_status?: string;
  tax_review_required?: boolean;
  ai_suggestion?: unknown;
  created_at?: unknown;
  userId?: unknown;
  user_id?: unknown;
}

const FILING_STATUS_LABELS: Record<string, string> = {
  single: 'single',
  married_filing_jointly: 'married filing jointly',
  married_filing_separately: 'married filing separately',
  head_of_household: 'head of household',
};

const ENTITY_LABELS: Record<string, string> = {
  sole_proprietor: 'sole proprietor',
  sole_proprietorship: 'sole proprietor',
  'sole-proprietor': 'sole proprietor',
  llc: 'LLC',
  single_member_llc: 'single-member LLC',
  'single-member-llc': 'single-member LLC',
  s_corp: 'S corporation',
  's-corp': 'S corporation',
  scorp: 'S corporation',
  s_corporation: 'S corporation',
  partnership: 'partnership',
  c_corp: 'C corporation',
  'c-corp': 'C corporation',
  c_corporation: 'C corporation',
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Normalize the saved profile into the six facts the assistant may use. Unknown values become null. */
export function assistantProfileFacts(profile: Record<string, unknown> | null | undefined): AssistantProfileFacts {
  const record = profile && typeof profile === 'object' ? profile : {};
  const professions = typeof record.profession === 'string' ? record.profession.split(',') : Array.isArray(record.profession) ? record.profession : [];
  const profession = professions.map(text).find((value): value is string => Boolean(value)) ?? null;
  const filingKey = text(record.filing_status)?.toLowerCase().replace(/\s+/g, '_') ?? '';
  const entityKey = (text(record.business_entity_type) ?? text(record.businessEntityType) ?? text(record.business_entity) ?? '').toLowerCase().replace(/\s+/g, '_');
  const homeOffice = record.home_office_method;
  const vehicle = record.vehicle_deduction_method;
  return {
    profession,
    filingStatus: FILING_STATUS_LABELS[filingKey] ?? null,
    state: text(record.state)?.toUpperCase().slice(0, 2) ?? null,
    entityType: ENTITY_LABELS[entityKey] ?? null,
    homeOfficeMethod: homeOffice === 'simplified' || homeOffice === 'actual' ? homeOffice : null,
    vehicleMethod: vehicle === 'standard_mileage' || vehicle === 'actual_expense' ? vehicle : null,
  };
}

/**
 * Words that appear in almost every deduction question or in almost every merchant string.
 * A token in this list never identifies a merchant on its own.
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'can', 'could', 'would', 'should', 'may', 'might', 'this', 'that', 'these', 'those', 'with', 'from', 'into',
  'about', 'over', 'under', 'what', 'when', 'where', 'which', 'who', 'why', 'how', 'does', 'did', 'was', 'were', 'are', 'have', 'has', 'had',
  'you', 'your', 'our', 'their', 'they', 'them', 'his', 'her', 'its', 'not', 'but', 'also', 'just', 'only', 'very', 'more', 'most', 'some',
  'any', 'all', 'each', 'every', 'other', 'another', 'same', 'own', 'new', 'old', 'last', 'next', 'first', 'one', 'two', 'per', 'via',
  'write', 'off', 'deduct', 'deductible', 'deduction', 'deductions', 'expense', 'expenses', 'business', 'work', 'working', 'personal', 'home', 'office',
  'tax', 'taxes', 'year', 'month', 'week', 'day', 'today', 'bill', 'bills', 'charge', 'charges', 'payment', 'payments', 'paid', 'pay', 'paying',
  'buy', 'bought', 'purchase', 'purchased', 'cost', 'costs', 'fee', 'fees', 'subscription', 'subscriptions', 'plan', 'service', 'services',
  'store', 'shop', 'online', 'app', 'card', 'credit', 'debit', 'cash', 'bank', 'account', 'inc', 'llc', 'corp', 'ltd', 'com', 'www', 'usa',
  'phone', 'cell', 'internet', 'laptop', 'computer', 'software', 'car', 'truck', 'vehicle', 'mileage', 'gas', 'parking', 'toll', 'tolls',
  'meal', 'meals', 'food', 'coffee', 'lunch', 'dinner', 'client', 'clients', 'travel', 'trip', 'flight', 'hotel', 'rent', 'insurance', 'health',
  'gym', 'membership', 'course', 'class', 'book', 'books', 'ads', 'advertising', 'website', 'domain', 'hosting', 'contractor', 'freelancer',
  'payments', 'pos', 'purchase', 'debit', 'checkcard', 'visa', 'mastercard', 'amex', 'pending', 'recurring', 'autopay', 'web', 'order',
]);

/**
 * Well-known merchants freelancers type in lowercase; capitalization alone would miss them.
 * Brands that are also everyday English words (Target, Shell, Square, Monday) are left out so a
 * plain question does not trigger a transaction read; typing them capitalized still matches.
 */
const KNOWN_MERCHANTS = new Set([
  'adobe', 'figma', 'canva', 'notion', 'slack', 'zoom', 'dropbox', 'google', 'microsoft', 'apple', 'amazon', 'aws', 'uber', 'lyft', 'doordash',
  'instacart', 'squarespace', 'wix', 'godaddy', 'namecheap', 'mailchimp', 'shopify', 'stripe', 'paypal', 'venmo', 'quickbooks',
  'freshbooks', 'wework', 'regus', 'verizon', 'comcast', 'xfinity', 'starbucks', 'costco', 'staples', 'ikea', 'linkedin', 'upwork',
  'fiverr', 'hubspot', 'salesforce', 'github', 'openai', 'chatgpt', 'midjourney', 'grammarly', 'calendly', 'docusign', 'gusto', 'netflix',
  'spotify', 'peloton', 'equinox', 'southwest', 'marriott', 'hilton', 'airbnb', 'expedia', 'zapier', 'airtable', 'asana',
  'trello', 'clickup', 'webflow', 'framer', 'vercel', 'netlify', 'heroku', 'digitalocean', 'cloudflare', 'twilio', 'sendgrid',
  'mailgun', 'convertkit', 'substack', 'patreon', 'etsy', 'ebay', 'walmart', 'lowes', 'depot', 'chevron', 'exxon',
  'tmobile', 'honeybook', 'dubsado', 'squareup', 'lightspeed', 'coursera', 'udemy', 'skillshare',
  'masterclass', 'audible', 'kindle', 'canon', 'nikon', 'sony', 'dell', 'lenovo', 'logitech', 'bestbuy', 'newegg', 'fedex',
  'usps', 'hertz', 'avis', 'turo', 'geico', 'allstate', 'hiscox', 'nextinsurance', 'thimble', 'legalzoom',
  'turbotax', 'hrblock', 'taxact', 'brex', 'ramp', 'wellsfargo', 'citi', 'capitalone', 'amex',
]);

function tokens(value: string): string[] {
  return value.toLowerCase().replace(/['’]s\b/g, '').split(/[^a-z0-9]+/).filter(token => token.length >= 3);
}

/**
 * Words in the question that could be a merchant the user pays: capitalized mid-sentence, all-caps,
 * brand-shaped (digits or camel case) or on the known-merchant list. Empty means no lookup runs.
 */
export function merchantCandidates(message: string): string[] {
  const found = new Set<string>();
  const words = message.replace(/['’]s\b/g, '').split(/\s+/).filter(Boolean);
  words.forEach((raw, index) => {
    const word = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (word.length < 3) return;
    const lower = word.toLowerCase();
    if (STOPWORDS.has(lower)) return;
    const sentenceStart = index === 0 || /[.!?]$/.test(words[index - 1]);
    const capitalized = /^[A-Z][a-z]/.test(word) && !sentenceStart;
    const allCaps = /^[A-Z0-9]{3,}$/.test(word) && /[A-Z]/.test(word);
    const brandShaped = /[a-z][A-Z]/.test(word) || /^[A-Za-z]+\d|\d[A-Za-z]+$/.test(word);
    if (capitalized || allCaps || brandShaped || KNOWN_MERCHANTS.has(lower)) found.add(lower);
  });
  return [...found];
}

function rowYear(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-\d{2}-\d{2}/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

function cents(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

/**
 * Count and total the owner's charges from the merchant the question names. Rows that carry a
 * different owner id are ignored even if a reader returned them. Only one merchant is reported.
 */
export function mentionedMerchantFacts(input: { message: string; rows: readonly AssistantTransactionRow[]; taxYear: number; uid: string }): AssistantMerchantFacts | null {
  const candidates = merchantCandidates(input.message);
  if (!candidates.length) return null;
  const lowerMessage = ` ${tokens(input.message).join(' ')} `;
  const groups = new Map<string, AssistantMerchantFacts & { wholeKey: boolean }>();
  for (const row of input.rows) {
    const owner = row.userId ?? row.user_id;
    if (typeof owner === 'string' && owner && owner !== input.uid) continue;
    if (row.pending === true || row.type === 'income') continue;
    if (rowYear(row.date) !== input.taxYear) continue;
    const key = learningMerchantKey(row);
    if (!key) continue;
    const keyTokens = tokens(key).filter(token => !STOPWORDS.has(token));
    const wholeKey = keyTokens.length > 1 && lowerMessage.includes(` ${keyTokens.join(' ')} `);
    if (!wholeKey && !keyTokens.some(token => candidates.includes(token))) continue;
    const amount = cents(row.amount);
    if (amount === null || amount <= 0) continue;
    const group = groups.get(key) ?? {
      merchantKey: key,
      displayName: text(row.merchant_name) ?? text(row.merchant) ?? text(row.name) ?? key,
      taxYear: input.taxYear, count: 0, totalCents: 0, unreviewedCount: 0, wholeKey,
    };
    group.count += 1;
    group.totalCents += amount;
    if (transactionNeedsTaxReview(row)) group.unreviewedCount += 1;
    group.wholeKey = group.wholeKey || wholeKey;
    groups.set(key, group);
  }
  const best = [...groups.values()].sort((a, b) => Number(b.wholeKey) - Number(a.wholeKey) || b.count - a.count)[0];
  if (!best) return null;
  return { merchantKey: best.merchantKey, displayName: best.displayName, taxYear: best.taxYear, count: best.count, totalCents: best.totalCents, unreviewedCount: best.unreviewedCount };
}

export const usd = (centsValue: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(centsValue / 100);

/** Routing-only view for the model: facts, no dollar totals. The model cannot emit any of it anyway. */
export function assistantContextForModel(context: AssistantContext | null | undefined): string | null {
  if (!context) return null;
  const { profile, merchant } = context;
  const lines = [
    profile.profession && `Profession: ${profile.profession}`,
    profile.entityType && `Entity: ${profile.entityType}`,
    profile.filingStatus && `Filing status: ${profile.filingStatus}`,
    profile.state && `State: ${profile.state}`,
    `Home office method saved: ${profile.homeOfficeMethod ?? 'no'}`,
    `Vehicle method saved: ${profile.vehicleMethod ? profile.vehicleMethod.replace('_', ' ') : 'no'}`,
    merchant && `The user has ${merchant.count} ${merchant.displayName} charge${merchant.count === 1 ? '' : 's'} in ${merchant.taxYear}; the question is about their own transactions.`,
  ].filter((line): line is string => Boolean(line));
  return lines.join('\n');
}

const METHOD_LABELS = { simplified: 'the simplified method', actual: 'the actual-expense method', standard_mileage: 'the standard mileage rate', actual_expense: 'actual vehicle expenses' } as const;
const HOME_TOPICS = new Set(['home-office', 'home-rent', 'home-internet']);
const VEHICLE_TOPICS = new Set(['car-mileage-vs-actual', 'vehicles-records', 'parking-tolls', 'vehicle-loan-interest', 'business-interest']);
const FILING_TOPICS = new Set(['health-insurance', 'retirement-plans', 'hsa', 'qbi-deduction', 'estimated-taxes', 'side-hustle-w2', 'business-losses', 'charitable-gifts', 'charitable-non-itemizer', 'senior-deduction', 'tips-overtime', 'vehicle-loan-interest']);
const ENTITY_TOPICS = new Set(['owner-draws', 'family-employees', 'contract-labor', 'when-to-see-a-cpa', 'health-insurance', 'retirement-plans', 'qbi-deduction', 'business-expenses']);
const STATE_TOPICS = new Set(['state-taxes-licenses', 'estimated-taxes', 'when-to-see-a-cpa', 'side-hustle-w2']);

/**
 * The "For you" paragraph. Every number comes from the owner's own rows; every rule comes from the
 * reviewed packet. Returns null when nothing personal is known, so the UI shows nothing rather than filler.
 */
export function composeForYou(context: AssistantContext | null | undefined, topic: string): ForYou | null {
  if (!context || topic === 'not-supported') return null;
  const { profile, merchant } = context;
  const sentences: string[] = [];
  const packet = guidanceSource(topic);
  const work = profile.profession ? `${profile.profession} work` : 'business';

  if (merchant) {
    const plural = merchant.count === 1 ? '' : 's';
    const unreviewed = merchant.unreviewedCount === 0
      ? (merchant.count === 1 ? 'it is reviewed' : 'all are reviewed')
      : merchant.unreviewedCount === merchant.count
        ? `${merchant.unreviewedCount === 1 ? 'it is' : 'all are'} unreviewed`
        : `${merchant.unreviewedCount} ${merchant.unreviewedCount === 1 ? 'is' : 'are'} unreviewed`;
    sentences.push(`You have ${merchant.count} ${merchant.displayName} charge${plural} in ${merchant.taxYear} totaling ${usd(merchant.totalCents)}; ${unreviewed}.`);
    if (packet?.placement) {
      sentences.push(/^Not (deductible|a deduction)/i.test(packet.placement)
        ? `The reviewed rule above treats ${merchant.count === 1 ? 'this charge' : 'these charges'} as personal unless the exception described applies (${packet.placement}).`
        : `If ${merchant.count === 1 ? 'it is' : 'they are'} used in your ${work}, ${merchant.count === 1 ? 'it belongs' : 'they belong'} on ${packet.placement}.`);
    }
  }

  if (HOME_TOPICS.has(topic)) {
    sentences.push(profile.homeOfficeMethod
      ? `Your saved home office method is ${METHOD_LABELS[profile.homeOfficeMethod]}, so the answer above applies through that method.`
      : 'You have not saved a home office method yet; the assistant cannot tell which method applies until you do.');
  }
  if (VEHICLE_TOPICS.has(topic)) {
    sentences.push(profile.vehicleMethod
      ? `Your saved vehicle method is ${METHOD_LABELS[profile.vehicleMethod]}; the method in the first year the car was used for business controls what is allowed later.`
      : 'No vehicle deduction method is saved yet, so mileage and actual costs both remain open for this year.');
  }
  if (FILING_TOPICS.has(topic) && profile.filingStatus) {
    sentences.push(`Your saved filing status is ${profile.filingStatus}; the income thresholds above are read for that status.`);
  }
  if (ENTITY_TOPICS.has(topic) && profile.entityType) {
    sentences.push(/S corporation|partnership|C corporation/.test(profile.entityType)
      ? `Your business is saved as ${profile.entityType.startsWith('S') || profile.entityType.startsWith('C') ? 'an' : 'a'} ${profile.entityType}; this guidance is written for Schedule C filers and needs a preparer's review for that entity.`
      : `Your business is saved as a ${profile.entityType}, which reports on Schedule C.`);
  }
  if (STATE_TOPICS.has(topic) && profile.state) {
    sentences.push(`${profile.state} state rules are not covered here; this answer is federal only.`);
  }
  if (!merchant && !HOME_TOPICS.has(topic) && !VEHICLE_TOPICS.has(topic) && profile.profession && packet?.placement && !/^Not /.test(packet.placement)) {
    sentences.push(`For your ${work}, the placement above (${packet.placement}) is where a qualifying cost is reported.`);
  }

  if (!sentences.length) return null;
  return {
    paragraph: sentences.join(' '),
    action: merchant && merchant.unreviewedCount > 0
      ? { screen: 'transactions', merchantKey: merchant.merchantKey, count: merchant.unreviewedCount, label: `Review ${merchant.unreviewedCount === 1 ? 'this charge' : `these ${merchant.unreviewedCount} charges`}` }
      : merchant
        ? { screen: 'transactions', merchantKey: merchant.merchantKey, count: merchant.count, label: `See ${merchant.count === 1 ? 'this charge' : `these ${merchant.count} charges`}` }
        : null,
  };
}
