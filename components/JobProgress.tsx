'use client';

import { useJobProgress } from '@/lib/hooks/useJobProgress';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useRouter } from 'next/navigation';
import { CheckCircle } from 'lucide-react';

interface JobProgressProps {
  accountId: string;
  onComplete?: () => void;
}

export function JobProgress({ accountId, onComplete }: JobProgressProps) {
  const { job, error, loading } = useJobProgress(accountId);
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="text-xl font-semibold text-foreground">Setting up analysis...</div>
        <Progress value={0} className="w-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="text-destructive font-semibold">Error loading progress</div>
        <div className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : String(error)}
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="text-muted-foreground">Setting up analysis...</div>
      </div>
    );
  }

  const { processed = 0, total = 0, status, avgMs = 0, succeeded = 0, failed = 0 } = job;
  const pct = job.total ? Math.round((job.processed / job.total) * 100) : 0;

  // ETA calculation: only show if we have at least a few processed items & a nonzero avg
  const remaining = Math.max(job.total - job.processed, 0);
  const etaSec = (job.processed >= 3 && job.avgMs > 0) ? Math.ceil((remaining * job.avgMs) / 1000) : null;

  const getStatusMessage = () => {
    switch (status) {
      case 'running':
        return 'AI Analysis in Progress';
      case 'done':
        return 'Analysis Complete!';
      case 'failed':
        return 'Analysis Failed';
      case 'canceled':
        return 'Analysis Canceled';
      default:
        return 'Analysis Status Unknown';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'done':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'failed':
        return 'text-destructive';
      case 'canceled':
        return 'text-yellow-600 dark:text-yellow-400';
      default:
        return 'text-primary';
    }
  };

  const getProgressColor = () => {
    switch (status) {
      case 'done':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      case 'canceled':
        return 'bg-yellow-500';
      default:
        return 'bg-blue-500';
    }
  };

  return (
    <div className="bg-card rounded-xl p-6 border border-border shadow-lg">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg mb-4">
          {status === 'done' ? (
            <CheckCircle className="w-6 h-6 text-white" />
          ) : (
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          )}
        </div>
        <h3 className="text-xl font-bold text-card-foreground mb-2">{getStatusMessage()}</h3>
        <p className="text-muted-foreground">Processing your transactions with AI</p>
      </div>

      <div className="mb-6">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-medium text-muted-foreground">Progress</span>
          <span className="text-sm font-semibold text-primary">{pct}%</span>
        </div>
        <Progress value={pct} className="h-3" />
        <div className="flex justify-between items-center mt-2">
          <span className="text-sm text-muted-foreground">{job.processed} of {job.total} analyzed</span>
          {etaSec != null && (
            <span className="text-sm text-muted-foreground">~{etaSec}s remaining</span>
          )}
        </div>
      </div>

      {job.status === 'done' && (
        <Button
          onClick={() => {
            if (onComplete) {
              onComplete();
            } else {
              router.push(`/protected/review?accountId=${accountId}`);
            }
          }}
          className="w-full bg-gradient-to-r from-emerald-400 to-green-500 dark:from-emerald-500 dark:to-green-600 hover:from-emerald-500 hover:to-green-600 dark:hover:from-emerald-400 dark:hover:to-green-500 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 shadow-md shadow-green-500/20 dark:shadow-green-500/30 hover:shadow-lg"
        >
          <div className="flex items-center justify-center gap-2">
            <CheckCircle className="w-4 h-4" />
            <span>Review Transactions</span>
          </div>
        </Button>
      )}
    </div>
  );
}
