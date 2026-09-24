export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { downloadPreparerHandoff } from '@/lib/preparer/handoffs';
import { boundedPreparerBody, preparerFailure, preparerJson, PREPARER_HEADERS } from '@/lib/preparer/http';
import { anonymousRateLimitKey, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit';
import { isTrustedApplicationRequest } from '@/lib/security/request-origin';
export async function POST(request: NextRequest) {
  if (!isTrustedApplicationRequest(request)) return preparerJson({ error: 'Cross-site requests are not allowed.' }, 403);
  const limit = await enforceRateLimit({ scope: 'preparer.download', key: anonymousRateLimitKey(request), limit: 20, windowMs: 10 * 60_000, onUnavailable: 'deny' });
  if (!limit.allowed) return rateLimitResponse(limit, { headers: PREPARER_HEADERS });
  try {
    const body = await boundedPreparerBody(request);
    if (Object.keys(body).some(key => !['id', 'token'].includes(key)) || typeof body.id !== 'string' || typeof body.token !== 'string') return preparerJson({ error: 'This link is unavailable or expired.' }, 404);
    const bundle = await downloadPreparerHandoff(body.id, body.token);
    if (!bundle) return preparerJson({ error: 'This link is unavailable or expired. Ask the owner for a new link.' }, 404);
    return new NextResponse(new Uint8Array(bundle.bytes), { headers: { ...PREPARER_HEADERS, 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${bundle.filename}"`, 'X-Receipt-Issues': String(bundle.receiptIssues) } });
  } catch (error) { return preparerFailure(error); }
}
