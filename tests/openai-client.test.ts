import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOpenAIClientOrThrow, getOpenAIModel, hasOpenAIAPIKey } from '@/lib/openai/client';

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', '  synthetic-server-key  ');
  vi.stubEnv('OPENAI_MODEL', undefined);
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
    const client = getOpenAIClientOrThrow({ timeout: 1200, maxRetries: 0 });
    await client.chat.completions.create({ model: getOpenAIModel(), store: false, messages: [{ role: 'user', content: 'synthetic' }] });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    expect(headers.get('authorization')).toBe('Bearer synthetic-server-key');
    expect(headers.has('OpenAI-Organization')).toBe(false);
    expect(headers.has('OpenAI-Project')).toBe(false);
    expect(client.logLevel).toBe('off');
    expect(client.timeout).toBe(1200);
    expect(client.maxRetries).toBe(0);
  });

  it.each([undefined, '', ' \t\n '])('rejects missing or whitespace keys without falling back to public credentials (%j)', key => {
    vi.stubEnv('OPENAI_API_KEY', key);
    vi.stubEnv('NEXT_PUBLIC_OPENAI_API_KEY', 'synthetic-public-fallback');
    expect(hasOpenAIAPIKey()).toBe(false);
    expect(() => getOpenAIClientOrThrow()).toThrow('OpenAI is not configured (missing OPENAI_API_KEY)');
  });

  it('reads the current server secret for each new client, supporting rotation without a cached old key', () => {
    const first = getOpenAIClientOrThrow();
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-rotated-server-key');
    const second = getOpenAIClientOrThrow();
    expect(first.apiKey).toBe('synthetic-server-key');
    expect(second.apiKey).toBe('synthetic-rotated-server-key');
  });

  it('refuses client construction in the browser', () => {
    vi.stubGlobal('window', {});
    expect(() => getOpenAIClientOrThrow()).toThrow('OpenAI is only available on the server');
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
