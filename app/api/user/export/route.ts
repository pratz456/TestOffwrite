export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { generateUserDataExport, generateDataPackage, validateExportData } from '@/lib/reports/data-export';
import { exportYear, ExportReviewRequiredError } from '@/lib/reports/transaction-export';
import { enforceRateLimit, peekRateLimit, RATE_LIMITS, rateLimitResponse, refundRateLimit, type RateLimitResult } from '@/lib/security/rate-limit';

// Owner data portability remains available on every plan. One completed archive
// per hour is enforced durably across hosting instances; a failed attempt is
// refunded so a broken read never locks out recovery, while total attempts stay
// bounded. The in-flight set coalesces duplicates on this instance.
const inFlight = new Set<string>();
const headers = { 'Cache-Control': 'private, no-store' };
const exportLimit = (uid: string) => ({ ...RATE_LIMITS.userExport, key: uid });
const busyResponse = () => NextResponse.json({ error: 'Export already requested', code: 'RATE_LIMITED', message: 'Your export is already being prepared.', retryAfter: 5 },
  { status: 429, headers: { ...headers, 'Retry-After': '5' } });
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
  if (inFlight.has(user.uid)) return busyResponse();
  inFlight.add(user.uid);
  let claimed: RateLimitResult | null = null;
  let completed = false;
  try {
    const attempts = await enforceRateLimit({ ...RATE_LIMITS.userExportAttempts, key: user.uid });
    if (!attempts.allowed) return rateLimitResponse(attempts, { error: 'Too many export attempts. Please wait before trying again.' });
    claimed = await enforceRateLimit(exportLimit(user.uid));
    if (!claimed.allowed) return rateLimitResponse(claimed, { error: 'Export already requested. Please wait before downloading another archive.' });
    const data = await generateUserDataExport(user.uid, year), validation = validateExportData(data);
    if (!validation.isValid) throw new Error('Invalid archive');
    const packaged = generateDataPackage(data);
    completed = true;
    return NextResponse.json({ success: true, exportId: data.exportInfo.exportId, exportDate: data.exportInfo.exportDate,
      data: packaged, summary: packaged.summary.counts, warnings: validation.warnings }, { headers });
  } catch (error) {
    if (error instanceof ExportReviewRequiredError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422, headers });
    return NextResponse.json({ error: 'Export unavailable', message: 'Could not load a complete export. Please retry.' }, { status: 503, headers });
  } finally {
    if (claimed?.allowed && !completed) await refundRateLimit(exportLimit(user.uid), claimed);
    inFlight.delete(user.uid);
  }
}
export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  // Status is read-only; if the store is unreachable the POST fails closed instead.
  const status = await peekRateLimit({ ...exportLimit(user.uid), onUnavailable: 'allow' });
  const retrySeconds = status.allowed ? 0 : status.retryAfterSeconds;
  return NextResponse.json({ canExport: status.allowed && !inFlight.has(user.uid), timeRemaining: Math.ceil(retrySeconds / 60), rateLimitHours: 1 }, { headers });
}
