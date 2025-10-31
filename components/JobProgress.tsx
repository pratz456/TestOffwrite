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
        <div className="text-xl font-semibold">Setting up analysis...</div>
        <Progress value={0} className="w-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="text-red-600 font-semibold">Error loading progress</div>
        <div className="text-sm text-gray-600">
          {error instanceof Error ? error.message : String(error)}
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="text-gray-600">Setting up analysis...</div>
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
        return 'text-green-600';
      case 'failed':
        return 'text-red-600';
      case 'canceled':
        return 'text-yellow-600';
      default:
        return 'text-blue-600';
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
    <div className="bg-white/80 backdrop-blur-sm rounded-xl p-6 border border-slate-200 shadow-lg">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg mb-4">
          {status === 'done' ? (
            <CheckCircle className="w-6 h-6 text-white" />
          ) : (
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          )}
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">{getStatusMessage()}</h3>
        <p className="text-slate-600">Processing your transactions with AI</p>
      </div>
      
      <div className="mb-6">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-medium text-slate-600">Progress</span>
          <span className="text-sm font-semibold text-blue-600">{pct}%</span>
        </div>
        <Progress value={pct} className="h-3" />
        <div className="flex justify-between items-center mt-2">
          <span className="text-sm text-slate-600">{job.processed} of {job.total} analyzed</span>
          {etaSec != null && (
            <span className="text-sm text-slate-500">~{etaSec}s remaining</span>
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
          className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl"
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
