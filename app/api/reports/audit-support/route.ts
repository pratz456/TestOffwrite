export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { auditSupportPacketCSV, generateAuditSupportPDF, readAuditSupportPacket } from '@/lib/reports/audit-support-packet';
import { exportYear, ExportReviewRequiredError } from '@/lib/reports/transaction-export';

// Audit support records: JSON and CSV stay available to the owner on every plan as part of
// their records exports; the formatted PDF uses the existing Premium reports gate.
const headers = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const FORMATS = ['json', 'csv', 'pdf'] as const;
type Format = typeof FORMATS[number];

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return json({ error: 'Unauthorized' }, 401);
  const params = request.nextUrl.searchParams;
  if ([...params.keys()].some(key => !['year', 'format'].includes(key))) return json({ error: 'Supported parameters are year and format (json, csv or pdf).' }, 400);
  const format = (params.get('format') ?? 'json') as Format;
  if (!FORMATS.includes(format)) return json({ error: 'Choose format json, csv or pdf.' }, 400);
  if (format === 'pdf') { const denied = await requireFeatureAccess(user.uid, 'reports'); if (denied) return denied; }
  let year: number;
  try {
    const parsed = exportYear(params.get('year'));
    if (parsed === undefined) throw new RangeError();
    year = parsed;
  } catch { return json({ error: 'Provide a four-digit tax year from 2000 through 2100.' }, 400); }
  try {
    const packet = await readAuditSupportPacket(user.uid, year);
    if (format === 'json') return json(packet);
    const filename = `writeoff-audit-support-records-${year}.${format}`;
    if (format === 'csv') {
      return new NextResponse(auditSupportPacketCSV(packet), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` } });
    }
    return new NextResponse(Buffer.from(await generateAuditSupportPDF(packet)), { headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` } });
  } catch (error) {
    if (error instanceof ExportReviewRequiredError) return json({ error: error.message, code: error.code }, 422);
    return json({ error: 'Could not load complete records. Please retry.', code: 'EXPORT_DATA_UNAVAILABLE' }, 503);
  }
}
