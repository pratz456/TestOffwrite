"use client";

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/firebase/auth-context';

const PlaidLinkScreen = dynamic(() => import('@/components/plaid-link-screen').then(mod => mod.PlaidLinkScreen), { ssr: false });

export default function PlaidLinkPage() {
  const router = useRouter();
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Please sign in</h1>
          <p className="text-gray-600">You need to be signed in to connect your bank account.</p>
        </div>
      </div>
    );
  }

  const handleBack = () => {
    router.back();
  };

  const handleSuccess = () => {
    router.push('/protected/plaid');
  };

  return <PlaidLinkScreen user={user} onSuccess={handleSuccess} onBack={handleBack} />;
}
