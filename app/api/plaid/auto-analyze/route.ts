export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { enqueueAccountAnalysis, validAnalysisId } from '@/lib/ai/analysis-jobs';
import { getAIProviderStatus } from '@/lib/ai/provider-status';

/** Authenticated catch-up queues saved records; importing and model execution are separate jobs. */
export async function POST(request: NextRequest) {
  let uid: string;
  try { ({ uid } = await getUserFromReqOrThrow(request)); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  const body = await request.json().catch(() => null);
  if (!validAnalysisId(body?.accountId)) return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
  if (!getAIProviderStatus().configured) return NextResponse.json({ code: 'AI_UNAVAILABLE', error: 'AI analysis is unavailable. You can review transactions manually.' }, { status: 503 });
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
