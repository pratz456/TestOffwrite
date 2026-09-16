export interface AnalysisJob {
  status: 'running' | 'done' | 'failed' | 'canceled';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  phase?: string;
  lastErrorCode?: string | null;
}

export function parseAnalysisJob(value: unknown): AnalysisJob | null {
  if (!value || typeof value !== 'object') return null;
  const job = value as AnalysisJob;
  if (!['running', 'done', 'failed', 'canceled'].includes(job.status) ||
      ![job.total, job.processed, job.succeeded, job.failed].every(n => Number.isSafeInteger(n) && n >= 0) ||
      job.processed > job.total || job.succeeded + job.failed !== job.processed) return null;
  return job;
}

/** Processed includes failures. Only an explicit successful terminal job establishes completion. */
export function analysisJobView(job: AnalysisJob) {
  const failed = job.status === 'failed' || job.status === 'canceled' || (job.status === 'done' && job.failed > 0);
  if (failed) return { status: 'error' as const, terminal: true, title: 'Analysis needs attention',
    message: job.lastErrorCode === 'AI_UNAVAILABLE'
      ? 'AI is unavailable. Review records manually, or retry after provider configuration or usage limits are updated.'
      : `${job.succeeded} suggestions saved; ${job.failed} records need review or retry. No failed record is counted as analyzed.` };
  if (job.status === 'done' && job.total > 0 && job.succeeded === job.total) return {
    status: 'completed' as const, terminal: true, title: 'Analysis complete',
    message: `${job.succeeded} suggestions saved. Review their business purpose and supporting records before confirming deductions.` };
  if (job.status === 'done') return { status: 'idle' as const, terminal: true, title: 'No completed analysis to report', message: 'Review your saved records. No successful analysis is confirmed by this job.' };
  if (job.phase === 'queued' && job.processed === 0) return { status: 'queued' as const, terminal: false,
    title: 'Analysis queued', message: `${job.total} records are waiting for analysis. No new suggestions have been saved yet.` };
  return { status: 'analyzing' as const, terminal: false, title: 'Analysis in progress',
    message: `${job.succeeded} suggestions saved; ${job.failed} failed; ${Math.max(0, job.total - job.processed)} remaining.` };
}

export function parseAnalysisQueue(value: unknown): { jobId: string; queued: number; status: 'queued' | 'idle' } | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as { jobId: string; queued: number; status: 'queued' | 'idle' };
  if (typeof data.jobId !== 'string' || !data.jobId || !Number.isSafeInteger(data.queued) || data.queued < 0 ||
      (data.status !== 'queued' && data.status !== 'idle') || (data.status === 'queued') !== (data.queued > 0)) return null;
  return data;
}
