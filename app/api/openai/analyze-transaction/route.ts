export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

/**
 * DEPRECATED — this route is a legacy alias.
 * All AI analysis now goes through /api/ai/analyze-transaction which uses
 * the full analyzeTransaction engine with heuristics, learning context,
 * profession hints, and OpenAI structured outputs.
 *
 * This handler proxies to the canonical route so any clients still calling
 * the old path keep working without a breaking change.
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  url.pathname = '/api/ai/analyze-transaction';

  const body = await request.text();
  const forwarded = new Request(url.toString(), {
    method: 'POST',
    headers: request.headers,
    body,
  });

  return fetch(forwarded);
}
