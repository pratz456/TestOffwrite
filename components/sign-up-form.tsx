"use client";

import { cn } from "@/lib/utils";
import { signUpUser, signInWithGoogle } from "@/lib/firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';
import { Eye, EyeOff } from "lucide-react";
import { validatePassword } from "@/lib/utils/passwordValidation";

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
  // Consent checkboxes
  const [bankConsent, setBankConsent] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [commConsent, setCommConsent] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const router = useRouter();

  const handlePasswordChange = (newPassword: string) => {
    setPassword(newPassword);
    const validation = validatePassword(newPassword);
    setPasswordErrors(validation.errors);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isSubmitting) return; // Prevent double submission
    
    setIsSubmitting(true);
    setError(null);

    // Validate password
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      setError("Please fix the password requirements below");
      setIsSubmitting(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setIsSubmitting(false);
      return;
    }

    try {
      const { data, error } = await signUpUser(email, password);
      if (error) throw new Error(error.message);
      
      // Use push to preserve browser history and allow back button to work
      router.push("/auth/sign-up-success");
    } catch (error: unknown) {
      // Only log errors in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Sign up error:', error);
      }
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsSubmitting(false);
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
        setError(error.message || "Google sign-in failed. Please try again.");
        return;
      }
      
      if (data && data.user) {
        console.log('Google sign in successful, redirecting to profile setup');
        // Small delay to ensure cookies are fully set before navigation
        await new Promise(resolve => setTimeout(resolve, 500));
        // For Google sign-in, redirect to profile setup (same as email sign-up flow)
        router.push("/protected/profile-setup");
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

  const isFormValid = email && password && confirmPassword && password === confirmPassword && passwordErrors.length === 0 && bankConsent && aiConsent && !isSubmitting;

  return (
    <div className="min-h-screen bg-background">
      {/* Background with subtle gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-muted/20"></div>
      
      <div className="relative min-h-screen flex flex-col px-6 py-8 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-2xl">
          {/* Header */}
          <div className="text-center space-y-4 mb-8">
            <button
              onClick={() => {
                if (window.history.length > 1) {
                  window.history.back();
                } else {
                  window.location.href = '/';
                }
              }}
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            
            <div className="flex justify-center">
              <Image src={writeOffLogo} alt="WriteOff" className="w-24 h-auto"/>
            </div>
            
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-foreground">
                Create your account
              </h1>
              <p className="text-sm text-muted-foreground">
                Start maximizing your tax deductions today
              </p>
            </div>
          </div>

          {/* Sign up form */}
          <div className="bg-card/80 backdrop-blur-xl rounded-2xl shadow-lg shadow-gray-900/5 ring-1 ring-border p-6">
            {/* Notice at Collection */}
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900">
              <strong>Notice at Collection:</strong> We collect your name, email, password, and, after signup, your bank transactions, employer/workstyle answers, and state. This information is used to provide tax deduction analysis, generate reports, and personalize your experience. See our <a href="/privacy" className="underline text-blue-700" target="_blank" rel="noopener noreferrer">Privacy Policy</a> for details.
            </div>
            <form onSubmit={handleSignUp} className="space-y-5">
              <div className="space-y-3">
                <div>
                  <Label htmlFor="email" className="text-sm font-medium text-foreground" required>
                    Email address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="example@gmail.com"
                    className="mt-1 h-11 rounded-lg border-border bg-input-background focus:border-primary focus:ring-primary/20"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="password" className="text-sm font-medium text-foreground" required>
                    Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => handlePasswordChange(e.target.value)}
                      placeholder="Create a strong password (min 10 chars, 1 uppercase, 1 special char)"
                      className="mt-1 h-11 rounded-lg border-border bg-input-background focus:border-primary focus:ring-primary/20 pr-12"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
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
                  <Label htmlFor="confirmPassword" className="text-sm font-medium text-foreground" required>
                    Confirm password
                  </Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm your password"
                      className="mt-1 h-11 rounded-lg border-border bg-input-background focus:border-primary focus:ring-primary/20 pr-12"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {confirmPassword && password !== confirmPassword && (
                    <p className="mt-1 text-sm text-destructive">Passwords don't match</p>
                  )}
                </div>
              </div>


              {error && <p className="text-sm text-destructive">{error}</p>}

              {/* Explicit Consents */}
              <div className="space-y-3 bg-muted/40 border border-border rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    id="bankConsent"
                    checked={bankConsent}
                    onChange={e => setBankConsent(e.target.checked)}
                    className="mt-1"
                    required
                  />
                  <label htmlFor="bankConsent" className="text-xs text-foreground">
                    I authorize WriteOff to access and use my account and transaction data via Plaid to analyze potential tax deductions and generate reports, including Schedule C. I understand I can revoke access anytime. (<a href="/privacy" className="underline text-blue-700" target="_blank" rel="noopener noreferrer">Privacy Policy</a> | <a href="https://plaid.com/legal/#end-user-privacy-policy" className="underline text-blue-700" target="_blank" rel="noopener noreferrer">Plaid Privacy Policy</a>)
                    <span className="text-red-600 ml-0.5">*</span>
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    id="aiConsent"
                    checked={aiConsent}
                    onChange={e => setAiConsent(e.target.checked)}
                    className="mt-1"
                    required
                  />
                  <label htmlFor="aiConsent" className="text-xs text-foreground">
                    I understand that WriteOff uses automated (AI) analysis to help identify tax deductions. I may request a human review and can opt out of model improvement if offered in the future.
                    <span className="text-red-600 ml-0.5">*</span>
                  </label>
                </div>
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    id="commConsent"
                    checked={commConsent}
                    onChange={e => setCommConsent(e.target.checked)}
                    className="mt-1"
                  />
                  <label htmlFor="commConsent" className="text-xs text-foreground">
                    I consent to receive communications about my account, product updates, and support via email or SMS.
                  </label>
                </div>
              </div>

              <div className="bg-muted/50 border border-border rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium text-foreground mb-1">What happens next?</p>
                    <p>After creating your account, you'll set up your profile with basic information to personalize your tax optimization experience.</p>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                disabled={!isFormValid || isSubmitting || isGoogleLoading}
                className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-all duration-200 disabled:opacity-50"
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
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            {/* Google Sign In Button */}
            <Button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSubmitting || isGoogleLoading}
              className="w-full h-11 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 flex items-center gap-3"
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

            {/* Sign in link */}
            <div className="mt-6 text-center">
              <p className="text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link
                  href="/auth/login"
                  className="font-medium text-primary hover:text-primary/80 transition-colors"
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
