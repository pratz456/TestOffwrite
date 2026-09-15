"use client";

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getSafeAuthRedirect } from '@/lib/url';
import { confirmEmailAction } from '@/lib/onboarding/email-confirmation';

function ConfirmPageContent() {
  const params = useSearchParams();
  const code = params.get('oobCode');
  const mode = params.get('mode');
  const next = getSafeAuthRedirect(params.get('next'));
  const [result, setResult] = useState<{ code: string | null; mode: string | null; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const currentResult = result?.code === code && result.mode === mode ? result : null;

  useEffect(() => {
    let current = true;
    setResult(null);
    confirmEmailAction(code, mode).then(
      () => { if (current) setResult({ code, mode }); },
      error => { if (current) setResult({ code, mode, error: error instanceof Error ? error.message : 'We could not verify your email. Please try again.' }); },
    );
    return () => { current = false; };
  }, [code, mode, attempt]);

  return <main className="min-h-screen bg-background flex items-center justify-center p-4">
    <div className="w-full max-w-md rounded-lg border bg-card p-8 text-center space-y-4">
      {!currentResult ? <>
        <Loader2 aria-hidden="true" className="w-12 h-12 animate-spin text-primary mx-auto" />
        <h1 className="text-xl font-semibold">Verifying your email</h1>
        <p role="status" className="text-muted-foreground">Checking your verification link…</p>
      </> : currentResult.error ? <>
        <AlertCircle aria-hidden="true" className="w-12 h-12 text-destructive mx-auto" />
        <h1 className="text-xl font-semibold">Email not confirmed</h1>
        <p role="alert" className="text-muted-foreground">{currentResult.error}</p>
        {code && mode === 'verifyEmail' && <Button onClick={() => setAttempt(value => value + 1)} className="w-full">Try again</Button>}
        <Button asChild variant="outline" className="w-full"><Link href="/auth/sign-up-success">Request another verification email</Link></Button>
        <Link href="/auth/login" className="block text-sm text-primary underline">Sign in</Link>
      </> : <>
        <CheckCircle aria-hidden="true" className="w-12 h-12 text-primary mx-auto" />
        <h1 className="text-xl font-semibold">Email confirmed</h1>
        <p role="status" className="text-muted-foreground">Your email has been verified. Sign in to continue to WriteOff.</p>
        <Button asChild className="w-full"><Link href={`/auth/login?redirect=${encodeURIComponent(next)}`}>Continue to WriteOff</Link></Button>
      </>}
    </div>
  </main>;
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={<p role="status">Loading verification…</p>}>
      <ConfirmPageContent />
    </Suspense>
  );
}
