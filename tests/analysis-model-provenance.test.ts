import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
import { analysisSuggestionUpdate } from '@/lib/ai/analysis-persistence';

afterEach(() => vi.unstubAllEnvs());

describe('saved analysis model provenance', () => {
  it('preserves the model that performed analysis even when the configured model changes before persistence', () => {
    vi.stubEnv('OPENAI_MODEL', 'a-different-model-now');
    const saved = analysisSuggestionUpdate({ status: 'needs_more_info', questions: ['What was purchased?'],
      provenance: { provider: 'openai', model: 'actual-provider-snapshot', kind: 'model_with_curated_tax_policy' } });
    expect(saved.ai_suggestion.model).toBe('actual-provider-snapshot');
    expect(saved.ai_model).toBe('actual-provider-snapshot');
    expect(saved.ai.model).toBe('actual-provider-snapshot');
    expect(saved.ai_provenance).toEqual({ provider: 'openai', model: 'actual-provider-snapshot', kind: 'model_with_curated_tax_policy' });
  });

  it('takes the explanation year from the transaction date when the model tax year differs', () => {
    const source = readFileSync('lib/ai/analysis-persistence.ts', 'utf8');
    expect(source).toContain('taxYear: resolveOtherExpensesYear(canonicalData)');
    expect(source).not.toContain('evidence.tax_year ?? savedDate');
    expect(source).not.toContain('canonicalData.date.slice(0, 4)');
    const saved = analysisSuggestionUpdate({
      status: 'ok',
      transaction_kind: 'expense',
      category: 'dues_and_memberships',
      is_deductible: true,
      deductible_percent: 100,
      expense_type: 'business',
      tax_year: 2026,
      schedule_c_line: '27a',
      customized_reason: 'The membership maintains skills already used for current client work.',
      provenance: { provider: 'openai', model: 'test-model', kind: 'model_with_curated_tax_policy' },
    }, Date.now(), {
      amount: 80,
      date: '2024-06-15',
      category: 'SERVICE_MEMBERSHIPS',
      merchant_name: 'Dues',
    }, 'hash', { filing_status: 'single' });
    expect(saved.ai_explanation.scheduleCLine).toBe('Schedule C line 27a (Other expenses)');
    expect(saved.ai_tax_year).toBe(2026);
    const invalid = analysisSuggestionUpdate({
      status: 'ok',
      transaction_kind: 'expense',
      category: 'dues_and_memberships',
      is_deductible: true,
      deductible_percent: 100,
      expense_type: 'business',
      tax_year: 2026,
      schedule_c_line: '27a',
      customized_reason: 'The membership maintains skills already used for current client work.',
      provenance: { provider: 'openai', model: 'test-model', kind: 'model_with_curated_tax_policy' },
    }, Date.now(), {
      amount: 80,
      date: '2024-13-45',
      category: 'SERVICE_MEMBERSHIPS',
      merchant_name: 'Dues',
    }, 'hash', { filing_status: 'single' });
    expect(invalid.ai_explanation.scheduleCLine).toBeNull();
  });

  it('uses the normalized configured model for legacy results without provenance', () => {
    vi.stubEnv('OPENAI_MODEL', '  normalized-legacy-model  ');
    const saved = analysisSuggestionUpdate({ status: 'needs_more_info', questions: ['What was purchased?'] });
    expect(saved.ai_suggestion.model).toBe('normalized-legacy-model');
    expect(saved.ai_model).toBe('normalized-legacy-model');
    expect(saved.ai.model).toBe('normalized-legacy-model');
  });
});
