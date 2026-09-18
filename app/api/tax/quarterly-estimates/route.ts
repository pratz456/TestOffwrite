import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { GET as getQuarterlySummary } from '@/app/api/tax/quarterly-reminders/route';

/** Legacy entrypoint now uses saved owner records, never client-supplied tax totals. */
export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Provide a valid JSON request with a tax year.' }, { status: 400 });
  }
  const year = body?.taxYear ?? body?.year ?? new Date().getFullYear();
  const url = new URL('/api/tax/quarterly-reminders', request.url);
  url.searchParams.set('year', String(year));
  return getQuarterlySummary(new NextRequest(url, { headers: request.headers }));
}
