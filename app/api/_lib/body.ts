import { NextResponse } from 'next/server';

/**
 * Reads the JSON object body of a mutating request. An empty, malformed or
 * non-object payload (array, string, null) is a validation failure, so the
 * handler can answer 400 instead of letting the SyntaxError escape as a 500.
 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  let parsed: unknown;
  try { parsed = await request.json(); } catch { return null; }
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
}

export function invalidJsonResponse(error = 'Request body must be a JSON object'): NextResponse {
  return NextResponse.json({ error }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
}
