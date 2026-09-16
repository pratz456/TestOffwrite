export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { generateUserDataExport, generateDataPackage, validateExportData } from '@/lib/reports/data-export';
import { exportYear, ExportReviewRequiredError } from '@/lib/reports/transaction-export';

// Owner data portability remains available on every plan. Throttle completed exports,
// and coalesce in-flight requests so a failed read does not lock out recovery.
const interval = 3600000;
const completed = new Map<string, number>();
const inFlight = new Set<string>();
const headers = { 'Cache-Control': 'private, no-store' };
function remaining(uid: string) {
  for (const [user, time] of completed) if (Date.now() - time >= interval) completed.delete(user);
  const previous = completed.get(uid);
  return previous === undefined ? 0 : Math.max(0, interval - (Date.now() - previous));
}
export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  let year: number | undefined;
  try {
    const text = await request.text();
    const body = text ? JSON.parse(text) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'year')) throw new Error();
    year = exportYear(body.year);
  } catch { return NextResponse.json({ error: 'Provide an optional four-digit year from 2000 through 2100.' }, { status: 400, headers }); }
  // Keep the availability check and acquisition adjacent: body reading yields,
  // so checking before it allows two simultaneous requests through the lock.
  const retry = remaining(user.uid);
  if (retry || inFlight.has(user.uid)) return NextResponse.json({ error: 'Export already requested', message: retry ? 'Please wait before downloading another archive.' : 'Your export is already being prepared.', retryAfter: Math.ceil(retry / 1000) || 5 }, { status: 429, headers });
  inFlight.add(user.uid);
  try {
    const data = await generateUserDataExport(user.uid, year), validation = validateExportData(data);
    if (!validation.isValid) throw new Error('Invalid archive');
    const packaged = generateDataPackage(data);
    completed.set(user.uid, Date.now());
    return NextResponse.json({ success: true, exportId: data.exportInfo.exportId, exportDate: data.exportInfo.exportDate,
      data: packaged, summary: packaged.summary.counts, warnings: validation.warnings }, { headers });
  } catch (error) {
    if (error instanceof ExportReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422, headers });
    return NextResponse.json({ error: 'Export unavailable', message: 'Could not load a complete export. Please retry.' }, { status: 503, headers });
  } finally { inFlight.delete(user.uid); }
}
export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const retry = remaining(user.uid);
  return NextResponse.json({ canExport: !retry && !inFlight.has(user.uid), timeRemaining: Math.ceil(retry / 60000), rateLimitHours: 1 }, { headers });
}
