import OpenAI from 'openai';
import { enforceModelGate, OpenAINotConfiguredError, type ModelPurpose } from './consent';

export type OpenAITask = 'transaction' | 'assistant' | 'voice' | 'document';
export interface OpenAIRequestPolicy { timeout?: number; maxRetries?: number }

export interface OpenAIClientRequest extends OpenAIRequestPolicy {
  uid: string;
  purpose: ModelPurpose;
  requestedAt: Date;
}

const DEFAULT_MODELS: Record<OpenAITask, string> = {
  // Live evaluation 2026-09-17 (docs/AI_LIVE_EVAL_2026-09-17_round2.md): gpt-4.1-mini approved 23/26 approvable
  // descriptors with zero provider failures at $0.0011 per transaction; gpt-4o-mini approved 5/26.
  transaction: 'gpt-4.1-mini',
  assistant: 'gpt-4o',
  voice: 'gpt-4o-mini',
  document: 'gpt-4o',
};

/** Pinned official endpoint. Tests import this so they do not repeat the host. */
export const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
export const OPENAI_COMPLETIONS_URL = `${OPENAI_API_BASE_URL}/chat/completions`;

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

export async function getOpenAIClientOrThrow(request: OpenAIClientRequest): Promise<OpenAI> {
  if (typeof window !== 'undefined') throw new Error('OpenAI is only available on the server');
  await enforceModelGate(request.uid, request.purpose, request.requestedAt);
  if (request.purpose === 'transaction_analysis' && process.env.AI_ANALYSIS_ENABLED === 'false') {
    throw new OpenAINotConfiguredError();
  }
  const apiKey = serverAPIKey();
  if (!apiKey) throw new OpenAINotConfiguredError();
  return new OpenAI({
    apiKey,
    // Do not inherit SDK routing/billing overrides from unrelated environment settings.
    baseURL: OPENAI_API_BASE_URL,
    organization: null,
    project: null,
    dangerouslyAllowBrowser: false,
    // SDK debug logs can contain taxpayer request bodies; route errors are sanitized separately.
    logLevel: 'off',
    ...(request.timeout === undefined ? {} : { timeout: request.timeout }),
    ...(request.maxRetries === undefined ? {} : { maxRetries: request.maxRetries }),
  });
}
