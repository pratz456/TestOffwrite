import OpenAI from 'openai';

export type OpenAITask = 'transaction' | 'assistant' | 'voice' | 'document';
export interface OpenAIRequestPolicy { timeout?: number; maxRetries?: number }

const DEFAULT_MODELS: Record<OpenAITask, string> = {
  // Live evaluation 2026-09-17 (docs/AI_LIVE_EVAL_2026-09-17_round2.md): gpt-4.1-mini approved 23/26 approvable
  // descriptors with zero provider failures at $0.0011 per transaction; gpt-4o-mini approved 5/26.
  transaction: 'gpt-4.1-mini',
  assistant: 'gpt-4o',
  voice: 'gpt-4o-mini',
  document: 'gpt-4o',
};

/** One server secret for every feature; public or legacy keys are never fallbacks. */
function serverAPIKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim() || undefined;
}

/** Presence only: this is not a billing or provider-health check. */
export function hasOpenAIAPIKey(): boolean {
  return Boolean(serverAPIKey());
}

/** OPENAI_MODEL is the optional global override for every OpenAI feature. */
export function getOpenAIModel(task: OpenAITask = 'transaction'): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODELS[task];
}

export function getOpenAIClientOrThrow(options: OpenAIRequestPolicy = {}): OpenAI {
  if (typeof window !== 'undefined') throw new Error('OpenAI is only available on the server');
  const apiKey = serverAPIKey();
  if (!apiKey) throw new Error('OpenAI is not configured (missing OPENAI_API_KEY)');
  return new OpenAI({
    apiKey,
    // Do not inherit SDK routing/billing overrides from unrelated environment settings.
    baseURL: 'https://api.openai.com/v1',
    organization: null,
    project: null,
    dangerouslyAllowBrowser: false,
    // SDK debug logs can contain taxpayer request bodies; route errors are sanitized separately.
    logLevel: 'off',
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
  });
}
