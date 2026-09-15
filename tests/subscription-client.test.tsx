import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canUseSubscriptionFeature,
  loadSubscriptionStatus,
  parseSubscriptionStatus,
  premiumFeatureForLocation,
} from '../lib/subscriptions/client-status';
import { useSubscription } from '../lib/hooks/use-subscription';
import { PremiumFeatureGate } from '../components/premium-feature-gate';

const auth = vi.hoisted(() => ({ user: { id: 'paid-user' } as { id: string } | null, loading: false }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => auth }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const end = '2099-01-01T00:00:00.000Z';
function payload(plan: 'free' | 'trial' | 'premium' = 'premium') {
  const allowed = plan !== 'free';
  return {
    success: true,
    data: {
      hasAccess: allowed, isTrial: plan === 'trial', isPaid: plan === 'premium',
      subscriptionStatus: plan === 'premium' ? 'active' : plan === 'trial' ? 'trial' : 'expired',
      trialEnd: plan === 'trial' ? end : undefined,
      subscriptionEnd: plan === 'premium' ? end : undefined,
      entitlements: {
        plan, hasAccess: allowed, isTrial: plan === 'trial', isPaid: plan === 'premium', reason: 'test',
        status: plan === 'premium' ? 'active' : plan === 'trial' ? 'trial' : 'expired',
        features: { reports: allowed, exports: allowed, extended_history: allowed },
        trialEnd: plan === 'trial' ? end : undefined,
        subscriptionEnd: plan === 'premium' ? end : undefined,
      },
      subscription: plan === 'premium' ? {
        id: 'sub_test', status: 'active', currentPeriodStart: '2026-01-01T00:00:00.000Z', currentPeriodEnd: end,
        cancelAtPeriodEnd: true, canceledAt: null, planInterval: 'month', planAmount: 14.99, planCurrency: 'usd',
      } : null,
    },
  };
}

function renderGate(client: QueryClient, feature: 'reports' | 'exports' = 'reports') {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PremiumFeatureGate feature={feature} featureName={feature}><p>PRIVATE PREMIUM VIEW</p></PremiumFeatureGate>
    </QueryClientProvider>,
  );
}
function seed(client: QueryClient, userId: string, plan: 'free' | 'trial' | 'premium') {
  client.setQueryData(['subscription-status', userId], parseSubscriptionStatus(payload(plan)));
}

beforeEach(() => { auth.user = { id: 'paid-user' }; auth.loading = false; });

describe('subscription status response validation', () => {
  it('parses server entitlement and billing dates, including pending cancellation', () => {
    const status = parseSubscriptionStatus(payload());
    expect(status.subscription?.currentPeriodEnd).toBeInstanceOf(Date);
    expect(status.cancelAtPeriodEnd).toBe(true);
    expect(canUseSubscriptionFeature(status, 'exports')).toBe(true);
  });
  it.each(['reports', 'exports', 'extended_history'] as const)('unlocks %s for active trial and paid, locks free', (feature) => {
    expect(canUseSubscriptionFeature(parseSubscriptionStatus(payload('trial')), feature)).toBe(true);
    expect(canUseSubscriptionFeature(parseSubscriptionStatus(payload()), feature)).toBe(true);
    expect(canUseSubscriptionFeature(parseSubscriptionStatus(payload('free')), feature)).toBe(false);
  });
  it('does not grant access at or after the entitlement expiry boundary', () => {
    const status = parseSubscriptionStatus(payload());
    expect(canUseSubscriptionFeature(status, 'reports', Date.parse(end) - 1)).toBe(true);
    expect(canUseSubscriptionFeature(status, 'reports', Date.parse(end))).toBe(false);
  });
  it('requires the requested feature, a valid expiration and entitlement grant', () => {
    const status = parseSubscriptionStatus(payload());
    status.entitlements.features.exports = false;
    expect(canUseSubscriptionFeature(status, 'exports')).toBe(false);
    expect(canUseSubscriptionFeature(status, 'reports')).toBe(true);
    status.entitlements.subscriptionEnd = undefined;
    expect(canUseSubscriptionFeature(status, 'reports')).toBe(false);
  });
  it.each([
    {}, { success: false }, { success: true, data: { hasAccess: true } },
    { ...payload(), data: { ...payload().data, trialEnd: 'not-a-date' } },
    { ...payload(), data: { ...payload().data, hasAccess: 'true' } },
  ])('rejects malformed responses without guessing a plan: %j', (body) => {
    expect(() => parseSubscriptionStatus(body)).toThrow();
  });
  it('surfaces HTTP failures and requests fresh uncached status', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(loadSubscriptionStatus(request)).rejects.toThrow('Unable to verify');
    expect(request.mock.calls[0][1].cache).toBe('no-store');
    expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('cancels status requests when the account query is disposed', async () => {
    const abort = new AbortController();
    const request = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const pending = loadSubscriptionStatus(request, abort.signal);
    abort.abort();
    await expect(pending).rejects.toThrow('aborted');
  });
  it('bounds a hung network request to twenty seconds', async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
      const pending = expect(loadSubscriptionStatus(request)).rejects.toThrow('aborted');
      await vi.advanceTimersByTimeAsync(20_000);
      await pending;
    } finally { vi.useRealTimers(); }
  });
});

describe('feature navigation boundaries', () => {
  it.each([
    ['/protected/reports', null, 'reports'], ['/protected/reports/detail', null, 'reports'],
    ['/protected', 'reports', 'reports'], ['/protected', 'profit-loss-report', 'reports'],
    ['/protected', 'schedule-c-export', 'exports'],
  ])('requires feature at %s screen %s', (pathname, screen, feature) => {
    expect(premiumFeatureForLocation(pathname, screen)).toBe(feature);
  });
  it.each([
    ['/protected/settings', 'reports'], ['/protected/subscriptions', 'schedule-c-export'],
    ['/protected/transactions', null], ['/protected', 'receipt-upload'], ['/protected', 'tax-assistant'],
    ['/protected', 'quarterly-payments'], ['/protected', 'income-tracking'], ['/protected', 'tax-preview'],
  ])('keeps account tools and basic features accessible at %s screen %s', (pathname, screen) => {
    expect(premiumFeatureForLocation(pathname, screen)).toBeNull();
  });
});

describe('account scoped feature gate renders', () => {
  it.each(['premium', 'trial'] as const)('renders the protected feature for %s', (plan) => {
    const client = new QueryClient(); seed(client, 'paid-user', plan);
    expect(renderGate(client)).toContain('PRIVATE PREMIUM VIEW'); client.clear();
  });
  it('shows a feature-specific upgrade only for verified free users', () => {
    const client = new QueryClient(); seed(client, 'paid-user', 'free');
    const html = renderGate(client, 'exports');
    expect(html).toContain('Unlock exports'); expect(html).not.toContain('PRIVATE PREMIUM VIEW'); client.clear();
  });
  it('never exposes the prior paid account while the new account loads', () => {
    const client = new QueryClient(); seed(client, 'paid-user', 'premium');
    expect(renderGate(client)).toContain('PRIVATE PREMIUM VIEW');
    auth.user = { id: 'new-user' };
    const html = renderGate(client);
    expect(html).toContain('Checking your plan'); expect(html).not.toContain('PRIVATE PREMIUM VIEW'); client.clear();
  });
  it('does not expose cached access while authentication is unresolved', () => {
    const client = new QueryClient(); seed(client, 'paid-user', 'premium'); auth.loading = true;
    expect(renderGate(client)).not.toContain('PRIVATE PREMIUM VIEW'); client.clear();
  });
  it('closes access on failed refresh and offers retry without an upgrade claim', async () => {
    const client = new QueryClient(); seed(client, 'paid-user', 'premium');
    await client.fetchQuery({ queryKey: ['subscription-status', 'paid-user'], queryFn: async () => { throw new Error('offline'); }, retry: false }).catch(() => {});
    const html = renderGate(client);
    expect(html).toContain('Your plan could not be verified'); expect(html).toContain('Try again');
    expect(html).not.toContain('Unlock reports'); expect(html).not.toContain('PRIVATE PREMIUM VIEW'); client.clear();
  });
  it('removes paid status after sign out', () => {
    const client = new QueryClient(); seed(client, 'paid-user', 'premium'); auth.user = null;
    function Probe() { const state = useSubscription(); return <p>{String(state.hasAccess)}:{String(state.isPaid)}</p>; }
    expect(renderToStaticMarkup(<QueryClientProvider client={client}><Probe /></QueryClientProvider>)).toContain('false:false'); client.clear();
  });
});
