export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';
import { isSupportAdmin, recordSupportAccess, supportAdminUids } from '@/lib/support/access';
import { assertRedacted, buildAccountDiagnostics, validSupportUid } from '@/lib/support/account-diagnostics';

const headers = { 'Cache-Control': 'private, no-store' };

/** Unconfigured deployments and non-admin callers see the same 404 as a missing route. */
function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
}

/**
 * GET /api/support/account/[uid]
 * Redacted account diagnostics for support staff. Read-only; never returns
 * tokens, taxpayer identifiers, Stripe secrets or transaction amounts.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  const allowlist = supportAdminUids();
  if (!allowlist.size) return notFound();
  const { user } = await getAuthenticatedUser(request);
  if (!isSupportAdmin(user, allowlist)) return notFound();
  const { uid } = await params;
  if (!validSupportUid(uid)) return NextResponse.json({ error: 'Invalid account identifier' }, { status: 400, headers });
  const limit = await enforceRateLimit({ ...RATE_LIMITS.supportAccountLookup, key: user!.uid });
  if (!limit.allowed) return rateLimitResponse(limit);
  try {
    const diagnostics = await buildAccountDiagnostics(uid);
    assertRedacted(diagnostics);
    await recordSupportAccess({ actorUid: user!.uid, subjectUid: uid, action: 'account-diagnostics' });
    return NextResponse.json({ success: true, diagnostics }, { headers });
  } catch {
    // Database and provider details never reach the response.
    return NextResponse.json({ error: 'Account diagnostics are unavailable. Please retry.' }, { status: 503, headers });
  }
}
