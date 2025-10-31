"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import { SidebarNav } from './sidebar-nav';
import { MobileNav } from './mobile-nav';
import { TutorialManager } from './tutorial/tutorial-manager';
import { getUserProfile } from '@/lib/firebase/profiles';
import { useRouter } from 'next/navigation';
import { ToastContainer, useToasts } from '@/components/ui/toast';
import { ErrorBoundary } from '@/components/ui/error-boundary';

interface ProtectedLayoutClientProps {
  children: React.ReactNode;
}

export const ProtectedLayoutClient: React.FC<ProtectedLayoutClientProps> = ({ children }) => {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [userProfile, setUserProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [isProfileSetup, setIsProfileSetup] = useState(false);
  const { toasts, removeToast } = useToasts();

  // Fetch user profile on mount
  useEffect(() => {
    const fetchProfile = async () => {
      if (user?.id) {
        try {
          console.log('🔍 [ProtectedLayoutClient] Fetching profile for user:', user.id);
          const { data, error } = await getUserProfile(user.id);
          
          if (error) {
            // Handle specific error cases
            if (error.code === 'PROFILE_NOT_FOUND' || error.message === 'Profile not found') {
              console.log('ℹ️ [ProtectedLayoutClient] User profile not found, this is normal for new users');
              // Set a default profile structure for new users
              setUserProfile({
                id: user.id,
                email: user.email || '',
                name: '',
                profession: '',
                income: '',
                state: '',
                filing_status: '',
                onboardingIntroCompleted: false,
                onboardingPlaidGuideCompleted: false,
              });
              // Mark as profile setup mode
              setIsProfileSetup(true);
            } else {
              console.error('❌ [ProtectedLayoutClient] Error fetching user profile:', {
                error,
                errorType: typeof error,
                errorMessage: error?.message,
                errorCode: error?.code
              });
            }
          } else if (data) {
            console.log('✅ [ProtectedLayoutClient] User profile loaded successfully:', data);
            setUserProfile(data);
            // Not in profile setup mode
            setIsProfileSetup(false);
          } else {
            console.log('ℹ️ [ProtectedLayoutClient] No profile data returned');
          }
        } catch (error) {
          console.error('❌ [ProtectedLayoutClient] Exception in fetchProfile:', error);
        } finally {
          setProfileLoading(false);
        }
      }
    };

    if (user) {
      fetchProfile();
    }
  }, [user]);

  // Handle redirect when user is not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/login');
    }
  }, [user, loading, router]);

  // If loading, show loading state
  if (loading || profileLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
      </div>
    );
  }

  // If no user, show redirecting message (redirect will happen in useEffect)
  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg">Redirecting to login...</div>
      </div>
    );
  }

  const handleProfileUpdate = () => {
    // Refresh the profile data
    if (user?.id) {
      getUserProfile(user.id).then(({ data, error }) => {
        if (!error && data) {
          setUserProfile(data);
        }
      });
    }
  };

  return (
    <>
      {/* Global Toast Container */}
      <ToastContainer toasts={toasts} onClose={removeToast} />
      
      <ErrorBoundary>
        <div className="flex flex-col lg:flex-row h-screen">
          {/* Mobile Navigation */}
          {!isProfileSetup && <MobileNav user={user as any} userProfile={userProfile} />}
          
          {/* Desktop Sidebar Navigation - Only show when not in profile setup mode */}
          {!isProfileSetup && <SidebarNav user={user as any} userProfile={userProfile} />}
          
          {/* Main Content */}
          <main className={`${isProfileSetup ? 'w-full' : 'flex-1'} overflow-auto`}>
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </main>

          {/* Tutorial Manager - Only show when not in profile setup mode */}
          {userProfile && !isProfileSetup && (
            <TutorialManager
              userId={user.id}
              userProfile={userProfile}
              onProfileUpdate={handleProfileUpdate}
              />
            )}
        </div>
      </ErrorBoundary>
    </>
  );
};
