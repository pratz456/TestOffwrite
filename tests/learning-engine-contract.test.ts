import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory Firestore documents: real learning-engine code, synthetic transport.
const store = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>() }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => ({
  doc: (id: string) => ({
    get: async () => { const data = store.docs.get(`${name}/${id}`); return { exists: !!data, data: () => data }; },
    set: async (data: Record<string, unknown>) => { store.docs.set(`${name}/${id}`, data); },
  }),
}) } }));
import { AILearningEngine, aiLearningEngine, learningMerchantKey } from '../lib/ai/learning-engine';

const root = new URL('..', import.meta.url).pathname;
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (['node_modules', '.next', 'mobile', 'tests'].includes(entry)) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(entry) ? [path] : [];
  });
}

beforeEach(() => { store.docs.clear(); vi.spyOn(console, 'log').mockImplementation(() => {}); });

describe('learning engine never auto-classifies deductions', () => {
  it('no application module references suggestClassification', () => {
    const offenders = ['app', 'lib', 'components', 'middleware.ts']
      .map(entry => join(root, entry))
      .flatMap(path => statSync(path).isDirectory() ? sourceFiles(path) : [path])
      .filter(file => readFileSync(file, 'utf8').includes('suggestClassification'));
    expect(offenders).toEqual([]);
    expect(aiLearningEngine).not.toHaveProperty('suggestClassification');
    expect(AILearningEngine.prototype).not.toHaveProperty('suggestClassification');
  });

  it('keeps the correction and learning-context entry points', () => {
    expect(typeof aiLearningEngine.recordCorrection).toBe('function');
    expect(typeof aiLearningEngine.getLearningContext).toBe('function');
    expect(typeof aiLearningEngine.getLearningInsights).toBe('function');
  });
});

describe('merchant lookups accept merchant or merchant_name', () => {
  it.each([
    [{ merchant_name: ' Adobe ' }, 'adobe'],
    [{ merchant: 'ADOBE' }, 'adobe'],
    [{ name: 'Adobe Inc' }, 'adobe inc'],
    [{ merchant_name: '', merchant: 'Figma' }, 'figma'],
    [{ merchant_name: 'Plaid name', merchant: 'analysis merchant' }, 'plaid name'],
    [{}, undefined], [null, undefined], [{ merchant: 42 }, undefined],
  ])('%j → %s', (record, key) => {
    expect(learningMerchantKey(record)).toBe(key);
  });

  it('finds a correction recorded from a stored record when analysis supplies `merchant`', async () => {
    await aiLearningEngine.recordCorrection('learner', 'tx-1', { merchant_name: 'Adobe', category: 'SOFTWARE', amount: 20, date: '2026-03-01' },
      { is_deductible: false, confidence: 0.4, reasoning: 'Personal subscription' }, { isDeductible: true, reasoning: 'Design tool for client work' });
    const correction = [...store.docs.entries()].find(([path]) => path.startsWith('user_corrections/'))![1];
    expect(correction.merchantName).toBe('Adobe');
    expect(correction.context).not.toHaveProperty('mcc');
    const context = await aiLearningEngine.getLearningContext('learner', { merchant: 'ADOBE', category: 'software', amount: 20 });
    expect(context.merchantPreference).toMatchObject({ preferredClassification: true, correctionCount: 1 });
    expect(context.categoryPreference).toMatchObject({ preferredClassification: true, correctionCount: 1 });
    expect(context).not.toHaveProperty('suggestedIsDeductible');
  });

  it('finds a correction recorded from analysis input when the stored record supplies `merchant_name`', async () => {
    await aiLearningEngine.recordCorrection('learner', 'tx-2', { merchant: 'Figma', category: 'SOFTWARE', amount: 15, date: '2026-03-01' },
      { is_deductible: true, confidence: 0.9 }, { isDeductible: false });
    const context = await aiLearningEngine.getLearningContext('learner', { merchant_name: 'figma' });
    expect(context.merchantPreference).toMatchObject({ preferredClassification: false, correctionCount: 1 });
    expect(await aiLearningEngine.getLearningContext('learner', { merchant_name: 'Unrelated' })).toMatchObject({ merchantPreference: null });
  });
});
