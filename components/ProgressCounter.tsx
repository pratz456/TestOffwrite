"use client";

import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';

interface ProgressData {
  completedPages: number;
  totalPages: number;
  answered: Record<string, 'deductible' | 'personal'>;
}

interface ProgressCounterProps {
  userId: string;
  className?: string;
}

export const ProgressCounter: React.FC<ProgressCounterProps> = ({ userId, className = "" }) => {
  const [progress, setProgress] = useState<ProgressData>({
    completedPages: 0,
    totalPages: 0,
    answered: {}
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    // Use the existing user_profiles collection structure that has proper permissions
    const progressRef = doc(db, "user_profiles", userId, "meta", "progress");
    
    const unsubscribe = onSnapshot(progressRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data() as ProgressData;
        setProgress(data);
      } else {
        // Initialize with default values if document doesn't exist
        setProgress({
          completedPages: 0,
          totalPages: 0,
          answered: {}
        });
      }
      setLoading(false);
    }, (error) => {
      console.error('Error listening to progress updates:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userId]);

  if (loading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="h-4 bg-gray-200 rounded w-16"></div>
      </div>
    );
  }

  return (
    <div className={className}>
      <span className="font-medium text-gray-900">
        {progress.completedPages}/{progress.totalPages}
      </span>
    </div>
  );
};
