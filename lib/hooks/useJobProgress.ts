'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { waitForAuth } from '@/lib/firebase/waitForAuth';

export type Job = {
  status: 'running' | 'done' | 'failed' | 'canceled';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  avgMs?: number;
  startedAt?: any;
  completedAt?: any;
  lastUpdate?: any;
};

// `accountIdOrJobId` may be either an accountId (e.g. 'acct_123') or a
// fully formed jobId 'uid_accountId'. If a full jobId is provided (contains
// an underscore), the hook will subscribe directly to that document. This
// makes the subscription robust to any UID-derived mismatches.
export function useJobProgress(accountIdOrJobId: string) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountIdOrJobId) {
      setLoading(false);
      return;
    }

    let unsub: (() => void) | undefined;

    (async () => {
      try {
        const uid = await waitForAuth(); // gate by auth
        // Determine jobId: if caller supplied a full jobId (contains '_'),
        // use it directly. Otherwise construct deterministic jobId from uid.
        let jobId: string;
        if (accountIdOrJobId && accountIdOrJobId.includes('_')) {
          jobId = accountIdOrJobId;
        } else {
          jobId = `${uid}_${accountIdOrJobId}`;
        }
        console.log(`📊 [useJobProgress] Subscribing to job ${jobId}`);
        
        unsub = onSnapshot(
          doc(db, 'analysis_jobs', jobId),
          (snap) => {
            setLoading(false);
            if (snap.exists()) {
              const data = snap.data() as Job;
              setJob(data);
              console.log(`📊 [useJobProgress] Job update:`, data);
            } else {
              setJob(null);
              console.log(`📊 [useJobProgress] Job not found: ${jobId}`);
            }
          },
          (err) => {
            setLoading(false);
            setError(err);
            console.error('📊 [useJobProgress] Subscription error:', err);
            
            // If it's a permissions error, don't treat it as a fatal error
            if (err.code === 'permission-denied') {
              console.warn('📊 [useJobProgress] Permission denied - user may not be authenticated yet');
              setJob(null);
            }
          }
        );
      } catch (e) {
        setLoading(false);
        setError(e);
        console.error('📊 [useJobProgress] Auth error:', e);
      }
    })();

    return () => {
      if (unsub) {
        console.log(`📊 [useJobProgress] Unsubscribing from job`);
        unsub();
      }
    };
  }, [accountIdOrJobId]);

  return { job, error, loading };
}
