import { doc, onSnapshot, Unsubscribe, query, collection, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from './client';
import { useState, useEffect } from 'react';

/**
 * Subscribe to analysis status updates
 * @param jobId - The analysis job ID
 * @param onUpdate - Callback function for status updates
 * @returns Unsubscribe function
 */
export function subscribeToAnalysisStatus(
  jobId: string,
  onUpdate: (data: {
    completed: number;
    total: number;
    status: string;
    finished_at?: any;
  }) => void
): Unsubscribe {
  const docRef = doc(db, 'analysis_status', jobId);
  
  return onSnapshot(docRef, (snap) => {
    const d = snap.data();
    if (d) {
      // d.userId must equal current uid per rules
      onUpdate({
        completed: d?.completed ?? 0,
        total: d?.total ?? 0,
        status: d?.status ?? 'unknown',
        finished_at: d?.finished_at
      });
    }
  }, (error) => {
    console.error('Error subscribing to analysis status:', error);
  });
}

/**
 * React hook example for analysis status subscription
 * (This would go in a custom hook file)
 */
export function useAnalysisStatus(jobId: string | null) {
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('unknown');
  
  useEffect(() => {
    if (!jobId) return;
    
    const unsubscribe = subscribeToAnalysisStatus(jobId, (data) => {
      setCompleted(data.completed);
      setTotal(data.total);
      setStatus(data.status);
    });
    
    return unsubscribe;
  }, [jobId]);
  
  return { completed, total, status };
}

/**
 * Get the latest active analysis job for a user
 * @param uid - User ID
 * @returns Promise with latest job data or null
 */
export async function getLatestActiveJob(uid: string) {
  try {
    const q = query(
      collection(db, 'analysis_status'),
      where('userId', '==', uid),
      orderBy('created_at', 'desc'),
      limit(1)
    );
    
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      return null;
    }
    
    const doc = snapshot.docs[0];
    return {
      jobId: doc.id,
      ...doc.data()
    };
  } catch (error) {
    console.error('Error getting latest active job:', error);
    return null;
  }
}

/**
 * Subscribe to the latest active analysis job for a user
 * @param uid - User ID
 * @param onUpdate - Callback function for job updates
 * @returns Unsubscribe function
 */
export function subscribeToLatestActiveJob(
  uid: string,
  onUpdate: (job: {
    jobId: string;
    completed: number;
    total: number;
    status: string;
    created_at: any;
    finished_at?: any;
  } | null) => void
): Unsubscribe {
  const q = query(
    collection(db, 'analysis_status'),
    where('userId', '==', uid),
    orderBy('created_at', 'desc'),
    limit(1)
  );
  
  return onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      onUpdate(null);
      return;
    }
    
    const doc = snapshot.docs[0];
    const data = doc.data();
    
    onUpdate({
      jobId: doc.id,
      completed: data?.completed ?? 0,
      total: data?.total ?? 0,
      status: data?.status ?? 'unknown',
      created_at: data?.created_at,
      finished_at: data?.finished_at
    });
  }, (error) => {
    console.error('Error subscribing to latest active job:', error);
    onUpdate(null);
  });
}
