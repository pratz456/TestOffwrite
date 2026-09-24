/** Opt-in, synthetic real-provider regression sample; never reads customer data. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/learning-engine', () => ({ aiLearningEngine: { getLearningContext: async () => null, recordCorrection: async () => undefined } }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {}, adminAuth: {}, FieldValue: {}, Timestamp: {} }));

import { analyzeTransaction, type OutputType, type TransactionInput, type UserContext } from '@/lib/ai/analyzeTransaction';
import { getOpenAIModel } from '@/lib/openai/client';
import { AI_EVAL_CORPUS, SOLE_PROPRIETOR } from './fixtures/ai-eval-corpus';
import { DESCRIPTOR_CASES, descriptorContext, descriptorTransaction } from './fixtures/ai-live-eval-descriptors';

interface Sample {
  id: string;
  transaction: TransactionInput;
  context?: UserContext;
  expected: 'review' | 'approved';
  category?: OutputType['category'];
}
function corpus(id: string): Sample {
  const item = AI_EVAL_CORPUS.find(item => item.id === id);
  if (!item) throw new Error(`Missing synthetic fixture: ${id}`);
  return { id, transaction: item.transaction, context: item.context, expected: 'review' };
}
function descriptor(id: string, expected: Sample['expected'], category?: Sample['category']): Sample {
  const item = DESCRIPTOR_CASES.find(item => item.id === id);
  if (!item) throw new Error(`Missing synthetic descriptor: ${id}`);
  return { id, transaction: descriptorTransaction(item), context: descriptorContext(item), expected, category };
}
function synthetic(id: string, merchant: string, amount: number, business_purpose: string, expected: Sample['expected'], category?: Sample['category']): Sample {
  return { id, transaction: { tx_id: `audit-${id}`, merchant, amount_usd: amount, date_iso: '2026-09-23', business_purpose }, context: SOLE_PROPRIETOR, expected, category };
}

const samples: Sample[] = [
  descriptor('legalzoom', 'review'),
  corpus('legalzoom-formation'),
  corpus('costco-mixed-with-percentage'),
  corpus('wa-dor-sales-tax-remitted'),
  corpus('nar-dues-realtor-ok'),
  descriptor('upwork-fee', 'approved', 'bank_and_payment_fees'),
  synthetic('operating-legal-control', 'Smith Law Firm', 450, 'Attorney review of my client services contract for the design business.', 'approved', 'legal_professional'),
  synthetic('annual-filing-control', 'Sunbiz', 138.75, 'Annual report fee for my existing LLC.', 'approved', 'taxes_licenses'),
  synthetic('software-food-client-control', 'Adobe', 59.99, 'Design software for food company client projects.', 'approved', 'software_subscriptions'),
  synthetic('upwork-contractor-control', 'Upwork', 750, 'Paid a freelance developer for the client web app build.', 'approved', 'contract_labor'),
  synthetic('solo-overnight-meal', 'Boston Cafe', 34, 'Dinner alone while away overnight for a client conference in Boston.', 'review'),
  synthetic('federal-employer-tax', 'IRS EFTPS', 350, 'Employer share of payroll taxes for my assistant.', 'review'),
  synthetic('printer-exact-200', 'Staples', 200, 'A printer used exclusively for client projects.', 'approved'),
  synthetic('printer-above-200', 'Staples', 200.01, 'A printer used exclusively for client projects.', 'review'),
];

const enabled = process.env.WRITEOFF_LIVE_AI_EVAL === '1' && Boolean(process.env.OPENAI_API_KEY);
(enabled ? describe : describe.skip)('targeted live tax-policy regressions', () => {
  it('withholds unresolved tax treatments and preserves supported operating costs', async () => {
    const results = new Array<Record<string, unknown>>(samples.length);
    let next = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (next < samples.length) {
        const index = next++;
        const sample = samples[index];
        const start = performance.now();
        const outcome = await analyzeTransaction(sample.transaction, sample.context);
        const violations: string[] = [];
        if (!outcome.success) {
          results[index] = { id: sample.id, expected: sample.expected, failure: outcome.code, latencyMs: Math.round(performance.now() - start), violations: ['provider or schema failure'] };
          continue;
        }
        const result = outcome.result;
        const approved = result.status === 'ok' && result.is_deductible === true;
        if (sample.expected === 'review' && result.status !== 'needs_more_info') violations.push('unresolved tax facts did not enter review');
        if (sample.expected === 'review' && (result.is_deductible !== undefined || result.deductible_percent !== undefined || result.expense_type !== undefined)) violations.push('unresolved tax treatment carries a determination');
        if (sample.expected === 'approved' && !approved) violations.push('supported operating expense was not approved');
        if (sample.category && result.category !== sample.category) violations.push(`expected category ${sample.category}`);
        if (result.status !== 'ok' && !result.questions?.[0]?.trim()) violations.push('review lacks a question');
        if (approved && !result.sources?.length) violations.push('approved expense lacks sources');
        if (approved && (result.transaction_kind !== 'expense' || result.expense_type !== 'business')) violations.push('approval lacks business-expense classification');
        if (sample.id === 'solo-overnight-meal' && /\b(?:this|your|solo) (?:travel )?meal (?:is|was) (?:always |necessarily )?personal\b/i.test(result.customized_reason ?? '')) violations.push('solo travel meal incorrectly declared personal');
        results[index] = { id: sample.id, expected: sample.expected, status: result.status, category: result.category, transactionKind: result.transaction_kind,
          isDeductible: result.is_deductible, deductiblePercent: result.deductible_percent, missingFields: result.missing_fields, firstQuestion: result.questions?.[0],
          reason: result.customized_reason, sourceIds: result.sources?.map(source => source.id), failure: null, latencyMs: Math.round(performance.now() - start), violations };
      }
    }));
    const model = getOpenAIModel('transaction');
    const failures = results.filter(result => (result.violations as string[]).length);
    const report = { model, generatedAt: new Date().toISOString(), cases: results.length, failedCases: failures.length, syntheticOnly: true, results };
    const file = path.join(os.tmpdir(), `writeoff-ai-tax-policy-targeted-${model.replace(/[^a-z0-9.-]/gi, '_')}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.info(`[ai-live-tax-policy] model=${model} cases=${results.length} failed=${failures.length} report=${file}`);
    expect(failures.map(result => `${result.id}: ${(result.violations as string[]).join('; ')}`)).toEqual([]);
  }, 300_000);
});
