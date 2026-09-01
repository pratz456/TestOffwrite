"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, CheckCircle } from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { resendEmailVerification, getCurrentUser, checkAndSignInIfVerified } from "@/lib/firebase/auth";
import { useAuth } from "@/lib/firebase/auth-context";
import { auth } from "@/lib/firebase/client";

export default function Page() {
  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isPolling, setIsPolling] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<'checking' | 'waiting' | 'verified' | 'error'>('checking');
  const router = useRouter();
  const { user, loading } = useAuth();

  // Polling mechanism to check for email verification
  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    let timeoutId: NodeJS.Timeout;
    const maxPollingTime = 15 * 60 * 1000; // 15 minutes
    const pollInterval = 3000; // 3 seconds

    const startPolling = async () => {
      if (loading) return; // Wait for auth context to load
      
      try {
        // Initial check
        const { data } = await getCurrentUser();
        
        if (data.user) {
          const currentUser = auth.currentUser;
          
          if (currentUser && currentUser.emailVerified) {
            // User is already verified, redirect immediately
            setVerificationStatus('verified');
            router.replace('/protected');
            return;
          }
          
          // Start polling for verification
          setIsPolling(true);
          setVerificationStatus('waiting');
          
          intervalId = setInterval(async () => {
            try {
              const { verified, error } = await checkAndSignInIfVerified();
              
              if (verified) {
                setVerificationStatus('verified');
                clearInterval(intervalId);
                clearTimeout(timeoutId);
                router.replace('/protected');
              } else if (error) {
                console.error('Error during verification check:', error);
                setVerificationStatus('error');
                setError('Failed to check verification status. Please try signing in manually.');
                clearInterval(intervalId);
                clearTimeout(timeoutId);
              }
            } catch (pollError) {
              console.error('Polling error:', pollError);
              setVerificationStatus('error');
              setError('Failed to check verification status. Please try signing in manually.');
              clearInterval(intervalId);
              clearTimeout(timeoutId);
            }
          }, pollInterval);
          
          // Set maximum polling timeout
          timeoutId = setTimeout(() => {
            clearInterval(intervalId);
            setIsPolling(false);
            setVerificationStatus('error');
            setError('Verification is taking longer than expected. You can still sign in manually.');
          }, maxPollingTime);
          
        } else {
          setVerificationStatus('error');
          setError('No authenticated user found. Please try signing up again.');
        }
      } catch (error) {
        console.error('Error checking auth status:', error);
        setVerificationStatus('error');
        setError('Failed to check authentication status.');
      } finally {
        setIsCheckingAuth(false);
      }
    };

    startPolling();

    // Cleanup on unmount
    return () => {
      if (intervalId) clearInterval(intervalId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [loading, router]);

  const handleResendVerification = async () => {
    setIsResending(true);
    setError(null);
    
    try {
      const { error } = await resendEmailVerification();
      if (error) {
        setError(error.message);
      } else {
        setResendSuccess(true);
      }
    } catch {
      setError("Failed to resend verification email");
    } finally {
      setIsResending(false);
    }
  };

  // Show loading state while checking authentication
  if (isCheckingAuth || loading) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"></div>
              </div>
              <CardTitle className="text-2xl">Checking verification...</CardTitle>
              <CardDescription>
                Please wait while we check your email verification status
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  // Show success state if verification is complete
  if (verificationStatus === 'verified') {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <CardTitle className="text-2xl">Email Verified!</CardTitle>
              <CardDescription>
                Redirecting you to your dashboard...
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                <Mail className="h-6 w-6 text-green-600" />
              </div>
              <CardTitle className="text-2xl">
                Check your email!
              </CardTitle>
              <CardDescription>
                We sent a verification link to your email address
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                You&apos;ve successfully signed up! Please check your email and click the verification link before signing in.
              </p>
              
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm text-green-800 text-center">
                  <strong>Auto-redirect:</strong> {isPolling 
                    ? "We're actively checking for your email verification..." 
                    : "Once you verify your email, you'll be automatically redirected to your dashboard!"
                  }
                </p>
                {isPolling && (
                  <div className="flex items-center justify-center mt-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-green-600 border-t-transparent mr-2"></div>
                    <span className="text-xs text-green-700">Checking every 3 seconds...</span>
                  </div>
                )}
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">What's next?</p>
                    <ol className="list-decimal list-inside space-y-1 text-blue-700">
                      <li>Check your email inbox (and spam folder)</li>
                      <li>Click the verification link</li>
                      <li>{isPolling ? "We'll automatically detect when you're verified and sign you in!" : "Return here to sign in"}</li>
                    </ol>
                  </div>
                </div>
              </div>

              {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}

              {resendSuccess && (
                <p className="text-sm text-green-600 text-center">
                  Verification email sent! Check your inbox.
                </p>
              )}

              <div className="space-y-3">
                <Button
                  onClick={handleResendVerification}
                  disabled={isResending || resendSuccess}
                  variant="outline"
                  className="w-full"
                >
                  {isResending ? "Sending..." : "Resend verification email"}
                </Button>

                <div className="text-center">
                  <Link
                    href="/auth/login"
                    className="text-sm text-primary hover:text-primary/80 transition-colors"
                  >
                    Already verified? Sign in →
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
