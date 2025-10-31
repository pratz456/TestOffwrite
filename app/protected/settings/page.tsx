
"use client";

import React, { useState } from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import { useRouter } from 'next/navigation';
import { SettingsScreen } from '@/components/settings-screen';

export default function SettingsPage() {
  const { user } = useAuth();
  const router = useRouter();

  const handleBack = () => {
    router.back();
  };

  // Always use router.push for navigation in this context
  const handleNavigate = (screen: string) => {
    if (screen === 'dashboard') {
      router.push('/protected');
    } else if (screen === 'plaid-link') {
      router.push('/protected/plaid-link');
    } else if (screen === 'plaid') {
      router.push('/protected/plaid');
    }
  };

  if (!user) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Please sign in</h1>
          <p className="text-gray-600">You need to be signed in to access settings.</p>
        </div>
      </div>
    );
  }

  // Fix: normalize email to undefined if null for SettingsScreen prop
  const safeUser = {
    ...user,
    email: user.email ?? undefined,
  };
  return (
    <SettingsScreen
      user={safeUser}
      onBack={handleBack}
      onNavigate={handleNavigate}
    />
  );
}
