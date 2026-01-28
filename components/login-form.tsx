"use client";

import { cn } from "@/lib/utils";
import { signInUser, signInWithGoogle } from "@/lib/firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';
import { Eye, EyeOff } from "lucide-react";
import { handleAuthRedirectResult } from "@/lib/firebase/auth";
import { useAuth } from "@/lib/firebase/auth-context";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/protected';
  const { user, loading: authLoading } = useAuth();
  const hasRedirected = useRef(false);

  // Redirect already-authenticated users away from login page
  useEffect(() => {
    if (!authLoading && user && !hasRedirected.current) {
      hasRedirected.current = true;
      console.log('[LoginForm] User already authenticated, redirecting to:', redirect);
      router.replace(redirect);
    }
    if (!user) {
      hasRedirected.current = false;
    }
  }, [user, authLoading, router, redirect]);

  // Handle OAuth redirect completion (Google redirect flow)
  useEffect(() => {
    let mounted = true;
    (async () => {
      // If the user was redirected back from the provider, auth.ts will
      // process the redirect result, exchange the ID token for a session
      // cookie, and return the user. If so, navigate to the redirect target.
      try {
        // Indicate we're handling a possible redirect result (keeps button disabled)
        setIsGoogleLoading(true);
        const { data, error } = await handleAuthRedirectResult();
        if (!mounted) return;
        if (error) {
          if (process.env.NODE_ENV === 'development') console.error('handleAuthRedirectResult error', error);
          setError(error.message || 'Failed to complete sign-in.');
        } else if (data && data.user) {
          router.push(redirect);
        }
      } catch (e) {
        if (process.env.NODE_ENV === 'development') console.error('Error handling redirect result', e);
      } finally {
        if (mounted) setIsGoogleLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [redirect, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isLoading) return; // Prevent double submission

    setIsLoading(true);
    setError(null);

    try {
      console.log('Attempting to sign in with:', email);
      const { data, error } = await signInUser(email, password);

      if (error) {
        // Only log errors in development
        if (process.env.NODE_ENV === 'development') {
          console.error('Sign in error:', error);
        }
        if (error.code === "email-not-verified") {
          // Special handling for email verification error
          setError(error.message);
        } else {
          setError(error.message || "Authentication failed. Please check your credentials.");
        }
        return;
      }

      if (data && data.user) {
        console.log('Sign in successful, redirecting to:', redirect);
        // Small delay to ensure cookies are fully set before navigation
        await new Promise(resolve => setTimeout(resolve, 500));
        // Use push to preserve browser history and allow back button to work
        router.push(redirect);
      } else {
        setError("Authentication failed. Please try again.");
      }
    } catch (error: unknown) {
      // Only log errors in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Login error:', error);
      }
      setError(error instanceof Error ? error.message : "An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (isGoogleLoading) return; // Prevent double submission

    setIsGoogleLoading(true);
    setError(null);

    try {
      console.log('Attempting to sign in with Google');
      const { data, error } = await signInWithGoogle();

      if (error) {
        // Only log errors in development
        if (process.env.NODE_ENV === 'development') {
          console.error('Google sign in error:', error);
        }
        // Provide user-friendly error messages
        let errorMessage = "Google sign-in failed. Please try again.";
        if (error.code === 'auth/popup-blocked') {
          errorMessage = "Popup was blocked. Please allow popups for this site and try again, or the redirect flow will be used automatically.";
        } else if (error.code === 'auth/popup-closed-by-user') {
          errorMessage = "Sign-in was cancelled. Please try again.";
        } else if (error.message) {
          errorMessage = error.message;
        }
        setError(errorMessage);
        return;
      }

      if (data && data.user) {
        console.log('Google sign in successful, redirecting to:', redirect);
        // Small delay to ensure cookies are fully set before navigation
        await new Promise(resolve => setTimeout(resolve, 500));
        router.push(redirect);
      } else if (data == null && error == null) {
        // No immediate user returned: this indicates the provider flow
        // used a redirect (signInWithRedirect) and the browser will
        // navigate away and return to this app where the redirect result
        // will be processed by handleAuthRedirectResult (see useEffect).
        console.log('Google sign-in triggered redirect; awaiting redirect result.');
        return;
      } else {
        setError("Google sign-in failed. Please try again.");
      }
    } catch (error: unknown) {
      // Only log errors in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Google sign in error:', error);
      }
      setError(error instanceof Error ? error.message : "An unexpected error occurred. Please try again.");
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background safe-area-inset-top safe-area-inset-bottom">
      {/* Background with subtle gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-muted/20"></div>

      <div className="relative min-h-screen flex flex-col px-4 sm:px-6 py-6 sm:py-8 lg:px-8">
        <div className="w-full sm:mx-auto sm:max-w-lg">
          {/* Header */}
          <div className="text-center space-y-4 mb-6 sm:mb-8">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors py-2 no-tap-highlight"
            >
              <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="text-base sm:text-sm">Back</span>
            </Link>

            <div className="flex justify-center">
              <Image src={writeOffLogo} alt="WriteOff" className="w-20 sm:w-24 h-auto"/>
            </div>

            <div className="space-y-1">
              <h1 className="text-2xl sm:text-2xl font-semibold text-foreground">
                Welcome back
              </h1>
              <p className="text-base sm:text-sm text-muted-foreground">
                Sign in to your WriteOff account
              </p>
            </div>
          </div>

          {/* Sign in form */}
          <div className="bg-card/80 backdrop-blur-xl rounded-xl sm:rounded-2xl shadow-lg shadow-gray-900/5 ring-1 ring-border p-5 sm:p-6">
            <form onSubmit={handleLogin} className="space-y-4 sm:space-y-5">
              <div className="space-y-4 sm:space-y-3">
                <div>
                  <Label htmlFor="email" className="text-base sm:text-sm font-medium text-foreground" required>
                    Email address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="example@gmail.com"
                    className="mt-1.5 sm:mt-1 h-12 sm:h-11 rounded-lg border-border bg-input-background focus:border-primary focus:ring-primary/20 text-base sm:text-sm"
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-base sm:text-sm font-medium text-foreground" required>
                      Password
                    </Label>
                    <Link
                      href="/auth/forgot-password"
                      className="text-sm text-primary hover:text-primary/80 transition-colors py-1 no-tap-highlight"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="mt-1.5 sm:mt-1 h-12 sm:h-11 rounded-lg border-border bg-input-background focus:border-primary focus:ring-primary/20 pr-14 text-base sm:text-sm"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1.5 no-tap-highlight"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 sm:p-3 rounded-lg">
                  <p>{error}</p>
                  {error.includes("verify your email") && (
                    <p className="mt-2">
                      <Link
                        href="/auth/sign-up-success"
                        className="text-primary hover:text-primary/80 underline no-tap-highlight"
                      >
                        Resend verification email →
                      </Link>
                    </p>
                  )}
                </div>
              )}

              <Button
                type="submit"
                disabled={!email || !password || isLoading || isGoogleLoading}
                className="w-full h-12 sm:h-11 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium text-base sm:text-sm transition-all duration-200 disabled:opacity-50 no-tap-highlight"
              >
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-foreground border-t-transparent"></div>
                    Signing in...
                  </div>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>

            {/* Divider */}
            <div className="relative my-5 sm:my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-3 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            {/* Google Sign In Button */}
            <Button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoading || isGoogleLoading}
              className="w-full h-12 sm:h-11 bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-700 border border-gray-300 rounded-lg font-medium text-base sm:text-sm transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-3 no-tap-highlight"
            >
              {isGoogleLoading ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-400 border-t-transparent"></div>
                  Signing in...
                </div>
              ) : (
                <>
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </>
              )}
            </Button>

            {/* Sign up link */}
            <div className="mt-5 sm:mt-6 text-center pb-2">
              <p className="text-base sm:text-sm text-muted-foreground">
                Don't have an account?{' '}
                <Link
                  href="/auth/sign-up"
                  className="font-medium text-primary hover:text-primary/80 transition-colors no-tap-highlight"
                >
                  Create one
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}