"use client";

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/lib/firebase/auth-context';
import { parseAnalysisJob, type AnalysisJob } from '@/lib/ai/client-job-progress';

export type Job = AnalysisJob;

/** Callers pass an account ID, including IDs containing underscores. */
export function useJobProgress(accountId: string) {
  const { user, loading: authLoading } = useAuth();
  const key = user?.id && accountId ? `${user.id}_${accountId}` : null;
  const [result, setResult] = useState<{ key: string; job: Job | null; error: Error | null } | null>(null);
  useEffect(() => {
    if (!key || authLoading) return;
    let active = true;
    let unsubscribe = () => {};
    try { unsubscribe = onSnapshot(doc(db, 'analysis_jobs', key), snap => {
      if (!active) return;
      const job = snap.exists() ? parseAnalysisJob(snap.data()) : null;
      setResult({ key, job, error: snap.exists() && !job ? new Error('Analysis progress is incomplete. Please retry.') : null });
    }, () => {
      if (active) setResult({ key, job: null, error: new Error('Could not load analysis progress. You can still review transactions manually.') });
    }); } catch {
      setResult({ key, job: null, error: new Error('Could not load analysis progress. Please check the account and retry.') });
    }
    return () => { active = false; unsubscribe(); };
  }, [key, authLoading]);
  const current = !authLoading && result?.key === key ? result : null;
  return { job: current?.job ?? null, error: current?.error ?? null,
    loading: authLoading || Boolean(key && !current) };
}
