"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Mail, CheckCircle } from 'lucide-react';
import Link from 'next/link';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { resendEmailVerification, checkAndSignInIfVerified } from '@/lib/firebase/auth';
import { useAuth } from '@/lib/firebase/auth-context';

export default function Page() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(false);
  const [verified, setVerified] = useState(false);
  const [autoChecking, setAutoChecking] = useState(true);
  const [isResending, setIsResending] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const checkingRef = useRef(false);
  const resendingRef = useRef(false);
  const mountedRef = useRef(false);
  const activeUserIdRef = useRef(user?.id);
  activeUserIdRef.current = user?.id;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const checkVerification = useCallback(async (manual = false) => {
    if (checkingRef.current || !user || verified) return false;
    checkingRef.current = true;
    setIsChecking(true);
    if (manual) setVerificationError(null);
    try {
      const result = await checkAndSignInIfVerified();
      if (!mountedRef.current || activeUserIdRef.current !== user.id) return false;
      if (result.error) {
        setVerificationError(result.error.message || 'We could not check verification. Try again when you are connected.');
        return false;
      }
      setVerificationError(null);
      if (result.verified) {
        setVerified(true);
        setAutoChecking(false);
        router.replace('/protected/profile-setup');
        return true;
      }
      if (manual) setNotice('Your email is not verified yet. Open the latest verification email, then try again.');
      return false;
    } catch {
      if (mountedRef.current) setVerificationError('We could not check verification. Check your connection and try again.');
      return false;
    } finally {
      checkingRef.current = false;
      if (mountedRef.current) setIsChecking(false);
    }
  }, [router, user, verified]);

  // Schedule the next request only after the previous one finishes. Slow networks
  // cannot create overlapping checks; a transient error can recover on the next check.
  useEffect(() => {
    if (loading || !user || verified || !autoChecking) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 15 * 60 * 1000;
    const poll = async () => {
      if (cancelled) return;
      if (Date.now() >= deadline) {
        setAutoChecking(false);
        return;
      }
      const complete = await checkVerification();
      if (!cancelled && !complete) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [loading, user, verified, autoChecking, checkVerification]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setTimeout(() => setResendSeconds(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendSeconds]);

  const handleResend = async () => {
    if (resendingRef.current || resendSeconds > 0 || !user) return;
    resendingRef.current = true;
    setIsResending(true);
    setResendError(null);
    setNotice(null);
    try {
      const result = await resendEmailVerification();
      if (!mountedRef.current) return;
      if (result.error) {
        setResendError(result.error.message || 'We could not send another email. Try again in a minute.');
      } else {
        setNotice('A new verification email has been sent. Check your inbox and spam folder.');
        setResendSeconds(60);
      }
    } catch {
      if (mountedRef.current) setResendError('We could not send another email. Check your connection and try again.');
    } finally {
      resendingRef.current = false;
      if (mountedRef.current) setIsResending(false);
    }
  };

  return (
    <main className="flex min-h-svh w-full items-center justify-center bg-background px-4 py-6 sm:py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            {verified ? <CheckCircle aria-hidden="true" /> : <Mail aria-hidden="true" />}
          </div>
          <CardTitle className="text-2xl">{verified ? 'Email verified' : 'Verify your email'}</CardTitle>
          <CardDescription>
            {verified ? 'Opening your profile setup…' : user?.email ? <>Check <span className="break-all font-medium text-foreground">{user.email}</span> for a verification link.</> : 'Verify your email to finish setting up WriteOff.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? <p role="status" className="text-center text-sm">Checking your session…</p> : !user ? (
            <>
              <p className="text-sm text-muted-foreground">Sign in with the account you created to check verification or request another email.</p>
              <Button asChild className="w-full"><Link href="/auth/login">Sign in</Link></Button>
            </>
          ) : !verified ? (
            <>
              <ol className="list-inside list-decimal space-y-2 text-sm text-muted-foreground">
                <li>Check your inbox and spam folder.</li>
                <li>Open the most recent verification link.</li>
                <li>Return here to continue your setup.</li>
              </ol>
              <p className="text-sm text-muted-foreground">{autoChecking ? 'This page checks automatically while you wait.' : 'Automatic checking is paused. You can check again below.'}</p>
              {verificationError && <p role="alert" className="text-sm text-destructive">{verificationError}</p>}
              {resendError && <p role="alert" className="text-sm text-destructive">{resendError}</p>}
              {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
              <Button onClick={() => void checkVerification(true)} disabled={isChecking} className="w-full">
                {isChecking ? 'Checking…' : 'I’ve verified my email'}
              </Button>
              <Button onClick={handleResend} disabled={isResending || resendSeconds > 0} variant="outline" className="w-full">
                {isResending ? 'Sending…' : resendSeconds > 0 ? `Resend available in ${resendSeconds}s` : 'Resend verification email'}
              </Button>
              <Link href="/auth/login" className="block text-center text-sm text-primary underline underline-offset-4">Sign in again</Link>
            </>
          ) : <p role="status" className="text-center text-sm text-muted-foreground">Your account is ready. Continuing…</p>}
        </CardContent>
      </Card>
    </main>
  );
}
