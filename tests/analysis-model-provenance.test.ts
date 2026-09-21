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

  it('uses the normalized configured model for legacy results without provenance', () => {
    vi.stubEnv('OPENAI_MODEL', '  normalized-legacy-model  ');
    const saved = analysisSuggestionUpdate({ status: 'needs_more_info', questions: ['What was purchased?'] });
    expect(saved.ai_suggestion.model).toBe('normalized-legacy-model');
    expect(saved.ai_model).toBe('normalized-legacy-model');
    expect(saved.ai.model).toBe('normalized-legacy-model');
  });
});
