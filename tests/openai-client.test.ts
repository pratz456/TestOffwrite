import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const consent = vi.hoisted(() => ({ record: null as Record<string, unknown> | null }));
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: { doc: () => ({ get: async () => ({ exists: !!consent.record, data: () => consent.record }) }) },
}));

import { OPENAI_COMPLETIONS_URL, getOpenAIClientOrThrow, getOpenAIModel, hasOpenAIAPIKey } from '@/lib/openai/client';
import type { ModelPurpose } from '@/lib/openai/consent-contract';

const request = (purpose: ModelPurpose = 'tax_assistant') => ({
  uid: 'synthetic-owner', purpose, requestedAt: new Date('2026-06-01T00:00:00.000Z'),
});
function grant() {
  consent.record = {
    status: 'granted', recordType: 'disclosure', consentDocumentVersion: 'pending-legal-review',
    purposes: ['transaction_analysis', 'document_text', 'document_image', 'statement_autodetect', 'statement_extract', 'statement_receipt', 'tax_assistant', 'account_assistant', 'voice_command'],
    signedAt: new Date('2026-01-01T00:00:00.000Z'), expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  };
}

beforeEach(() => {
  consent.record = null;
  vi.stubEnv('OPENAI_API_KEY', '  synthetic-server-key  ');
  vi.stubEnv('OPENAI_MODEL', undefined);
  grant();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('one server OpenAI credential and routing policy', () => {
  it('sends the server key only to the official endpoint despite ambient SDK overrides', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://unrelated-provider.example/v1');
    vi.stubEnv('OPENAI_ORG_ID', 'unrelated-organization');
    vi.stubEnv('OPENAI_PROJECT_ID', 'unrelated-project');
    vi.stubEnv('OPENAI_LOG', 'debug');
    vi.stubEnv('NEXT_PUBLIC_OPENAI_API_KEY', 'synthetic-public-key-must-not-be-used');
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      id: 'synthetic-response', object: 'chat.completion', created: 1,
      model: 'gpt-4o-mini', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const client = await getOpenAIClientOrThrow({ ...request(), timeout: 1200, maxRetries: 0 });
    await client.chat.completions.create({ model: getOpenAIModel(), store: false, messages: [{ role: 'user', content: 'synthetic' }] });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(String(url)).toBe(OPENAI_COMPLETIONS_URL);
    expect(headers.get('authorization')).toBe('Bearer synthetic-server-key');
    expect(headers.has('OpenAI-Organization')).toBe(false);
    expect(headers.has('OpenAI-Project')).toBe(false);
    expect(client.logLevel).toBe('off');
    expect(client.timeout).toBe(1200);
    expect(client.maxRetries).toBe(0);
  });

  it.each([undefined, '', ' \t\n '])('rejects missing or whitespace keys without falling back to public credentials (%j)', async key => {
    vi.stubEnv('OPENAI_API_KEY', key);
    vi.stubEnv('NEXT_PUBLIC_OPENAI_API_KEY', 'synthetic-public-fallback');
    expect(hasOpenAIAPIKey()).toBe(false);
    await expect(getOpenAIClientOrThrow(request())).rejects.toThrow('OpenAI is not configured (missing OPENAI_API_KEY)');
  });

  it('reads the current server secret for each new client, supporting rotation without a cached old key', async () => {
    const first = await getOpenAIClientOrThrow(request());
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-rotated-server-key');
    const second = await getOpenAIClientOrThrow(request());
    expect(first.apiKey).toBe('synthetic-server-key');
    expect(second.apiKey).toBe('synthetic-rotated-server-key');
  });

  it('refuses client construction in the browser', async () => {
    vi.stubGlobal('window', {});
    await expect(getOpenAIClientOrThrow(request())).rejects.toThrow('OpenAI is only available on the server');
  });

  it.each([
    ['transaction', 'gpt-4.1-mini'], ['voice', 'gpt-4o-mini'],
    ['assistant', 'gpt-4o'], ['document', 'gpt-4o'],
  ] as const)('keeps the %s default unless a nonblank global model override is supplied', (task, fallback) => {
    expect(getOpenAIModel(task)).toBe(fallback);
    vi.stubEnv('OPENAI_MODEL', ' \n ');
    expect(getOpenAIModel(task)).toBe(fallback);
    vi.stubEnv('OPENAI_MODEL', '  selected-server-model  ');
    expect(getOpenAIModel(task)).toBe('selected-server-model');
  });
});
