export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { readOwnedTransactions } from '@/lib/reports/export-records';
import { exportYear, ExportReviewRequiredError } from '@/lib/reports/transaction-export';
import { generatePreparerReport } from '@/lib/reports/preparer-report';

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await requireFeatureAccess(user.uid, 'exports');
  if (denied) return denied;
  let year: number;
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'year')) throw new Error();
    const parsed = exportYear(body.year);
    if (parsed === undefined) throw new Error();
    year = parsed;
  } catch { return NextResponse.json({ error: 'Provide a four-digit report year from 2000 through 2100.' }, { status: 400 }); }
  try {
    const bytes = await generatePreparerReport(await readOwnedTransactions(user.uid), year);
    return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="writeoff-preparer-summary-${year}.pdf"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ExportReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    return NextResponse.json({ error: 'Could not load a complete report. Please retry.' }, { status: 503 });
  }
}
