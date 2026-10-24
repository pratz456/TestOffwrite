import { NextResponse } from 'next/server';

/** Default cap for a JSON request body. */
export const DEFAULT_JSON_BODY_MAX_BYTES = 64 * 1024;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export function jsonTooLargeResponse(): NextResponse {
  return NextResponse.json({ error: 'Request body is too large' }, { status: 413, headers: NO_STORE });
}

export function invalidJsonBodyResponse(error = 'Invalid JSON body'): NextResponse {
  return NextResponse.json({ error }, { status: 400, headers: NO_STORE });
}

/** Cap for a provider webhook body. */
export const WEBHOOK_TEXT_MAX_BYTES = 1024 * 1024;

type CollectedBody = { kind: 'missing' | 'unreadable' | 'too-large' } | { kind: 'text'; text: string };

/**
 * Read request bytes up to maxBytes.
 * A declared Content-Length above the limit is refused before the stream is read.
 * The stream is still counted, and reading stops as soon as the total passes the limit.
 */
async function collectBody(request: Request, maxBytes: number): Promise<CollectedBody> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { kind: 'too-large' };

  const reader = request.body?.getReader();
  if (!reader) return { kind: 'missing' };

  const chunks: Uint8Array[] = [];
  let size = 0;
  let oversize = false;
  let unreadable = false;
  try {
    while (true) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch {
        unreadable = true;
        break;
      }
      const { value, done } = next;
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        oversize = true;
        break;
      }
      chunks.push(value);
    }
  } finally {
    if (oversize) {
      try { await reader.cancel(); } catch { /* The producer may already be closed. */ }
    }
    try { reader.releaseLock(); } catch { /* Cancel can release the lock first. */ }
  }
  if (oversize) return { kind: 'too-large' };
  if (unreadable) return { kind: 'unreadable' };
  return { kind: 'text', text: Buffer.concat(chunks).toString('utf8') };
}

/**
 * Read a JSON body up to maxBytes.
 * Content-Length above the limit is refused before the stream is read.
 * The stream is still counted, and reading stops as soon as the total passes the limit.
 */
export async function readJsonBody(request: Request, maxBytes = DEFAULT_JSON_BODY_MAX_BYTES): Promise<unknown> {
  const collected = await collectBody(request, maxBytes);
  if (collected.kind === 'too-large') return jsonTooLargeResponse();
  if (collected.kind !== 'text') return invalidJsonBodyResponse();
  try {
    return JSON.parse(collected.text);
  } catch {
    return invalidJsonBodyResponse();
  }
}

/** Read request text up to maxBytes. The returned string is the exact decoded body. */
export async function readTextBody(request: Request, maxBytes: number): Promise<string | NextResponse> {
  const collected = await collectBody(request, maxBytes);
  if (collected.kind === 'too-large') return jsonTooLargeResponse();
  if (collected.kind !== 'text') return '';
  return collected.text;
}
