"use client";

import React, { Suspense, useEffect, useState, useRef } from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import { SidebarNav } from './sidebar-nav';
import { MobileNav } from './mobile-nav';
import { TutorialManager } from './tutorial/tutorial-manager';
import { getUserProfile, type UserProfile } from '@/lib/firebase/profiles';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ToastContainer, useToasts } from '@/components/ui/toast';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { PremiumFeatureGate } from '@/components/premium-feature-gate';
import { premiumFeatureForLocation } from '@/lib/subscriptions/client-status';
import { Button } from '@/components/ui/button';
import { subscribeToProfileUpdates } from '@/lib/onboarding/profile-events';
import { profileLookupState } from '@/lib/onboarding/profile';
import { ConsentReacknowledgment, consentGateApplies } from '@/components/onboarding/consent-reacknowledgment';

interface ProtectedLayoutClientProps { children: React.ReactNode }

const ProtectedLayoutContent: React.FC<ProtectedLayoutClientProps> = ({ children }) => {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<{
    userId: string; data: UserProfile | null; setup: boolean; error: boolean;
  } | null>(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const { toasts, removeToast } = useToasts();
  const hasRedirected = useRef(false);
  const currentProfile = profile?.userId === user?.id ? profile : null;
  const userProfile = currentProfile?.data ?? null;
  const isProfileSetup = currentProfile?.setup ?? false;
  const screen = searchParams.get('screen');
  const transactionId = searchParams.get('transactionId');
  const mainRef = useRef<HTMLElement>(null);
  const feature = premiumFeatureForLocation(pathname, screen);

  // The app scrolls this pane, not the window. Start each destination at its heading.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pathname, screen, transactionId]);

  useEffect(() => {
    if (!user?.id) return;
    return subscribeToProfileUpdates(user.id, () => setProfileVersion(version => version + 1));
  }, [user?.id]);

  useEffect(() => {
    let current = true;
    if (!user?.id) {
      setProfile(null);
      return;
    }
    const userId = user.id;
    const fetchProfile = async () => {
      try {
        const { data, error } = await getUserProfile(userId);
        if (!current) return;
        // Same decision as the setup pages, so a consent-only document keeps setup mode.
        const state = profileLookupState(data, error);
        const missing = state === 'missing' || error?.message === 'Profile not found';
        setProfile({ userId, data: data ?? null, setup: missing, error: !missing && state === 'error' });
      } catch {
        if (current) setProfile({ userId, data: null, setup: false, error: true });
      }
    };
    void fetchProfile();
    return () => { current = false; };
    // Layouts survive page navigation. Recheck after setup navigates to the app
    // so a previously missing profile no longer hides the account navigation.
    // Keep the current profile displayed while this background read finishes.
  }, [user?.id, profileVersion, pathname, screen]);

  useEffect(() => {
    if (!loading && !user && !hasRedirected.current) {
      hasRedirected.current = true;
      router.replace('/auth/login');
    }
    if (user?.emailVerified === false) {
      hasRedirected.current = true;
      router.replace('/auth/sign-up-success');
    } else if (user) hasRedirected.current = false;
  }, [user, loading, router]);

  if (loading || user?.emailVerified === false || (user && !currentProfile)) {
    return <div role="status" className="flex h-screen items-center justify-center gap-3">
      <div aria-hidden="true" className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      <span>Loading your account…</span>
    </div>;
  }
  if (!user) {
    return <div role="status" className="flex h-screen items-center justify-center">Redirecting to login…</div>;
  }

  // Accounts from before the current terms version confirm the acknowledgments before the app renders.
  // Profile setup collects them itself; a failed profile read never traps the account here; billing and
  // data & privacy controls stay reachable without agreeing.
  const reacknowledge = !isProfileSetup && !currentProfile?.error && !!userProfile && consentGateApplies(pathname, userProfile);
  // Account/billing navigation remains available even when the profile service fails.
  const showNavigation = !reacknowledge && (!isProfileSetup || pathname === '/protected/settings' || pathname === '/protected/subscriptions');
  return (
    <>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <ErrorBoundary>
        <div className="app-workspace flex flex-col lg:flex-row">
          {showNavigation && <MobileNav user={{ ...user, email: user.email ?? undefined }} userProfile={userProfile ?? undefined} />}
          {showNavigation && <SidebarNav user={{ ...user, email: user.email ?? undefined }} userProfile={userProfile ?? undefined} />}
          <main ref={mainRef} className={`${showNavigation ? 'flex-1' : 'w-full'} min-h-0 min-w-0 overflow-auto`}>
            {currentProfile?.error && (
              <div role="alert" className="m-4 rounded-lg border p-4 flex flex-wrap items-center gap-3">
                <p className="text-sm">Your profile could not be loaded. Account and billing remain available.</p>
                <Button size="sm" variant="outline" onClick={() => setProfileVersion((version) => version + 1)}>Retry profile</Button>
              </div>
            )}
            <ErrorBoundary>
              {reacknowledge ? (
                <ConsentReacknowledgment onRecorded={() => setProfileVersion((version) => version + 1)} />
              ) : feature ? (
                <PremiumFeatureGate feature={feature} featureName={feature === 'reports' ? 'reports' : 'report exports'}>
                  {children}
                </PremiumFeatureGate>
              ) : children}
            </ErrorBoundary>
          </main>
          {userProfile && !isProfileSetup && !reacknowledge && (
            <TutorialManager userId={user.id} userProfile={userProfile} onProfileUpdate={() => setProfileVersion((version) => version + 1)} />
          )}
        </div>
      </ErrorBoundary>
    </>
  );
};


export function ProtectedLayoutClient({ children }: ProtectedLayoutClientProps) {
  return <Suspense fallback={<div role="status" className="flex h-screen items-center justify-center">Loading your account…</div>}>
    <ProtectedLayoutContent>{children}</ProtectedLayoutContent>
  </Suspense>;
}
