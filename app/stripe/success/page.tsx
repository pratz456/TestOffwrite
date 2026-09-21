"use client";

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { CheckCircle, Clock3, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuth } from '@/lib/firebase/auth-context';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { canUseSubscriptionFeature, loadSubscriptionStatus } from '@/lib/subscriptions/client-status';

export default function StripeSuccessPage() {
  const { user, loading: authLoading } = useAuth();
  const query = useQuery({
    // A return URL or Checkout session ID is not evidence of payment. Fetch a
    // fresh, account-scoped server assessment before presenting a paid plan.
    queryKey: ['checkout-return-status', user?.id ?? null],
    queryFn: ({ signal }) => loadSubscriptionStatus(makeAuthenticatedRequest, signal),
    enabled: Boolean(user?.id) && !authLoading,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  const checking = authLoading || Boolean(user?.id && (query.isPending || query.isFetching || !query.isFetchedAfterMount));
  const status = user?.id && !checking && !query.isError ? query.data : null;
  const verifiedPaid = Boolean(status?.isPaid && status.entitlements.isPaid && !status.entitlements.isTrial
    && status.subscription?.status === 'active');
  const basic = verifiedPaid && status?.entitlements.plan === 'basic' && canUseSubscriptionFeature(status, 'extended_history');
  const premium = verifiedPaid && status?.entitlements.plan === 'premium' && canUseSubscriptionFeature(status, 'reports')
    && canUseSubscriptionFeature(status, 'exports');
  const paid = basic || premium;
  const failed = Boolean(user?.id && !checking && query.isError);

  const title = checking ? 'Checking your subscription…'
    : !user ? 'Sign in to verify your plan'
      : basic ? 'Basic is active' : premium ? 'Premium is active'
        : failed ? 'We could not verify your plan' : 'Confirmation is pending';
  const description = checking ? 'Checking your latest billing status with the server.'
    : !user ? 'Use the same WriteOff account you used at checkout.'
      : paid ? (basic
        ? `Your Basic subscription is verified. Extended bank history is included. Reports and exports require Premium.${status?.cancelAtPeriodEnd ? ' Basic remains active through the end of your billing period.' : ''}`
        : status?.cancelAtPeriodEnd ? 'Your paid plan remains active through the end of your billing period.'
          : 'Your paid subscription is verified. Reports and exports are available.')
        : failed ? 'Please retry, or open billing to review your subscription.'
          : status?.isTrial ? 'Your trial is active, but a paid subscription has not been confirmed. Check again or review billing.'
            : 'Your paid plan is not confirmed yet. Bank payments can take 4–5 business days to clear. Check again or review billing.';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center" role={failed ? 'alert' : 'status'} aria-live="polite">
          <div className="flex justify-center mb-2">
            <div className={`rounded-full p-3 ${paid ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
              {checking ? <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
                : paid ? <CheckCircle className="h-7 w-7" aria-hidden="true" /> : <Clock3 className="h-7 w-7" aria-hidden="true" />}
            </div>
          </div>
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription className="mt-2">{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {!authLoading && !user ? (
            <Button asChild className="min-h-11"><Link href="/auth/login?redirect=%2Fstripe%2Fsuccess">Sign in</Link></Button>
          ) : user ? (
            <>
              {!paid && <Button className="min-h-11" disabled={checking} onClick={() => void query.refetch()}>
                {checking ? 'Checking…' : failed ? 'Try again' : 'Check again'}
              </Button>}
              {paid && <Button asChild className="min-h-11"><Link href="/protected?screen=transactions">View transactions</Link></Button>}
              <Button asChild variant="outline" className="min-h-11"><Link href="/protected/subscriptions">Billing and plans</Link></Button>
              <Button asChild variant="ghost" className="min-h-11"><Link href="/protected">Go to dashboard</Link></Button>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
