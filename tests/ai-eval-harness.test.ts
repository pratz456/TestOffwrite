/**
 * Offline evaluation harness for the AI transaction-analysis pipeline.
 * Every corpus case runs through the deterministic grounding layer; a handful also run
 * end-to-end through analyzeTransaction with a mocked provider. No network, no model.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AI_EVAL_CORPUS, KNOWN_CONCERNS, MODEL_OUTPUT_KEYS, type EvalCase, type EvalInvariant } from './fixtures/ai-eval-corpus';
import { groundTransactionAnalysis, TRANSACTION_EVIDENCE_IDS, TRANSACTION_TAX_POLICY_VERSION, uncitedReferences } from '@/lib/ai/transaction-tax-policy';

const mocks = vi.hoisted(() => ({ create: vi.fn(), learning: vi.fn() }));
vi.mock('@/lib/openai/client', () => ({
  getOpenAIModel: () => 'gpt-4o', hasOpenAIAPIKey: () => true,
  getOpenAIClientOrThrow: () => ({ chat: { completions: { create: mocks.create } } }),
}));
vi.mock('@/lib/ai/learning-engine', () => ({ aiLearningEngine: { getLearningContext: mocks.learning } }));
import { analyzeTransaction, type OutputType, type TransactionInput } from '@/lib/ai/analyzeTransaction';

const MODEL = 'gpt-4o';
const E2E_CASE_IDS = ['adobe-purpose', 'adobe-no-purpose', 'laptop-1900', 'zelle-deposit-no-note', 'dated-2024',
  'stripe-payout-income-category', 'verizon-percentage-mismatch'];

/** Mirrors parseProviderOutput's pre-grounding normalization so both paths see identical input. */
function normalizeModelOutput(raw: Record<string, unknown>): OutputType {
  const output = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null)) as unknown as OutputType;
  if (output.status !== 'ok') { delete output.is_deductible; delete output.expense_type; delete output.deductible_percent; }
  return output;
}
function ground(c: EvalCase): OutputType | null {
  return groundTransactionAnalysis(normalizeModelOutput(c.modelOutput), c.transaction, c.context, MODEL);
}
const outcomes = new Map(AI_EVAL_CORPUS.map(c => [c.id, ground(c)] as const));
const passed = new Set<string>();

// --- Invariant checkers (pure; return a failure description or null) ---------
const UNCONDITIONAL = /\b(?:is|are)\s+(?:fully|100%|completely)\s+deductible\b/i;
const INCOME_CATEGORY = /^INCOME(?:_|$)|REVENUE|SALES/;
const INCOME_WORDS = /\b(client|customer|invoice|business sales|service revenue|platform payout)\b/i;

function displayedText(result: OutputType): string {
  return [result.customized_reason, result.reasoning_summary, result.key_analysis_factor, result.reason, result.audit_risk_rationale,
    ...(result.questions ?? []), ...(result.documentation_required ?? [])].filter(Boolean).join(' ');
}
function savedText(transaction: TransactionInput): string {
  return [transaction.business_purpose, transaction.note, transaction.notes, transaction.description, transaction.client_project, transaction.meeting_notes]
    .map(value => (typeof value === 'string' ? value.trim() : '')).filter(Boolean).join(' ');
}
const checkers: Record<EvalInvariant, (result: OutputType, c: EvalCase) => string | null> = {
  no_unconditional_deduction: result => {
    if (result.status !== 'ok') {
      if (result.is_deductible !== undefined || result.expense_type !== undefined || result.deductible_percent !== undefined) return 'unresolved result carries a tax determination';
      return UNCONDITIONAL.test(displayedText(result)) ? 'unresolved result claims an unconditional deduction' : null;
    }
    return result.is_deductible === true && (result.expense_type !== 'business' || result.transaction_kind !== 'expense')
      ? 'deduction proposed without a business expense classification' : null;
  },
  no_url: result => (/https?:\/\//i.test(displayedText(result)) ? 'URL in displayed text' : null),
  no_uncited_section: result => {
    // Every statute, regulation or publication named in displayed text must be backed by a selected evidence id.
    const missing = uncitedReferences(displayedText(result), result.evidence_ids ?? []);
    return missing.length ? `uncited reference ${missing.join(', ')}` : null;
  },
  no_deposit_as_income: (result, c) => {
    const amount = c.transaction.amount_usd ?? c.transaction.amount ?? 0;
    const category = (c.transaction.category ?? '').trim().toUpperCase();
    const unexplained = amount < 0 && !INCOME_CATEGORY.test(category) && !INCOME_WORDS.test(savedText(c.transaction));
    return unexplained && result.transaction_kind === 'income' && result.status === 'ok' ? 'unexplained deposit counted as income' : null;
  },
  documentation_present: result => (['expense', 'refund'].includes(result.transaction_kind ?? '') && !result.documentation_required?.some(item => item.trim())
    ? 'expense/refund without documentation_required' : null),
  question_present: result => (result.status !== 'ok' && !result.questions?.[0]?.trim() ? 'unresolved result without a first question' : null),
  prior_decision_gated: result => (result.status === 'needs_more_info' && result.missing_fields?.includes('prior_decision_conflict') ? null : 'prior personal decisions not gated'),
  percent_not_assumed: (result, c) => (result.deductible_percent === undefined || result.deductible_percent === c.transaction.business_use_percentage
    ? null : `deductible_percent ${result.deductible_percent} was not provided by the transaction`),
};

function assertExpectation(c: EvalCase, result: OutputType | null) {
  const expectation = c.expect;
  if ('rejected' in expectation) { expect(result).toBeNull(); return; }
  expect(result).not.toBeNull();
  const grounded = result!;
  expect(grounded.status).toBe(expectation.status);
  if (expectation.transaction_kind !== undefined) expect(grounded.transaction_kind).toBe(expectation.transaction_kind);
  if (expectation.is_deductible !== undefined) expect(grounded.is_deductible).toBe(expectation.is_deductible);
  if (expectation.category !== undefined) expect(grounded.category).toBe(expectation.category);
  if (expectation.deductible_percent !== undefined) expect(grounded.deductible_percent).toBe(expectation.deductible_percent);
  if (expectation.missing_field !== undefined) expect(grounded.missing_fields).toContain(expectation.missing_field);
  for (const id of expectation.evidence_includes ?? []) expect(grounded.evidence_ids).toContain(id);
  // Server-owned metadata is always present on an accepted result.
  expect(grounded).toMatchObject({ jurisdiction: 'US-federal', policy_version: TRANSACTION_TAX_POLICY_VERSION, provenance: { provider: 'openai', model: MODEL, kind: 'model_with_curated_tax_policy' } });
  expect(grounded.sources?.map(source => source.id)).toEqual(grounded.evidence_ids);
  expect(grounded.evidence_ids?.every(id => TRANSACTION_EVIDENCE_IDS.includes(id))).toBe(true);
}

describe('AI evaluation corpus through the grounding layer', () => {
  it('has unique ids, complete strict-schema outputs and documented concerns', () => {
    const ids = AI_EVAL_CORPUS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(60);
    for (const c of AI_EVAL_CORPUS) expect(Object.keys(c.modelOutput).sort(), c.id).toEqual([...MODEL_OUTPUT_KEYS].sort());
    for (const concern of KNOWN_CONCERNS) {
      expect(concern.rationale.length).toBeGreaterThan(20);
      if (!concern.id.startsWith('redteam-')) expect(ids, concern.id).toContain(concern.id);
    }
    expect(new Set(KNOWN_CONCERNS.map(c => c.id)).size).toBe(KNOWN_CONCERNS.length);
  });

  it.each(AI_EVAL_CORPUS)('$id: $title', c => {
    const result = outcomes.get(c.id) ?? null;
    assertExpectation(c, result);
    if (result) {
      const failures = c.invariants.map(name => { const failure = checkers[name](result, c); return failure ? `${name}: ${failure}` : null; }).filter(Boolean);
      expect(failures).toEqual([]);
    } else {
      expect(c.invariants).toEqual([]);
    }
    passed.add(c.id);
  });
});

describe('end-to-end wiring through analyzeTransaction with a mocked provider', () => {
  beforeAll(() => { vi.stubEnv('AI_ANALYSIS_ENABLED', 'true'); mocks.learning.mockResolvedValue(null); });
  afterAll(() => vi.unstubAllEnvs());

  it.each(E2E_CASE_IDS.map(id => AI_EVAL_CORPUS.find(c => c.id === id)!))('$id reaches the same grounded result as the direct path', async c => {
    mocks.create.mockResolvedValueOnce({ model: MODEL, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(c.modelOutput) } }] });
    const outcome = await analyzeTransaction(c.transaction, c.context);
    expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ model: MODEL, store: false }));
    const direct = outcomes.get(c.id) ?? null;
    if (!direct) { expect(outcome).toMatchObject({ success: false, code: 'AI_INVALID_OUTPUT', retryable: false }); return; }
    expect(outcome.success).toBe(true);
    if (!outcome.success) return;
    const { reason_hash, ...grounded } = outcome.result;
    expect(reason_hash).toMatch(/^[a-f0-9]{16}$/);
    expect(grounded).toEqual(direct);
    expect(grounded).toMatchObject({
      jurisdiction: 'US-federal', policy_version: TRANSACTION_TAX_POLICY_VERSION, tax_year: Number(c.transaction.date_iso.slice(0, 4)),
      provenance: { provider: 'openai', model: MODEL, kind: 'model_with_curated_tax_policy' },
    });
    expect(grounded.sources?.length).toBeGreaterThan(0);
    for (const source of grounded.sources ?? []) expect(source.url).toMatch(/^https:\/\/(?:uscode\.house\.gov|www\.ecfr\.gov|www\.irs\.gov)\//);
  });
});

afterAll(() => {
  const results = [...outcomes.values()];
  const count = (predicate: (result: OutputType) => boolean) => results.filter((result): result is OutputType => !!result && predicate(result)).length;
  console.info(`[ai-eval scorecard] cases=${AI_EVAL_CORPUS.length} passed=${passed.size} rejected=${results.filter(result => result === null).length}`
    + ` needs_more_info=${count(result => result.status === 'needs_more_info')} blocked=${count(result => result.status === 'blocked')}`
    + ` ok=${count(result => result.status === 'ok')} ok_with_deduction=${count(result => result.status === 'ok' && result.is_deductible === true)}`
    + ` known_concerns=${KNOWN_CONCERNS.length}`);
});
