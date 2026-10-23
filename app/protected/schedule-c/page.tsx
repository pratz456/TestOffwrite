"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScheduleCExportScreen } from '@/components/schedule-c-export-screen';
import { useAuth } from '@/lib/firebase/auth-context';
import { useTransactions } from '@/lib/react-query/hooks';
import { readStoredConfirmedRulesVersions } from '@/lib/schedule-c/held-year-client';

export default function ScheduleCPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: response, isLoading } = useTransactions(user?.id || '');
  const [confirmedRulesVersion, setConfirmedRulesVersion] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancel = false;
    readStoredConfirmedRulesVersions().then(versions => {
      if (!cancel) setConfirmedRulesVersion(versions);
    });
    return () => { cancel = true; };
  }, [user?.id]);
  
  // Extract transactions array from API response
  // API returns { success, transactions, data, count } - we need the transactions array
  const transactions = response?.transactions || response?.data || [];

  const handleBack = () => {
    router.push('/protected/reports');
  };

  if (!user) {
    return <div>Loading...</div>;
  }

  if (isLoading) {
    return <div>Loading transactions...</div>;
  }

  return (
    <ScheduleCExportScreen
      user={user as any}
      onBack={handleBack}
      transactions={transactions}
      confirmedRulesVersion={confirmedRulesVersion}
    />
  );
}
