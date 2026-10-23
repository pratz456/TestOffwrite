import { describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { DEFAULT_JSON_BODY_MAX_BYTES, readJsonBody } from '../lib/http/json-body';

const post = (body: BodyInit, headers?: HeadersInit) =>
  new Request('http://localhost/api/example', { method: 'POST', body, headers });

/** Vitest reads source maps through JSON.parse while a spy is installed. */
function parsedBodies(parse: { mock: { calls: unknown[][] } }): string[] {
  return parse.mock.calls
    .map((call) => (typeof call[0] === 'string' ? call[0] : ''))
    .filter((text) => text.length > 0 && !text.includes('"mappings"'));
}

describe('readJsonBody', () => {
  it('returns 413 for a declared size over the limit without parsing JSON', async () => {
    const parse = vi.spyOn(JSON, 'parse');
    parse.mockClear();
    const body = 'x'.repeat(1024 * 1024);
    const request = post(body, { 'content-type': 'application/json', 'content-length': String(body.length) });
    expect(Number(request.headers.get('content-length'))).toBeGreaterThan(DEFAULT_JSON_BODY_MAX_BYTES);
    const result = await readJsonBody(request);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(413);
    expect(parsedBodies(parse)).toEqual([]);
    parse.mockRestore();
    await expect((result as NextResponse).json()).resolves.toEqual({ error: 'Request body is too large' });
  });

  it('returns 413 when the declared size is smaller than the stream', async () => {
    const parse = vi.spyOn(JSON, 'parse');
    parse.mockClear();
    const request = post('x'.repeat(DEFAULT_JSON_BODY_MAX_BYTES + 1), { 'content-length': '1' });
    const result = await readJsonBody(request);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(413);
    expect(parsedBodies(parse)).toEqual([]);
    parse.mockRestore();
  });

  it('stops reading a chunked body with no declared size once the limit is passed', async () => {
    const chunkSize = 20 * 1024;
    const chunksToPassLimit = Math.floor(DEFAULT_JSON_BODY_MAX_BYTES / chunkSize) + 1;
    const availableChunks = chunksToPassLimit + 25;
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > availableChunks) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(chunkSize));
      },
    });
    const request = new Request('http://localhost/api/example', {
      method: 'POST', body: stream, duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('content-length')).toBeNull();
    const parse = vi.spyOn(JSON, 'parse');
    parse.mockClear();
    const result = await readJsonBody(request);
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(413);
    expect(pulled).toBe(chunksToPassLimit);
    expect(parsedBodies(parse)).toEqual([]);
    parse.mockRestore();
  });

  it('returns the parsed value for a normal body', async () => {
    await expect(readJsonBody(post(JSON.stringify({ year: 2026, note: 'office' })))).resolves.toEqual({ year: 2026, note: 'office' });
  });

  it('returns 400 when the body is not JSON', async () => {
    const result = await readJsonBody(post('{'));
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(400);
    await expect((result as NextResponse).json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });
});
