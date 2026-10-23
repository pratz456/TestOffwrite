import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/http/json-body';

/**
 * Reads the JSON object body of a mutating request. An empty, malformed or
 * non-object payload (array, string, null) is a validation failure, so the
 * handler can answer 400 instead of letting the SyntaxError escape as a 500.
 * A body over the size limit is returned as a 413 response.
 */
export async function readJsonObject(request: Request, maxBytes?: number): Promise<Record<string, unknown> | NextResponse | null> {
  const parsed = await readJsonBody(request, maxBytes);
  if (parsed instanceof NextResponse) return parsed.status === 413 ? parsed : null;
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
}

export function invalidJsonResponse(error = 'Request body must be a JSON object'): NextResponse {
  return NextResponse.json({ error }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
}
