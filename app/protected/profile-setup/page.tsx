"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import { useRouter } from 'next/navigation';
import { getUserProfile } from '@/lib/firebase/profiles';
import { ProfileSetupScreen } from '@/components/profile-setup-screen';

interface UserProfile {
  email: string;
  name: string;
  profession: string;
  income: string;
  state: string;
  filingStatus: string;
  plaidToken?: string;
}

export default function ProfileSetupPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/login');
      return;
    }

    if (!user) {
      return;
    }

    const checkProfile = async () => {
      try {
        const { data: profile, error } = await getUserProfile(user.id);

        if (error) {
          console.error('Error checking profile:', error);
          setHasProfile(false);
        } else if (profile) {
          // User already has a profile, redirect to dashboard
          setHasProfile(true);
          router.push('/protected');
        } else {
          // No profile found, show setup screen
          setHasProfile(false);
        }
      } catch (error) {
        console.error('Error in checkProfile:', error);
        setHasProfile(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkProfile();
  }, [user, loading, router]);

  const handleBack = () => {
    router.back();
  };

  const handleProfileComplete = async (profile: UserProfile, redirectTo?: string) => {
    console.log('Profile setup completed:', profile);
    setHasProfile(true);

    // Redirect to protected page (dashboard) after profile completion
    if (redirectTo) {
      router.push(`/protected?screen=${redirectTo}`);
    } else {
      router.push('/protected');
    }
  };

  if (loading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Please sign in</h1>
          <p className="text-muted-foreground">You need to be signed in to access profile setup.</p>
        </div>
      </div>
    );
  }

  // If user already has a profile, they shouldn't be here (redirect handled in useEffect)
  if (hasProfile === true) {
    return null; // Will redirect in useEffect
  }

  // Show profile setup screen
  return (
    <ProfileSetupScreen
      user={user}
      onBack={handleBack}
      onComplete={handleProfileComplete}
    />
  );
}
