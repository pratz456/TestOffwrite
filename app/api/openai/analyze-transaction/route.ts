/**
 * DEPRECATED — use /api/ai/analyze-transaction instead.
 * Kept for backward compatibility with older clients.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Forward to the canonical route
  const url = new URL('/api/ai/analyze-transaction', request.url);
  return fetch(url.toString(), { method: 'POST', headers: request.headers, body: request.body });
}
