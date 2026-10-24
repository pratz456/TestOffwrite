export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { readOwnedTransactions } from '@/lib/reports/export-records';
import { appendTransactionDateNeeded, convertTransactionsToCSV, exportYear, partitionExportYear, recordedDeductibility, ExportReviewRequiredError } from '@/lib/reports/transaction-export';
import { compareTransactionDates } from '@/lib/transactions/date-order';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await requireFeatureAccess(user.uid, 'exports');
  if (denied) return denied;
  let year: number | undefined;
  const filter = request.nextUrl.searchParams.get('filter') ?? 'all';
  try {
    year = exportYear(request.nextUrl.searchParams.get('year'));
    if (!['all', 'deductible', 'non-deductible', 'unreviewed'].includes(filter)) throw new RangeError('Invalid export filter.');
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid export options' }, { status: 400 }); }
  const limit = await enforceRateLimit({ ...RATE_LIMITS.reportExport, key: user.uid });
  if (!limit.allowed) return rateLimitResponse(limit, { error: 'Too many exports. Please wait a few minutes and try again.' });
  try {
    const owned = await readOwnedTransactions(user.uid);
    const split = year === undefined ? { dated: owned, dateNeeded: [] as typeof owned } : partitionExportYear(owned, year);
    let records = split.dated;
    if (filter === 'deductible') records = records.filter(tx => recordedDeductibility(tx) === true);
    if (filter === 'non-deductible') records = records.filter(tx => recordedDeductibility(tx) === false);
    if (filter === 'unreviewed') records = records.filter(tx => recordedDeductibility(tx) === null);
    records.sort((a, b) => compareTransactionDates(a.date ?? a.datetime, b.date ?? b.datetime, 'asc'));
    const csv = year === undefined ? convertTransactionsToCSV(records) : appendTransactionDateNeeded(convertTransactionsToCSV(records), records, split.dateNeeded);
    return new NextResponse(csv, { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="writeoff-preparer-transactions-${year ?? 'all-years'}-${filter}.csv"`,
      'Cache-Control': 'private, no-store',
    } });
  } catch (error) {
    if (error instanceof ExportReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    return NextResponse.json({ error: 'Could not load a complete export. Please retry.' }, { status: 503 });
  }
}
