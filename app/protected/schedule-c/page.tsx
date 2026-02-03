"use client";

import { useRouter } from 'next/navigation';
import { ScheduleCExportScreen } from '@/components/schedule-c-export-screen';
import { useAuth } from '@/lib/firebase/auth-context';
import { useTransactions } from '@/lib/react-query/hooks';

export default function ScheduleCPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: response, isLoading } = useTransactions(user?.id || '');
  
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
    />
  );
}
