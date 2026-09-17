import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { readTaxExportTransactions } from '@/lib/reports/tax-export-transactions';
import { ExportReviewRequiredError } from '@/lib/reports/transaction-export';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { adminDb } from '@/lib/firebase/admin';
import { maskOrganizerIdentifier } from '@/lib/tax-organizer/identifiers';
import { readOrganizerDocument } from '@/lib/tax-organizer/organizer-server';
import { reconcileBusinessIncome, IncomeReconciliationRequiredError } from '@/lib/tax-rules/business-income';
import { getFederalTaxRules, SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { generateScheduleCPlanningPDF } from '@/lib/reports/schedule-c-pdf';
import { readIncomeReconciliationDecisions } from '@/lib/firebase/income-reconciliations-server';
import { incomeReconciliationReviewBody } from '@/lib/tax-rules/income-reconciliation-response';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await requireFeatureAccess(user.uid, 'exports');
  if (denied) return denied;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const year = typeof body?.year === 'number' || typeof body?.year === 'string' && /^\d{4}$/.test(body.year) ? Number(body.year) : NaN;
  try { getFederalTaxRules(year); } catch { return NextResponse.json({ error: `Supported tax years: ${SUPPORTED_TAX_YEARS.join(', ')}` }, { status: 400 }); }
  if (body.format !== undefined && body.format !== 'csv' && body.format !== 'pdf') return NextResponse.json({ error: 'format must be csv or pdf' }, { status: 400 });
  if (body.includeAppendix !== undefined && typeof body.includeAppendix !== 'boolean') return NextResponse.json({ error: 'includeAppendix must be true or false' }, { status: 400 });
  const limit = await enforceRateLimit({ ...RATE_LIMITS.reportExport, key: user.uid });
  if (!limit.allowed) return rateLimitResponse(limit, { error: 'Too many report downloads. Please wait a few minutes and try again.' });
  try {
    const query = (name: string) => adminDb.collection(name).where('userId', '==', user.uid).where('taxYear', '==', year);
    const [tx, profile, orgSnap, gross, forms, decisions] = await Promise.all([
      readTaxExportTransactions(user.uid, year), getUserProfileServer(user.uid), query('tax_organizers').limit(1).get(),
      query('gross_receipts').get(), query('income_1099').get(), readIncomeReconciliationDecisions(user.uid, year),
    ]);
    if (profile.error) return NextResponse.json({ error: 'Could not load all export records. Please retry.' }, { status: 503 });
    const transactions = tx;
    const receipts = reconcileBusinessIncome(year, transactions.map(row => ({ ...row })), gross.docs.map(doc => ({ ...doc.data(), id: doc.id })), forms.docs.map(doc => ({ ...doc.data(), id: doc.id })), decisions);
    const aggregate = aggregateScheduleC(transactions, String(year), CATEGORY_MAP, { mode: 'confirmed-only' });
    if (body.format === 'csv') return new NextResponse(generateScheduleCCSV(aggregate.lineItemsArray, year), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="Schedule_C_${year}_WriteOff.csv"`, 'Cache-Control': 'private, no-store' },
    });
    // Identifiers are decrypted only to derive the masked (last 4) display values printed below.
    const org = orgSnap.empty ? {} : await readOrganizerDocument(orgSnap.docs[0]);
    const bytes = await generateScheduleCPlanningPDF({ taxYear: year, grossReceipts: receipts.grossReceipts, lineItems: aggregate.lineItemsArray,
      name: profile.data?.name, ssn: maskOrganizerIdentifier('ssn', org.taxpayerSSN),
      profession: Array.isArray(profile.data?.profession) ? profile.data.profession.join(', ') : profile.data?.profession,
      naicsCode: profile.data?.naics_code, ein: maskOrganizerIdentifier('ein', profile.data?.ein), includeAppendix: body.includeAppendix !== false });
    return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Schedule_C_${year}_WriteOff.pdf"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof IncomeReconciliationRequiredError) return NextResponse.json(incomeReconciliationReviewBody(error, year), { status: 422 });
    if (error instanceof ExportReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    return NextResponse.json({ error: 'Could not create the Schedule C preparer summary. Please retry.' }, { status: 503 });
  }
}
