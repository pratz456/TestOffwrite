/**
 * POST /api/transactions/bulk-confirm
 * Apply the caller's decision about one merchant to their other unreviewed charges
 * from that merchant. Body: `{ merchantKey, decision: 'business' | 'personal',
 * businessPurpose?, category? }`. Returns `{ updated, skipped, truncated,
 * merchantKey, transactionIds }`. At most 200 charges per call; the server stamps
 * every row (`review_status`, `review_source`, `reviewed_at`) itself.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, isSameOriginRequest } from '@/lib/firebase/api-auth';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';
import { BulkConfirmError, bulkConfirmInput, bulkConfirmMerchant } from '@/lib/transactions/bulk-confirm';

const headers = { 'Cache-Control': 'private, no-store' };
const INVALID_BODY = 'Provide the merchant, a business or personal decision and, for business decisions, an optional purpose and category.';

export async function POST(request: NextRequest) {
  // Cookie credentials are sent automatically, so mutations must come from this application.
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Cross-site request rejected' }, { status: 403, headers });
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const parsed = bulkConfirmInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: INVALID_BODY }, { status: 400, headers });
  const limit = await enforceRateLimit({ ...RATE_LIMITS.bulkConfirm, key: user.uid });
  if (!limit.allowed) return rateLimitResponse(limit);
  try {
    const result = await bulkConfirmMerchant(user.uid, parsed.data);
    return NextResponse.json({ success: true, ...result }, { headers });
  } catch (err) {
    if (err instanceof BulkConfirmError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status, headers });
    console.error('[bulk-confirm]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Your decision could not be applied to these charges. Please try again.' }, { status: 500, headers });
  }
}
