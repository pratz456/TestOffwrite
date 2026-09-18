import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getAIProviderStatus } from '@/lib/ai/provider-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  const headers = { 'Cache-Control': 'no-store' };
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  return NextResponse.json(getAIProviderStatus(), { headers });
}
