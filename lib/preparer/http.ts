import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
import { isTrustedApplicationRequest } from '@/lib/security/request-origin';
import { enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit';
import { PreparerPackageError } from '@/lib/reports/preparer-package';
import { ExportReviewRequiredError } from '@/lib/reports/transaction-export';

export const PREPARER_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive', Vary: 'Cookie, Authorization' };
export const preparerJson = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: PREPARER_HEADERS });
export async function preparerOwner(request: NextRequest, options: { mutation?: boolean; premium?: boolean; costly?: boolean } = {}) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return { denied: preparerJson({ error: 'Unauthorized' }, 401), uid: null };
  if (options.mutation && !isTrustedApplicationRequest(request)) return { denied: preparerJson({ error: 'Cross-site requests are not allowed.' }, 403), uid: null };
  if (options.premium !== false) { const denied = await requireFeatureAccess(user.uid, 'exports'); if (denied) { for (const [key, value] of Object.entries(PREPARER_HEADERS)) denied.headers.set(key, value); return { denied, uid: null }; } }
  const limit = await enforceRateLimit({ scope: options.costly ? 'preparer.create' : 'preparer.manage', key: user.uid,
    limit: options.costly ? 6 : 60, windowMs: 60 * 60_000, onUnavailable: 'deny' });
  if (!limit.allowed) return { denied: rateLimitResponse(limit, { headers: PREPARER_HEADERS }), uid: null };
  return { uid: user.uid, denied: null };
}
export async function boundedPreparerBody(request: NextRequest) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new PreparerPackageError('JSON is required.', 'HANDOFF_INVALID', 400);
  if (Number(request.headers.get('content-length')) > 2048) throw new PreparerPackageError('Request is too large.', 'HANDOFF_INVALID', 413);
  const reader = request.body?.getReader(); if (!reader) throw new PreparerPackageError('Request data is required.', 'HANDOFF_INVALID', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2048) { await reader.cancel(); throw new PreparerPackageError('Request is too large.', 'HANDOFF_INVALID', 413); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body as Record<string, unknown>; }
  catch { throw new PreparerPackageError('Invalid request data.', 'HANDOFF_INVALID', 400); }
}
export function preparerFailure(error: unknown) {
  if (error instanceof PreparerPackageError) return preparerJson({ error: error.message, code: error.code }, error.status);
  if (error instanceof ExportReviewRequiredError) return preparerJson({ error: error.message, code: error.code }, 422);
  if (error instanceof RangeError) return preparerJson({ error: 'Provide a four-digit tax year from 2000 through 2100.', code: 'HANDOFF_INVALID' }, 400);
  return preparerJson({ error: 'The complete package could not be prepared. Please retry.', code: 'PREPARER_PACKAGE_UNAVAILABLE' }, 503);
}
