export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { enqueueAccountAnalysis, validAnalysisId } from '@/lib/ai/analysis-jobs';
import { getAIProviderStatus } from '@/lib/ai/provider-status';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';

/**
 * Authenticated catch-up: queues the caller's saved records for one account; importing
 * and model execution are separate jobs. Also the "Retry analysis" action for paused
 * or failed records, so the per-owner window bounds how often a full account is re-read.
 */
export async function POST(request: NextRequest) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(request)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  const body = await request.json().catch(() => null);
  if (!validAnalysisId(body?.accountId)) return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
  if (!getAIProviderStatus().configured) return NextResponse.json({ code: 'AI_UNAVAILABLE', error: 'AI analysis is unavailable. You can review transactions manually.' }, { status: 503 });
  // Checked after the configuration answer so an unavailable provider never spends the owner's retries.
  const limit = await enforceRateLimit({ ...RATE_LIMITS.analysisCatchUp, key: uid });
  if (!limit.allowed) return rateLimitResponse(limit, { error: 'Analysis was retried recently. Please wait a few minutes before retrying again.' });
  try {
    const result = await enqueueAccountAnalysis(uid, body.accountId);
    if (result.status === 'missing') return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    return NextResponse.json({ jobId: result.jobId, queued: result.queued,
      status: result.queued > 0 ? 'queued' : 'idle',
      message: result.queued > 0 ? 'Transactions queued for analysis. Deductions still require your review.' : 'No additional transactions were queued. Review saved records and retry paused work after the service is available.',
    }, { status: 200, headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not queue analysis. Please try again.', code: 'ANALYSIS_QUEUE_UNAVAILABLE' }, { status: 503 });
  }
}
