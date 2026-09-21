"use client";

import React from 'react';
import { useJobProgress } from '@/lib/hooks/useJobProgress';
import { analysisJobView } from '@/lib/ai/client-job-progress';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { AnalysisStatusNotice } from '@/components/analysis-status-notice';
import { useRouter } from 'next/navigation';

interface JobProgressProps { accountId: string; onComplete?: () => void }
export function JobProgress({ accountId, onComplete }: JobProgressProps) {
  const { job, error, loading } = useJobProgress(accountId);
  const router = useRouter();
  const view = job ? analysisJobView(job) : null;
  const review = () => {
    if (onComplete) onComplete();
    else router.push(`/protected?screen=review-transactions&accountId=${encodeURIComponent(accountId)}`);
  };
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3" role="status">
      <h3 className="font-semibold">{loading ? 'Checking analysis progress…' : error ? 'Analysis progress unavailable' : view?.title || 'No analysis job found'}</h3>
      <p className="text-sm text-muted-foreground">{error?.message || view?.message || 'You can review saved transactions without waiting for AI.'}</p>
      {job && <>
        <Progress value={job.total ? Math.round(job.processed / job.total * 100) : 0} />
        <p className="text-sm">{job.processed} of {job.total} processed · {job.succeeded} suggestions saved · {job.failed} failed</p>
        {view?.outcome && <AnalysisStatusNotice compact outcome={view.outcome} count={job.failed} accountIds={[accountId]} onReview={review} />}
      </>}
      <Button variant="outline" onClick={review}>Review Transactions</Button>
    </div>
  );
}
