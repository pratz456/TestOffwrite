'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/firebase/auth-context';
import { PlaidLinkScreen } from '@/components/plaid-link-screen';
import { Button } from '@/components/ui/button';
import { readPlaidOAuthResume, clearPlaidOAuthSession, type PlaidOAuthResume } from '@/lib/plaid/oauth-session';

/** Query-free registered callback; Plaid appends only its OAuth state parameter. */
export default function PlaidOAuthPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [resume, setResume] = useState<PlaidOAuthResume | null>(null);
  const [checked, setChecked] = useState(false);
  const [returnUrl, setReturnUrl] = useState('/plaid/oauth');
  useEffect(() => {
    setReturnUrl(window.location.pathname + window.location.search);
    if (loading) return;
    if (!user) { setResume(null); setChecked(false); return; }
    try { setResume(readPlaidOAuthResume(window.sessionStorage, user.id, window.location.href)); }
    catch { setResume(null); }
    setChecked(true);
  }, [user?.id, loading]);
  const banks = '/protected?screen=banks-detail';
  if (loading || (user && !checked)) return <main className="p-6 text-center" role="status">Restoring your secure bank sign-in…</main>;
  if (!user) return <main className="mx-auto max-w-md space-y-4 p-6">
    <h1 className="text-xl font-semibold">Sign in to finish connecting your bank</h1>
    <p className="text-sm text-muted-foreground">Use the same WriteOff account and browser where you started.</p>
    <Button asChild><Link href={`/auth/login?redirect=${encodeURIComponent(returnUrl)}`}>Sign in</Link></Button>
  </main>;
  if (!resume || resume.session.uid !== user.id) return <main className="mx-auto max-w-md space-y-4 p-6">
    <h1 className="text-xl font-semibold">Restart your bank connection</h1>
    <p className="text-sm text-muted-foreground">This sign-in session expired or opened in a different browser. Your saved records are unchanged.</p>
    <Button asChild><Link href={banks}>Return to banks</Link></Button>
  </main>;
  const reconnect = resume.session.reconnectSessionId ? `/plaid/reconnect?sessionId=${encodeURIComponent(resume.session.reconnectSessionId)}` : null;
  return <PlaidLinkScreen user={user} oauthResume={resume} fromSettings={resume.session.fromSettings} updateItemId={resume.session.itemId} reconnectSessionId={resume.session.reconnectSessionId}
    onBack={() => { clearPlaidOAuthSession(window.sessionStorage); router.replace(reconnect || banks); }}
    onSuccess={() => router.replace(reconnect || (resume.session.fromSettings || resume.session.itemId ? banks : '/protected'))} />;
}
