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
import { decideScheduleCExport, scheduleCNow, shouldHoldYear } from '@/lib/schedule-c/filed-year';
import { awaitExportStep, confirmTaxYear, loadFiledYearState, recordServedExport, sha256Hex, startExportDeadline } from '@/lib/schedule-c/export-record';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { generateScheduleCPlanningPDF } from '@/lib/reports/schedule-c-pdf';
import { readIncomeReconciliationDecisions } from '@/lib/firebase/income-reconciliations-server';
import { incomeReconciliationReviewBody } from '@/lib/tax-rules/income-reconciliation-response';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export { confirmTaxYear };

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
    const deadline = startExportDeadline();
    const query = (name: string) => adminDb.collection(name).where('userId', '==', user.uid).where('taxYear', '==', year);
    const [tx, profile, orgSnap, gross, forms, decisions] = await awaitExportStep(Promise.all([
      readTaxExportTransactions(user.uid, year), getUserProfileServer(user.uid), query('tax_organizers').limit(1).get(),
      query('gross_receipts').get(), query('income_1099').get(), readIncomeReconciliationDecisions(user.uid, year),
    ]), deadline);
    if (profile.error) return NextResponse.json({ error: 'Could not load all export records. Please retry.' }, { status: 503 });
    const transactions = tx;
    const receipts = reconcileBusinessIncome(year, transactions.map(row => ({ ...row })), gross.docs.map(doc => ({ ...doc.data(), id: doc.id })), forms.docs.map(doc => ({ ...doc.data(), id: doc.id })), decisions);
    const filed = await loadFiledYearState(user.uid, year, deadline);
    // A failed read for a year that can be held must not fall through to v0 numbers or a new record.
    if (filed.readFailed && shouldHoldYear(user.uid, year)) {
      return NextResponse.json({ error: 'Could not create the Schedule C preparer summary. Please retry.' }, { status: 503 });
    }
    const decision = decideScheduleCExport({ uid: user.uid, year, transactions, prior: filed.stored, confirmedRulesVersion: filed.confirmedRulesVersion });
    const generatedAt = scheduleCNow();
    const render = { contribution: decision.contribution, comparison: decision.comparison, generatedAt };
    const recordBase = { uid: user.uid, taxYear: year, exportedAt: generatedAt.toISOString(), ...decision.snapshot };
    if (body.format === 'csv') {
      const csv = generateScheduleCCSV(decision.lineItems, year, render);
      await recordServedExport({ ...recordBase, kind: 'schedule-c-csv', sha256: sha256Hex(csv) }, deadline);
      return new NextResponse(csv, {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="Schedule_C_${year}_WriteOff.csv"`, 'Cache-Control': 'private, no-store' },
      });
    }
    // Identifiers are decrypted only to derive the masked (last 4) display values printed below.
    let org: Awaited<ReturnType<typeof readOrganizerDocument>> = {};
    if (!orgSnap.empty) {
      try {
        org = await awaitExportStep(readOrganizerDocument(orgSnap.docs[0]), deadline);
      } catch {
        console.error('Schedule C organizer could not be read');
      }
    }
    const bytes = await awaitExportStep(generateScheduleCPlanningPDF({ taxYear: year, grossReceipts: receipts.grossReceipts, lineItems: decision.lineItems,
      name: profile.data?.name, ssn: maskOrganizerIdentifier('ssn', org.taxpayerSSN),
      profession: Array.isArray(profile.data?.profession) ? profile.data.profession.join(', ') : profile.data?.profession,
      naicsCode: profile.data?.naics_code, ein: maskOrganizerIdentifier('ein', profile.data?.ein), includeAppendix: body.includeAppendix !== false, ...render }), deadline);
    await recordServedExport({ ...recordBase, kind: 'schedule-c-pdf', sha256: sha256Hex(bytes) }, deadline);
    return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Schedule_C_${year}_WriteOff.pdf"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof IncomeReconciliationRequiredError) return NextResponse.json(incomeReconciliationReviewBody(error, year), { status: 422 });
    if (error instanceof ExportReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    console.error('Schedule C export file was not built', error);
    return NextResponse.json({ error: 'Could not create the Schedule C preparer summary. Please retry.' }, { status: 503 });
  }
}
