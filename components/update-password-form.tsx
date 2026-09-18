"use client";

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { validatePassword } from '@/lib/utils/passwordValidation';
import { passwordResetActions, passwordResetError } from '@/lib/onboarding/password-reset';

type Props = React.ComponentPropsWithoutRef<'div'> & { code: string | null; mode: string | null };

export function UpdatePasswordForm({ code, mode, className, ...props }: Props) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [link, setLink] = useState<{ code: string | null; mode: string | null; email?: string; error?: string; retryable?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const submitting = useRef(false);
  const generation = useRef(0);
  const currentLink = link?.code === code && link.mode === mode ? link : null;
  const validation = validatePassword(password);

  useEffect(() => {
    const current = ++generation.current;
    setLink(null); setError(null); setPassword(''); setConfirmation(''); setComplete(false);
    submitting.current = false; setIsLoading(false);
    passwordResetActions.verify(code, mode).then(
      email => { if (generation.current === current) setLink({ code, mode, email }); },
      failure => {
        if (generation.current !== current) return;
        const safe = passwordResetError(failure);
        setLink({ code, mode, error: safe.message, retryable: safe.retryable });
      },
    );
    return () => { generation.current = current + 1; };
  }, [code, mode, attempt]);

  const handleReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || !currentLink?.email || complete) return;
    setError(null);
    if (!validation.isValid) { setError('Please meet all the password requirements below.'); return; }
    if (password !== confirmation) { setError('Your passwords do not match.'); return; }
    submitting.current = true; setIsLoading(true);
    const current = generation.current;
    try {
      await passwordResetActions.confirm(code, mode, password);
      if (generation.current !== current) return;
      setPassword(''); setConfirmation(''); setComplete(true);
    } catch (failure) {
      if (generation.current !== current) return;
      const safe = passwordResetError(failure);
      if (safe.retryable) setError(safe.message);
      else setLink({ code, mode, error: safe.message });
    } finally {
      if (generation.current === current) { submitting.current = false; setIsLoading(false); }
    }
  };

  return <div className={cn('flex flex-col gap-6', className)} {...props}>
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">{complete ? 'Password reset complete' : 'Reset Your Password'}</CardTitle>
        <CardDescription>{complete ? 'Sign in with your new password.' : 'Use the reset link sent to your email to choose a new password.'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {complete ? <p role="status">Your password has been updated.</p> : !currentLink ? <p role="status">Checking your reset link…</p> : currentLink.error ? <>
          <p role="alert" className="text-sm text-destructive">{currentLink.error}</p>
          {currentLink.retryable && <Button onClick={() => setAttempt(value => value + 1)} className="w-full">Try again</Button>}
        </> : <form onSubmit={handleReset} className="space-y-4">
          <p className="break-all text-sm text-muted-foreground">Resetting the password for {currentLink.email}.</p>
          <div className="grid gap-2">
            <Label htmlFor="password">New password</Label>
            <div className="relative">
              <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required disabled={isLoading} value={password} onChange={event => setPassword(event.target.value)} className="pr-12" />
              <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showPassword ? <EyeOff aria-hidden="true" className="w-5 h-5" /> : <Eye aria-hidden="true" className="w-5 h-5" />}
              </button>
            </div>
            <ul className="ml-4 list-disc text-xs text-muted-foreground">
              <li>At least 10 characters</li><li>At least one uppercase letter</li><li>At least one special character</li>
            </ul>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input id="confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required disabled={isLoading} value={confirmation} onChange={event => setConfirmation(event.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={isLoading || !validation.isValid || !confirmation}>{isLoading ? 'Saving…' : 'Save new password'}</Button>
        </form>}
        {!complete && <Link href="/auth/forgot-password" className="block text-sm text-primary underline">Request a new reset link</Link>}
        <Link href="/auth/login" className="block text-sm text-primary underline">Sign in</Link>
      </CardContent>
    </Card>
  </div>;
}
