"use client";

import { signUpUser, signInWithGoogle, handleAuthRedirectResult } from "@/lib/firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState, useEffect, useRef } from "react";
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';
import { Eye, EyeOff } from "lucide-react";
import { validatePassword } from "@/lib/utils/passwordValidation";
import { useAuth } from "@/lib/firebase/auth-context";
import { auth } from "@/lib/firebase/client";
import { buildConsentRecord, NO_CONSENTS, requiredConsentsAccepted, stashPendingConsents, type ConsentChoices } from "@/lib/onboarding/consents";
import { ConsentCheckboxes, NoticeAtCollection } from "@/components/onboarding/consent-checkboxes";

export function SignUpForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consents, setConsents] = useState<ConsentChoices>(NO_CONSENTS);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const router = useRouter();
  const mountedRef = useRef(true);
  const { user, loading: authLoading } = useAuth();
  const hasRedirected = useRef(false);
  const operationRef = useRef(false);

  // Redirect already-authenticated users away from sign-up page
  useEffect(() => {
    if (!authLoading && user && !hasRedirected.current && !operationRef.current && !isSubmitting && !isGoogleLoading) {
      hasRedirected.current = true;
      router.replace(auth.currentUser?.emailVerified ? '/protected' : '/auth/sign-up-success');
    }
    if (!user) {
      hasRedirected.current = false;
    }
  }, [user, authLoading, router, isSubmitting, isGoogleLoading]);

  // Handle Google sign-in redirect result (when popup is blocked and redirect is used)
  useEffect(() => {
    mountedRef.current = true;
    // On mount, check if we're returning from a Google sign-in redirect.
    // If so, process the redirect result, exchange the ID token for a session
    // cookie, and return the user. If so, navigate to profile setup.
    const checkRedirect = async () => {
      try {
        // Indicate we're handling a possible redirect result (keeps button disabled)
        setIsGoogleLoading(true);
        const { data, error } = await handleAuthRedirectResult();
        if (!mountedRef.current) return;
        if (error) {
          if (process.env.NODE_ENV === 'development') console.error('handleAuthRedirectResult error', error);
          setError(error.message || 'Failed to complete sign-in.');
        } else if (data && data.user) {
          hasRedirected.current = true;
          router.push("/protected/profile-setup");
        }
      } catch (e) {
        if (process.env.NODE_ENV === 'development') console.error('Error handling redirect result', e);
        if (mountedRef.current) {
          setError('An error occurred during sign-in.');
        }
      } finally {
        if (mountedRef.current) {
          setIsGoogleLoading(false);
        }
      }
    };
    checkRedirect();
    return () => {
      mountedRef.current = false;
    };
  }, [router]);

  const handlePasswordChange = (newPassword: string) => {
    setPassword(newPassword);
    const validation = validatePassword(newPassword);
    setPasswordErrors(validation.errors);
  };

  // The account cannot call the profile API until it is verified, so the
  // acknowledgments wait in this browser for profile setup to record them.
  const stashConsents = (accountEmail: string | null | undefined) => {
    const record = buildConsentRecord(consents, 'sign-up');
    if (record) stashPendingConsents(record, accountEmail);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (operationRef.current || isSubmitting || isGoogleLoading) return;
    if (!requiredConsentsAccepted(consents)) {
      setError("Please review and select the required acknowledgments below.");
      return;
    }
    operationRef.current = true;
    
    setIsSubmitting(true);
    setError(null);

    // Validate password
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      setError("Please fix the password requirements below");
      operationRef.current = false;
      setIsSubmitting(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      operationRef.current = false;
      setIsSubmitting(false);
      return;
    }

    try {
      const { data, error } = await signUpUser(email.trim(), password);
      if (error) {
        // Account creation can succeed while sending verification fails. Keep
        // that account and let the verification page resend instead of creating it twice.
        if (auth.currentUser?.email?.toLowerCase() === email.trim().toLowerCase() && !auth.currentUser.emailVerified) {
          stashConsents(email);
          hasRedirected.current = true;
          router.replace('/auth/sign-up-success');
          return;
        }
        throw new Error(error.message);
      }
      if (!data?.user) throw new Error('We could not create your account. Please try again.');
      stashConsents(email);
      hasRedirected.current = true;
      
      router.replace("/auth/sign-up-success");
    } catch (error: unknown) {
      // Only log errors in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Sign up error:', error);
      }
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      operationRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (operationRef.current || isSubmitting || isGoogleLoading) return;
    operationRef.current = true;
    
    setIsGoogleLoading(true);
    setError(null);

    try {
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
        // Boxes checked before choosing Google carry over; otherwise profile
        // setup collects the acknowledgments before any answers are saved.
        stashConsents(data.user.email);
        hasRedirected.current = true;
        // For Google sign-in, redirect to profile setup (same as email sign-up flow)
        router.push("/protected/profile-setup");
      } else if (data == null && error == null) {
        // No immediate user returned: this indicates the provider flow
        // used a redirect (signInWithRedirect) and the browser will
        // navigate away and return to this app where the redirect result
        // will be processed by handleAuthRedirectResult (see useEffect).
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
      operationRef.current = false;
      setIsGoogleLoading(false);
    }
  };

  const isFormValid = email && password && confirmPassword && password === confirmPassword && passwordErrors.length === 0 && requiredConsentsAccepted(consents) && !isSubmitting;

  return (
    <div {...props} className={`min-h-screen bg-background safe-area-inset-top safe-area-inset-bottom ${className || ""}`}>
      {/* Background with subtle gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-muted/20"></div>
      
      <div className="relative min-h-screen flex flex-col px-4 py-4 sm:px-6 sm:py-6">
        <div className="w-full sm:mx-auto sm:max-w-lg">
          {/* Header */}
          <div className="text-center space-y-2 mb-4">
            <button
              onClick={() => {
                if (window.history.length > 1) {
                  window.history.back();
                } else {
                  window.location.href = '/';
                }
              }}
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors py-2 no-tap-highlight"
            >
              <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="text-base sm:text-sm">Back</span>
            </button>
            
            <div className="flex items-center justify-center gap-2">
              <Image src={writeOffLogo} alt="WriteOff" className="h-10 w-10 object-contain"/><span className="text-xl font-semibold tracking-tight">WriteOff</span>
            </div>
            
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-foreground">
                Create your account
              </h1>
              <p className="text-base sm:text-sm text-muted-foreground">
                Start organizing your business tax records today
              </p>
            </div>
          </div>

          {/* Sign up form */}
          <div className="bg-card rounded-xl border border-border p-4 shadow-sm sm:p-5">
            <NoticeAtCollection className="mb-4" />
            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="space-y-4 sm:space-y-3">
                <div>
                  <Label htmlFor="email" className="text-base sm:text-sm font-medium text-foreground" required>
                    Email address
                  </Label>
                  <Input
                    id="email"
                    autoComplete="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="example@gmail.com"
                    className="mt-1.5 sm:mt-1 h-12 sm:h-11 rounded-lg border-border bg-input-background focus:border-primary focus:ring-primary/20 text-base sm:text-sm"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="password" className="text-base sm:text-sm font-medium text-foreground" required>
                    Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      autoComplete="new-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => handlePasswordChange(e.target.value)}
                      placeholder="Min 10 chars, 1 uppercase, 1 special"
                      className="mt-1.5 sm:mt-1 h-12 sm:h-11 rounded-lg border-border bg-input-background focus:border-primary focus:ring-primary/20 pr-14 text-base sm:text-sm"
                      required
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1.5 no-tap-highlight"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {passwordErrors.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {passwordErrors.map((error, index) => (
                        <p key={index} className="text-sm text-destructive">
                          • {error}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="confirmPassword" className="text-base sm:text-sm font-medium text-foreground" required>
                    Confirm password
                  </Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      autoComplete="new-password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm your password"
                      className="mt-1.5 sm:mt-1 h-12 sm:h-11 rounded-lg border-border bg-input-background focus:border-primary focus:ring-primary/20 pr-14 text-base sm:text-sm"
                      required
                    />
                    <button
                      type="button"
                      aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                      aria-pressed={showConfirmPassword}
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1.5 no-tap-highlight"
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {confirmPassword && password !== confirmPassword && (
                    <p className="mt-1 text-sm text-destructive">Passwords don&apos;t match</p>
                  )}
                </div>
              </div>


              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

              {/* Explicit Consents */}
              <ConsentCheckboxes
                values={consents}
                disabled={isSubmitting}
                onChange={(key, checked) => setConsents(prev => ({ ...prev, [key]: checked }))}
              />

              <div className="bg-muted/50 border border-border rounded-xl p-3 sm:p-4">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">What happens next?</p>
                    <p className="text-xs sm:text-sm">After creating your account, you&apos;ll set up your profile to personalize your experience.</p>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                disabled={!isFormValid || isSubmitting || isGoogleLoading}
                className="w-full h-12 sm:h-11 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium text-base sm:text-sm transition-all duration-200 disabled:opacity-50 no-tap-highlight"
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-foreground border-t-transparent"></div>
                    Creating account...
                  </div>
                ) : (
                  'Create Account'
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
              disabled={isSubmitting || isGoogleLoading}
              className="w-full h-12 sm:h-11 bg-card hover:bg-muted active:bg-muted/80 text-foreground border border-border rounded-lg font-medium text-base sm:text-sm transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-3 no-tap-highlight"
            >
              {isGoogleLoading ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-muted-foreground border-t-transparent"></div>
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
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Google accounts make the same acknowledgments. If they are not checked above, we ask for them before profile setup.
            </p>

            {/* Sign in link */}
            <div className="mt-5 sm:mt-6 text-center pb-2">
              <p className="text-base sm:text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link
                  href="/auth/login"
                  className="font-medium text-primary hover:text-primary/80 transition-colors no-tap-highlight"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
