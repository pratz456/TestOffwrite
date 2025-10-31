
"use client";

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/firebase/auth-context';

const PlaidScreen = dynamic(() => import('@/components/plaid-screen').then(mod => mod.PlaidScreen), { ssr: false });

export default function PlaidPage() {
  const router = useRouter();
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Please sign in</h1>
          <p className="text-gray-600">You need to be signed in to manage Plaid connections.</p>
        </div>
      </div>
    );
  }

  const handleBack = () => {
    router.back();
  };

  const handleConnect = () => {
    router.push('/protected/plaid-link');
  };

  return <PlaidScreen user={user} onBack={handleBack} onConnect={handleConnect} />;
}
