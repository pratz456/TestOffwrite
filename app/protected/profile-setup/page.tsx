"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import { useRouter } from 'next/navigation';
import { getUserProfile } from '@/lib/firebase/profiles';
import { ProfileSetupScreen } from '@/components/profile-setup-screen';
import { Button } from '@/components/ui/button';
import { PROFILE_COMPLETE_URL, profileLookupState } from '@/lib/onboarding/profile';

export default function ProfileSetupPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'existing' | 'missing' | 'error'>('loading');
  const [existingConsents, setExistingConsents] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/auth/login');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    const checkProfile = async () => {
      try {
        const { data, error } = await getUserProfile(user.id);
        if (cancelled) return;
        const next = profileLookupState(data, error);
        // A consent-only document counts as missing but its acknowledgments still stand.
        setExistingConsents(data?.consents ?? null);
        setStatus(next);
        if (next === 'existing') router.replace(PROFILE_COMPLETE_URL);
      } catch {
        if (!cancelled) setStatus('error');
      }
    };
    void checkProfile();
    return () => { cancelled = true; };
  }, [user, loading, router, retry]);

  if (status === 'error' && user) {
    return (
      <main className="min-h-svh flex items-center justify-center bg-background p-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">We couldn&apos;t load your profile</h1>
          <p role="alert" className="text-muted-foreground">Check your connection and try again. Your saved details are safe.</p>
          <Button onClick={() => { setStatus('loading'); setRetry(value => value + 1); }}>Try again</Button>
        </div>
      </main>
    );
  }

  if (loading || !user || status !== 'missing') {
    return (
      <main className="min-h-svh flex items-center justify-center bg-background">
        <p role="status" className="text-muted-foreground">{status === 'existing' ? 'Opening your dashboard…' : 'Loading your profile…'}</p>
      </main>
    );
  }

  return (
    <ProfileSetupScreen
      key={user.id}
      user={user}
      existingConsents={existingConsents}
      onBack={() => router.back()}
      onComplete={() => { setStatus('existing'); router.replace(PROFILE_COMPLETE_URL); }}
    />
  );
}
