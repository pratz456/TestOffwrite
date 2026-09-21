import { getOpenAIModel, hasOpenAIAPIKey } from '@/lib/openai/client';

export interface AIProviderStatus {
  configured: boolean;
  provider: 'openai';
  model: string;
  reason: 'not_configured' | 'disabled' | null;
}

/** Configuration only: a key's presence does not prove credit or provider health. */
export function getAIProviderStatus(): AIProviderStatus {
  const model = getOpenAIModel('transaction');
  const reason = process.env.AI_ANALYSIS_ENABLED === 'false' ? 'disabled'
    : hasOpenAIAPIKey() ? null : 'not_configured';
  return { configured: reason === null, provider: 'openai', model, reason };
}
