export interface AIProviderStatus {
  configured: boolean;
  provider: 'openai';
  model: string;
  reason: 'not_configured' | 'disabled' | null;
}

/** Configuration only: a key's presence does not prove credit or provider health. */
export function getAIProviderStatus(): AIProviderStatus {
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const reason = process.env.AI_ANALYSIS_ENABLED === 'false' ? 'disabled'
    : process.env.OPENAI_API_KEY?.trim() ? null : 'not_configured';
  return { configured: reason === null, provider: 'openai', model, reason };
}
