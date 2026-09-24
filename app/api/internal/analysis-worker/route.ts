import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enqueueBankTransactionAnalysis, processAnalysisTask, validAnalysisId } from '@/lib/ai/analysis-jobs';

import { enqueueProfileAnalysisRefresh, processProfileAnalysisRefresh } from '@/lib/ai/profile-analysis-refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const id = z.string().refine(validAnalysisId);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('enqueue'), userId: id, accountId: id, transactionId: id }).strict(),
  z.object({ action: z.literal('enqueue-profile-refresh'), userId: id }).strict(),
  z.object({ action: z.literal('process-profile-refresh'), userId: id, generation: id }).strict(),
  z.object({ action: z.literal('process'), taskId: z.string().regex(/^[a-f0-9]{64}$/), generation: id }).strict(),
]);

export async function POST(request: NextRequest) {
  const expected = process.env.ANALYSIS_WORKER_SECRET?.trim();
  const provided = request.headers.get('x-analysis-worker-secret') || '';
  // A caller without a credential learns nothing about the deployment's configuration.
  if (!provided) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  if (!expected || expected.length < 32) return NextResponse.json({ code: 'WORKER_UNAVAILABLE' }, { status: 503 });
  const hash = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(hash(provided), hash(expected))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid work request' }, { status: 400 });
  try {
    if (parsed.data.action === 'enqueue') {
      const { userId, accountId, transactionId } = parsed.data;
      const result = await enqueueBankTransactionAnalysis({ userId, accountId, transactionId });
      return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
    }
    if (parsed.data.action === 'enqueue-profile-refresh') {
      return NextResponse.json(await enqueueProfileAnalysisRefresh(parsed.data.userId), { headers: { 'cache-control': 'no-store' } });
    }
    if (parsed.data.action === 'process-profile-refresh') {
      const result = await processProfileAnalysisRefresh(parsed.data.userId, parsed.data.generation);
      return NextResponse.json(result, { status: result.retry ? 503 : 200, headers: { 'cache-control': 'no-store' } });
    }
    const result = await processAnalysisTask(parsed.data.taskId, parsed.data.generation);
    return NextResponse.json(result, { status: result.retry ? 503 : 200, headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ code: 'WORKER_RETRY_REQUIRED' }, { status: 503 });
  }
}
