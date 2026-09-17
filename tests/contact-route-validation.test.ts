/**
 * The public contact form accepts a bounded, well-typed payload and refuses
 * anything else with 400; it performs no I/O and logs nothing outside development.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/contact/route';

const valid = { name: 'Ada', email: 'ada@example.test', subject: 'Question about exports', category: 'billing', message: 'How do I download my preparer summary?' };

const post = (body: unknown) => POST(new Request('https://writeoff.example.test/api/contact', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
}));

beforeEach(() => { for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

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
  });

  it('accepts fields exactly at their limits', async () => {
    const response = await post({ ...valid, name: 'n'.repeat(200), subject: 's'.repeat(300), category: 'c'.repeat(64), message: 'm'.repeat(10_000) });
    expect(response.status).toBe(200);
  });
});
