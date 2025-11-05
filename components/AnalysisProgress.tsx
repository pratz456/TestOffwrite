'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase/client'; // v9 modular client
import { doc, onSnapshot } from 'firebase/firestore';

type Job = {
  status?: 'running' | 'completed' | 'failed';
  total?: number;
  processed?: number;
  failed?: number;
  error?: string;
};

export default function AnalysisProgress({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job>({ status: 'running', total: 0, processed: 0, failed: 0 });

  useEffect(() => {
    if (!jobId) return;

    console.log(`📊 [AnalysisProgress] Subscribing to job ${jobId}`);

    const unsub = onSnapshot(doc(db, 'analysis_status', jobId), (snap) => {
      const d = snap.data() as Job | undefined;
      console.log(`📊 [AnalysisProgress] Job update:`, d);

      setJob({
        status: d?.status ?? 'running',
        total: d?.total ?? 0,
        processed: d?.processed ?? 0,
        failed: d?.failed ?? 0,
        error: d?.error,
      });
    }, (error) => {
      console.error('📊 [AnalysisProgress] Subscription error:', error);

      // Handle permission errors gracefully
      if (error.code === 'permission-denied') {
        console.warn('📊 [AnalysisProgress] Permission denied - job may not belong to current user or may not exist');
        setJob({
          status: 'failed',
          total: 0,
          processed: 0,
          failed: 0,
          error: 'Analysis job not accessible. This may be due to authentication or job ownership issues.',
        });
      } else if (error.code === 'unavailable') {
        console.warn('📊 [AnalysisProgress] Service unavailable');
        setJob({
          status: 'failed',
          total: 0,
          processed: 0,
          failed: 0,
          error: 'Analysis service temporarily unavailable. Please try again later.',
        });
      } else {
        console.error('📊 [AnalysisProgress] Unexpected error:', error);
        setJob({
          status: 'failed',
          total: 0,
          processed: 0,
          failed: 0,
          error: 'Analysis progress tracking failed. Please refresh the page.',
        });
      }
    });

    return () => unsub();
  }, [jobId]);

  // Safe progress calculations with guards
  const total = job?.total ?? 0;
  const processed = job?.processed ?? 0;
  const failed = job?.failed ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  const getStatusMessage = () => {
    switch (job?.status) {
      case 'completed':
        return 'Analysis complete';
      case 'failed':
        return 'Analysis failed';
      default:
        return 'Analyzing transactions…';
    }
  };

  const getStatusColor = () => {
    switch (job?.status) {
      case 'completed':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'failed':
        return 'text-destructive';
      default:
        return 'text-primary';
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 rounded-2xl border border-border bg-card shadow-sm">
      <div className="mb-4 text-center">
        <div className={`text-lg font-semibold ${getStatusColor()}`}>
          {getStatusMessage()}
        </div>
        {job?.status === 'failed' && job?.error && (
          <div className="mt-2 text-sm text-destructive">
            Error: {job.error}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="font-medium text-card-foreground">
          {processed} / {total} analyzed
        </div>
        <div className="text-sm font-semibold text-primary">{pct}%</div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-muted rounded-full h-4 overflow-hidden shadow-inner mb-3">
        <div
          className={`h-4 rounded-full transition-all duration-700 ease-out shadow-sm ${
            job?.status === 'failed'
              ? 'bg-gradient-to-r from-red-500 to-red-600'
              : job?.status === 'completed'
              ? 'bg-gradient-to-r from-emerald-500 to-emerald-600'
              : 'bg-gradient-to-r from-blue-500 to-blue-600'
          }`}
          style={{
            width: `${pct}%`
          }}
        />
      </div>

      {/* Failed count */}
      {failed > 0 && (
        <div className="text-center">
          <span className="text-sm text-destructive font-medium">
            {failed} failed
          </span>
        </div>
      )}

      {/* Status indicator */}
      <div className="mt-4 text-center">
        <div className="text-sm text-muted-foreground">
          {job?.status === 'running' && (
            <>
              <div className="inline-block w-3 h-3 bg-blue-500 rounded-full animate-pulse mr-2"></div>
              Processing transactions...
            </>
          )}
          {job?.status === 'completed' && (
            <>
              <div className="inline-block w-3 h-3 bg-emerald-500 rounded-full mr-2"></div>
              All transactions analyzed
            </>
          )}
          {job?.status === 'failed' && (
            <>
              <div className="inline-block w-3 h-3 bg-red-500 rounded-full mr-2"></div>
              Analysis encountered errors
            </>
          )}
        </div>
      </div>
    </div>
  );
}
