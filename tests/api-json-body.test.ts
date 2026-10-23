import { describe, expect, it } from 'vitest';
import { NextResponse } from 'next/server';
import { invalidJsonResponse, readJsonObject } from '../app/api/_lib/body';

const post = (body?: string, contentType = 'application/json') =>
  new Request('https://writeoff.example.test/api/anything', { method: 'POST', body, headers: body === undefined ? {} : { 'content-type': contentType } });

describe('readJsonObject', () => {
  it('returns the object for a JSON object body', async () => {
    await expect(readJsonObject(post('{"year":2025,"nested":{"ok":true}}'))).resolves.toEqual({ year: 2025, nested: { ok: true } });
  });

  it.each([
    ['no body', undefined],
    ['empty body', ''],
    ['malformed JSON', '{'],
    ['JSON array', '[1,2]'],
    ['JSON string', '"text"'],
    ['JSON number', '42'],
    ['JSON null', 'null'],
  ])('resolves to null for %s instead of throwing', async (_label, body) => {
    await expect(readJsonObject(post(body))).resolves.toBeNull();
  });

  it('does not depend on the content-type header', async () => {
    await expect(readJsonObject(post('{"a":1}', 'text/plain'))).resolves.toEqual({ a: 1 });
  });

  it('returns 413 when the body is over the size limit', async () => {
    const result = await readJsonObject(post('x'.repeat(70 * 1024)));
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(413);
    await expect((result as NextResponse).json()).resolves.toEqual({ error: 'Request body is too large' });
  });
});

describe('invalidJsonResponse', () => {
  it('answers 400 with a JSON body that is not cached', async () => {
    const response = invalidJsonResponse();
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Request body must be a JSON object' });
  });

  it('accepts a route-specific message', async () => {
    await expect(invalidJsonResponse('Provide a year').json()).resolves.toEqual({ error: 'Provide a year' });
  });
});
