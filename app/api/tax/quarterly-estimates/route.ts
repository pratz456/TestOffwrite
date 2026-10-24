import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { GET as getQuarterlySummary } from '@/app/api/tax/quarterly-reminders/route';
import { readJsonBody } from '@/lib/http/json-body';

/** Legacy entrypoint now uses saved owner records, never client-supplied tax totals. */
export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await readJsonBody(request);
  if (body instanceof NextResponse) return body.status === 413 ? body : NextResponse.json({ error: 'Provide a valid JSON request with a tax year.' }, { status: 400 });
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as { taxYear?: unknown; year?: unknown } : {};
  const year = record.taxYear ?? record.year ?? new Date().getFullYear();
  const url = new URL('/api/tax/quarterly-reminders', request.url);
  url.searchParams.set('year', String(year));
  return getQuarterlySummary(new NextRequest(url, { headers: request.headers }));
}
