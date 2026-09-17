import type { OutputType, TransactionInput, UserContext } from './analyzeTransaction';

/** Selected, reviewed federal rules. This is not retrieval over the entire tax code. */
export const TRANSACTION_TAX_POLICY_VERSION = 'federal-transactions-2026-09-16.1';
export const TRANSACTION_KINDS = ['expense', 'income', 'transfer', 'refund', 'personal', 'unknown'] as const;
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
const reviewed_at = '2026-09-16';
const codeUrl = (section: number) => `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section${section}&num=0&edition=prelim`;
const source = (id: string, title: string, url: string, edition: string, rule: string) =>
  ({ id, title, url, edition, reviewed_at, rule });

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
  source('records-334', 'IRS Publication 334 — Small-business income and expenses', 'https://www.irs.gov/publications/p334', '2025 publication; selected general principles only',
    'Separate business receipts, owner contributions, loans, transfers and refunds. A negative bank amount alone does not establish income or a refund. Match refunds to the original purchase and its tax year/treatment; prior-year deduction recoveries may be income under tax-benefit rules. Retain invoices and payment records. A refund is not a new positive deduction.'),
] as const;
export const TRANSACTION_EVIDENCE_IDS = TRANSACTION_TAX_EVIDENCE.map(item => item.id);

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
Use only the following evidence IDs for legal claims. Select up to three applicable IDs in evidence_ids. Return irs_refs=null; the server resolves titles and URLs. Do not invent sources, publication editions, Code sections, rates, deduction amounts or audit probabilities.
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
  const sectionEvidence: Record<string, string> = { '162': 'business-162', '262': 'personal-262', '274': 'meals-274', '263': 'capital-263', '179': 'assets-946' };
  const publicationEvidence: Record<string, string> = { '463': 'travel-463', '946': 'assets-946', '587': 'home-587', '334': 'records-334' };
  for (const match of explanation.matchAll(/(?:\bsection\s+|§\s*)(\d+[a-z]?)/gi)) {
    if (!ids.includes(sectionEvidence[match[1].toLowerCase()])) return null;
  }
  for (const match of explanation.matchAll(/\bpub(?:lication)?\.?\s+(\d+[a-z]?)/gi)) {
    if (!ids.includes(publicationEvidence[match[1].toLowerCase()])) return null;
  }
  if (result.status === 'ok' && (result.is_deductible === true && result.expense_type !== 'business' ||
      kind === 'personal' && (result.expense_type !== 'personal' || result.is_deductible !== false) ||
      ['income', 'transfer'].includes(kind) && result.is_deductible !== false)) return null;
  const saved = contextText(transaction);
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
  const applicableEvidence = kind === 'personal' || result.expense_type === 'personal' ? ['personal-262'] :
    ['income', 'refund', 'transfer'].includes(kind) ? ['records-334'] :
    kind === 'unknown' && amount <= 0 ? ['records-334', 'personal-262', 'business-162'] :
    result.category === 'meals_50' ? ['meals-274'] :
    result.category === 'vehicle_expense' ? assetPurchase ? ['assets-946', 'capital-263', 'travel-463'] : ['travel-463'] :
    result.category === 'travel' ? ['travel-463'] :
    result.category === 'equipment' ? ['assets-946', 'capital-263'] :
    result.category === 'home_office' ? ['home-587'] :
    result.status !== 'ok' && (!result.category || result.category === 'other') ? ['business-162', 'personal-262', 'records-334'] : ['business-162'];
  if (!applicableEvidence.some(id => ids.includes(id))) return null;
  const evidence = [...ids];
  const addEvidence = (id: string) => { if (!evidence.includes(id)) evidence.push(id); };
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
