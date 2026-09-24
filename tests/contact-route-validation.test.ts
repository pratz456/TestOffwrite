import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const rate = vi.hoisted(() => vi.fn());
vi.mock('../lib/security/rate-limit', () => ({
  anonymousRateLimitKey: () => 'anonymous-test', enforceRateLimit: rate,
  rateLimitResponse: (_limit: unknown, body: unknown) => new Response(JSON.stringify(body), { status: 429 }),
}));
import { POST } from '../app/api/contact/route';

const valid = { name: 'Ada', email: 'ada@example.test', subject: 'Question about exports', category: 'billing', message: 'How do I download my preparer summary?' };

const post = (body: unknown) => POST(new Request('https://writeoff.example.test/api/contact', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
}));

beforeEach(() => { vi.stubEnv('RESEND_API_KEY', 'server-test-key'); rate.mockResolvedValue({ allowed: true }); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'email-test' }), { status: 200 }))); for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('POST /api/contact', () => {
  it('accepts a complete form', async () => {
    const response = await post(valid);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(console.log).not.toHaveBeenCalled();
  });

  it.each([
    ['no body', ''],
    ['malformed JSON', '{'],
    ['an array', [valid]],
    ['a missing field', { ...valid, message: undefined }],
    ['a non-string field', { ...valid, name: 42 }],
    ['a blank name', { ...valid, name: '   ' }],
    ['an invalid email', { ...valid, email: 'not-an-address' }],
    ['a name over 200 characters', { ...valid, name: 'n'.repeat(201) }],
    ['an email over 254 characters', { ...valid, email: `${'e'.repeat(250)}@x.io` }],
    ['a subject over 300 characters', { ...valid, subject: 's'.repeat(301) }],
    ['a category over 64 characters', { ...valid, category: 'c'.repeat(65) }],
    ['a message over 10,000 characters', { ...valid, message: 'm'.repeat(10_001) }],
  ])('refuses %s with 400', async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    const json = await response.json() as { error: string };
    expect(json.error).toMatch(/required/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts fields exactly at their limits', async () => {
    const response = await post({ ...valid, name: 'n'.repeat(200), subject: 's'.repeat(300), category: 'c'.repeat(64), message: 'm'.repeat(10_000) });
    expect(response.status).toBe(200);
  });
});


describe('support delivery', () => {
  it('sends only to the support inbox and excludes unrecognized fields', async () => {
    const response = await post({ ...valid, to: 'attacker@example.test', token: 'private-extra' });
    expect(response.status).toBe(200);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    const mail = JSON.parse(init!.body as string);
    expect(mail.to).toEqual(['writeoffapp@gmail.com']);
    expect(mail.reply_to).toBe(valid.email);
    expect(mail.text).toContain(valid.message);
    expect(init!.body).not.toContain('private-extra');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('does not claim success without a configured mail provider', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const response = await post(valid);
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    expect((await response.json()).error).toContain('could not be sent');
  });
  it.each([401, 429, 500])('reports provider HTTP%s failure without leaking its body', async status => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ secret: 'sensitive-provider-output' }), { status }));
    const response = await post(valid);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('sensitive-provider-output');
  });
  it('handles provider timeouts safely', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('private request details'));
    const response = await post(valid);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private request details');
  });
  it('requires a provider delivery identifier', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}'));
    expect((await post(valid)).status).toBe(503);
  });
  it('limits public submissions before sending', async () => {
    rate.mockResolvedValue({ allowed: false });
    expect((await post(valid)).status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses a stable idempotency key for retries without putting message content in the key', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ id: 'email-test' })));
    await post(valid); await post({ ...valid });
    const headers = vi.mocked(fetch).mock.calls.map(([, init]) => init!.headers as Record<string, string>);
    expect(headers[0]['Idempotency-Key']).toBe(headers[1]['Idempotency-Key']);
    expect(headers[0]['Idempotency-Key']).toMatch(/^contact-[a-f0-9]{64}$/);
  });
});
