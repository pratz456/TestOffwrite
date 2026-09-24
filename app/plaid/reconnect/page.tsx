'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/firebase/auth-context';
import { Button } from '@/components/ui/button';
import { PlaidReconnectScreen } from '@/components/plaid-reconnect-screen';

export default function PlaidReconnectPage() {
  const { user, loading } = useAuth();
  const [query, setQuery] = useState<{ sessionId?: string; returnUrl: string } | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('sessionId');
    setQuery({ ...(id ? { sessionId: id } : {}), returnUrl: window.location.pathname + window.location.search });
  }, []);
  if (loading || !query) return <main className="p-6 text-center" role="status">Loading your bank history review…</main>;
  if (!user) return <main className="mx-auto max-w-md space-y-4 p-6">
    <h1 className="text-xl font-semibold">Sign in to review your bank history</h1>
    <p className="text-sm text-muted-foreground">Use the WriteOff account where you saved these bank records.</p>
    <Button asChild><Link href={`/auth/login?redirect=${encodeURIComponent(query.returnUrl)}`}>Sign in</Link></Button>
  </main>;
  return <PlaidReconnectScreen key={user.id} user={user} sessionId={query.sessionId} />;
}
