export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb } from '@/lib/firebase/admin';

function timestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') return value.seconds * 1000;
  return NaN;
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function runningLease(record: { analysisStatus?: string; analysisLeaseToken?: unknown; analysisLeaseExpiresAt?: unknown }, now: number): boolean {
  return record.analysisStatus === 'running' && typeof record.analysisLeaseToken === 'string' && record.analysisLeaseToken.length > 0 &&
    typeof record.analysisLeaseExpiresAt === 'number' && record.analysisLeaseExpiresAt > now && record.analysisLeaseExpiresAt <= now + 240_000;
}

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const accountId = new URL(request.url).searchParams.get('accountId');
    const now = Date.now();
    let terminalJob: { id: string; status?: unknown; lastErrorCode?: unknown } | undefined;

    // Only the versioned, recent durable queue proves background work exists.
    // Legacy running flags can outlive their request process and are not a live heartbeat.
    try {
      const snapshot = await adminDb.collection('analysis_jobs').where('userId', '==', user.uid).get();
      const jobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as { id: string } & Record<string, unknown>))
        .filter(job => job.version === 1 && (!accountId || job.accountId === accountId))
        .sort((a, b) => (timestampMs(b.lastUpdate ?? b.startedAt) || 0) - (timestampMs(a.lastUpdate ?? a.startedAt) || 0));
      const active = jobs.find(job => {
        const age = now - timestampMs(job.lastUpdate ?? job.startedAt);
        return job.status === 'running' && typeof job.batchId === 'string' && job.batchId.length > 0 &&
          count(job.total) > count(job.processed) && Number.isFinite(age) && age >= -60_000 && age < 23 * 60 * 60 * 1000;
      });
      if (active) {
        const total = count(active.total);
        const processed = Math.min(total, count(active.processed));
        const succeeded = Math.min(processed, count(active.succeeded));
        const failed = Math.min(processed - succeeded, count(active.failed));
        const remaining = total - processed;
        return NextResponse.json({ success: true, data: {
          overallStatus: 'analyzing', phase: active.phase ?? 'queued', jobId: active.id,
          progress: { current: succeeded, total, percentage: Math.round(succeeded / total * 100) },
          breakdown: { pending: remaining, running: 0, completed: succeeded, failed, skipped: 0 },
          summary: { totalTransactions: total, analyzedTransactions: succeeded,
            remainingTransactions: remaining, successRate: Math.round(succeeded / total * 100) },
        } }, { headers: { 'cache-control': 'private, no-store' } });
      }
      terminalJob = jobs.find(job => ['done', 'failed', 'canceled'].includes(String(job.status)));
    } catch {
      // Transaction records can still describe results, but a failed job lookup cannot certify active work.
    }

    const { data: allTransactions, error } = await getTransactionsServer(user.uid);
    if (error) return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    const owned = (allTransactions || []).filter(record => !accountId || record.account_id === accountId || record.accountId === accountId);
    const transactions = owned.filter(record => record.pending !== true && Number.isFinite(record.amount));
    const skipped = owned.length - transactions.length;
    let completed = 0;
    let failed = 0;
    let pending = 0;
    const running = transactions.filter(record => runningLease(record, now));
    for (const record of transactions) {
      if (runningLease(record, now)) continue;
      if (record.analysisStatus === 'failed') failed++;
      else if (record.ai_suggestion?.id && (record.analysisStatus === 'completed' || record.analyzed === true)) completed++;
      else pending++; // Waiting for a job or manual review, including expired/unknown legacy running flags.
    }
    const total = transactions.length;
    const percentage = total > 0 ? Math.round(completed / total * 100) : 0;
    const overallStatus = running.length > 0 ? 'analyzing' : total === 0 ? 'no_transactions' :
      failed > 0 || terminalJob?.status === 'failed' ? 'failed' : pending > 0 ? 'needs_analysis' : 'completed';
    const current = running[0];
    return NextResponse.json({ success: true, data: {
      overallStatus,
      progress: { current: completed, total, percentage },
      breakdown: { pending, running: running.length, completed, failed, skipped },
      currentlyAnalyzing: current ? { id: current.id, merchant_name: current.merchant_name || 'Unknown', amount: current.amount, category: current.category } : null,
      ...(terminalJob ? { jobId: terminalJob.id, lastErrorCode: terminalJob.lastErrorCode ?? null } : {}),
      summary: { totalTransactions: total, analyzedTransactions: completed,
        remainingTransactions: pending + running.length, successRate: percentage },
    } }, { headers: { 'cache-control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
