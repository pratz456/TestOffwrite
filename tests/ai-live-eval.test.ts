/**
 * Live-model evaluation of the transaction analysis engine. Opt-in and never part of CI:
 *
 *   WRITEOFF_LIVE_AI_EVAL=1 OPENAI_API_KEY=... [OPENAI_MODEL=gpt-4o] npx vitest run tests/ai-live-eval.test.ts
 *
 * Runs every golden-corpus transaction through the real analyzeTransaction path (prompt,
 * provider call, schema validation, grounding) and scores: category agreement with the
 * corpus label, status distribution, provider rejections, latency, and the same safety
 * invariants the offline harness enforces. Learning-engine and Firestore access are stubbed
 * so only the model call is live. A per-case JSON report is written under /tmp.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/learning-engine', () => ({ aiLearningEngine: { getLearningContext: async () => null, recordCorrection: async () => undefined } }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {}, adminAuth: {}, FieldValue: {}, Timestamp: {} }));

import { analyzeTransaction, type OutputType, type TransactionInput } from '@/lib/ai/analyzeTransaction';
import { AI_EVAL_CORPUS, type EvalCase } from './fixtures/ai-eval-corpus';

const enabled = process.env.WRITEOFF_LIVE_AI_EVAL === '1' && !!process.env.OPENAI_API_KEY;
const CONCURRENCY = Number(process.env.WRITEOFF_LIVE_AI_CONCURRENCY || 4);
const UNCONDITIONAL = /\b(?:is|are)\s+(?:fully|100%|completely)\s+deductible\b/i;
const INCOME_CATEGORY = /^INCOME(?:_|$)|REVENUE|SALES/;
const INCOME_WORDS = /\b(client|customer|invoice|business sales|service revenue|platform payout)\b/i;

interface CaseResult {
  id: string; title: string; merchant: string; amount: number;
  expectedCategory: string | null; gotCategory: string | null; categoryMatch: boolean | null;
  expectedStatus: string | null; gotStatus: string | null;
  kind: string | null; isDeductible: boolean | undefined; missingField: string | null; firstQuestion: string | null;
  failure: string | null; latencyMs: number; invariantViolations: string[]; reason: string | null;
}

function displayedText(result: OutputType): string {
  return [result.customized_reason, result.reasoning_summary, result.key_analysis_factor, result.reason, result.audit_risk_rationale,
    ...(result.questions ?? []), ...(result.documentation_required ?? [])].filter(Boolean).join(' ');
}
function savedText(transaction: TransactionInput): string {
  return [transaction.business_purpose, transaction.note, transaction.notes, transaction.description, transaction.client_project, transaction.meeting_notes]
    .map(value => (typeof value === 'string' ? value.trim() : '')).filter(Boolean).join(' ');
}
/** Safety properties every live result must satisfy regardless of what the model proposed. */
function violations(result: OutputType, c: EvalCase): string[] {
  const found: string[] = [];
  if (result.status !== 'ok') {
    if (result.is_deductible !== undefined || result.expense_type !== undefined || result.deductible_percent !== undefined) found.push('unresolved result carries a tax determination');
    if (UNCONDITIONAL.test(displayedText(result))) found.push('unresolved result claims an unconditional deduction');
    if (!result.questions?.[0]?.trim()) found.push('unresolved result without a first question');
  } else if (result.is_deductible === true && (result.expense_type !== 'business' || result.transaction_kind !== 'expense')) {
    found.push('deduction proposed without a business expense classification');
  }
  if (/https?:\/\//i.test(displayedText(result))) found.push('URL in displayed text');
  const amount = c.transaction.amount_usd ?? c.transaction.amount ?? 0;
  const category = (c.transaction.category ?? '').trim().toUpperCase();
  if (amount < 0 && !INCOME_CATEGORY.test(category) && !INCOME_WORDS.test(savedText(c.transaction)) && result.transaction_kind === 'income' && result.status === 'ok') {
    found.push('unexplained deposit counted as income');
  }
  if (['expense', 'refund'].includes(result.transaction_kind ?? '') && !result.documentation_required?.some(item => item.trim())) found.push('expense/refund without documentation_required');
  if (result.deductible_percent !== undefined && result.deductible_percent !== c.transaction.business_use_percentage && result.deductible_percent !== 100 && result.deductible_percent !== 0) {
    found.push(`deductible_percent ${result.deductible_percent} was not provided by the transaction`);
  }
  if (result.status === 'ok' && result.is_deductible === true && !result.sources?.length) found.push('deduction without resolved sources');
  return found;
}

async function mapLimit<T, R>(values: T[], limit: number, work: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) { const index = next++; results[index] = await work(values[index]); }
  }));
  return results;
}

const results: CaseResult[] = [];

(enabled ? describe : describe.skip)('live model evaluation over the golden corpus', () => {
  it('analyzes every corpus transaction with the configured model and records a scorecard', async () => {
    const outcomes = await mapLimit(AI_EVAL_CORPUS, CONCURRENCY, async c => {
      const started = performance.now();
      const outcome = await analyzeTransaction(c.transaction, c.context);
      const latencyMs = Math.round(performance.now() - started);
      const expectedCategory = typeof c.modelOutput.category === 'string' ? c.modelOutput.category : null;
      const expectedStatus = 'status' in c.expect ? c.expect.status : 'rejected' in c.expect ? 'rejected' : null;
      if (!outcome.success) {
        return { id: c.id, title: c.title, merchant: c.transaction.merchant, amount: c.transaction.amount_usd, expectedCategory, gotCategory: null, categoryMatch: null,
          expectedStatus, gotStatus: null, kind: null, isDeductible: undefined, missingField: null, firstQuestion: null, failure: outcome.code, latencyMs, invariantViolations: [], reason: outcome.error } satisfies CaseResult;
      }
      const result = outcome.result;
      return { id: c.id, title: c.title, merchant: c.transaction.merchant, amount: c.transaction.amount_usd, expectedCategory, gotCategory: result.category ?? null,
        categoryMatch: expectedCategory ? result.category === expectedCategory : null, expectedStatus, gotStatus: result.status, kind: result.transaction_kind ?? null,
        isDeductible: result.is_deductible, missingField: result.missing_fields?.[0] ?? null, firstQuestion: result.questions?.[0] ?? null, failure: null, latencyMs,
        invariantViolations: violations(result, c), reason: result.customized_reason ?? null } satisfies CaseResult;
    });
    results.push(...outcomes);
    // The live model may categorize differently from the corpus label; that is measured, not asserted.
    // Safety invariants are asserted: no live output may claim a deduction without a user decision.
    const violating = outcomes.filter(o => o.invariantViolations.length);
    expect(violating.map(o => `${o.id}: ${o.invariantViolations.join('; ')}`)).toEqual([]);
    const unavailable = outcomes.filter(o => o.failure === 'AI_UNAVAILABLE');
    expect(unavailable).toHaveLength(0);
  }, 600_000);

  afterAll(() => {
    if (!results.length) return;
    const labeled = results.filter(r => r.categoryMatch !== null);
    const matches = labeled.filter(r => r.categoryMatch).length;
    const statusCounts = Object.fromEntries(['ok', 'needs_more_info', 'blocked'].map(s => [s, results.filter(r => r.gotStatus === s).length]));
    const failures = results.filter(r => r.failure).length;
    const okDeductions = results.filter(r => r.gotStatus === 'ok' && r.isDeductible === true).length;
    const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
    const p = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] ?? 0;
    const statusAgreement = results.filter(r => r.expectedStatus && r.gotStatus === r.expectedStatus).length;
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const report = { model, generatedAt: new Date().toISOString(), cases: results.length, categoryAgreement: `${matches}/${labeled.length}`, statusAgreement: `${statusAgreement}/${results.filter(r => r.expectedStatus).length}`,
      statusCounts, providerFailures: failures, okWithDeduction: okDeductions, latencyMs: { p50: p(0.5), p95: p(0.95), max: latencies[latencies.length - 1] ?? 0 }, results };
    const file = path.join(os.tmpdir(), `writeoff-ai-live-eval-${model.replace(/[^a-z0-9.-]/gi, '_')}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.info(`[ai-live-eval] model=${model} cases=${results.length} category_agreement=${matches}/${labeled.length} status_agreement=${report.statusAgreement} ok=${statusCounts.ok} needs_more_info=${statusCounts.needs_more_info} blocked=${statusCounts.blocked} failures=${failures} ok_with_deduction=${okDeductions} p50=${p(0.5)}ms p95=${p(0.95)}ms report=${file}`);
  });
});
