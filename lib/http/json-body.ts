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

/**
 * Read a JSON body up to maxBytes.
 * Content-Length above the limit is refused before the stream is read.
 * The stream is still counted, and reading stops as soon as the total passes the limit.
 */
export async function readJsonBody(request: Request, maxBytes = DEFAULT_JSON_BODY_MAX_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return jsonTooLargeResponse();

  const reader = request.body?.getReader();
  if (!reader) return invalidJsonBodyResponse();

  const chunks: Uint8Array[] = [];
  let size = 0;
  let oversize = false;
  try {
    while (true) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch {
        return invalidJsonBodyResponse();
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
  if (oversize) return jsonTooLargeResponse();

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return invalidJsonBodyResponse();
  }
}
