import React, { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSubscriptionStatus, type SubscriptionStatus } from '../lib/subscriptions/client-status';

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'checkout-owner' } as { id: string } | null, loading: false },
  query: { data: undefined as SubscriptionStatus | undefined, isPending: false, isFetching: false,
    isFetchedAfterMount: true, isError: false, refetch: vi.fn() },
  useQuery: vi.fn(), request: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.useQuery }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: mocks.request }));
import StripeSuccessPage from '../app/stripe/success/page';

const future = '2099-01-01T00:00:00.000Z';
function response(plan: 'premium' | 'basic' | 'trial' | 'free' = 'premium') {
  const paid = plan === 'premium' || plan === 'basic';
  const trial = plan === 'trial';
  const fullAccess = plan === 'premium' || trial;
  return { success: true, data: {
    hasAccess: paid || trial, isPaid: paid, isTrial: trial,
    subscriptionEnd: paid ? future : null, trialEnd: trial ? future : null,
    entitlements: { plan, hasAccess: paid || trial, isPaid: paid, isTrial: trial,
      status: paid ? 'active' : trial ? 'trial' : 'expired', reason: 'test',
      features: { reports: fullAccess, exports: fullAccess, extended_history: paid || trial },
      subscriptionEnd: paid ? future : null, trialEnd: trial ? future : null },
    subscription: paid ? { id: 'sub_synthetic', plan, status: 'active', currentPeriodStart: null, currentPeriodEnd: future,
      cancelAtPeriodEnd: false, canceledAt: null, planInterval: 'month', planAmount: plan === 'basic' ? 7.99 : 14.99, planCurrency: 'usd' } : null,
  } };
}
const render = () => renderToStaticMarkup(<StripeSuccessPage />);
type Element = ReactElement<{ children?: unknown; onClick?: () => void; disabled?: boolean }>;
const walk = (node: unknown): Element[] => Array.isArray(node) ? node.flatMap(walk)
  : isValidElement<Element['props']>(node) ? [node, ...walk(node.props.children)] : [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.user = { id: 'checkout-owner' }; mocks.auth.loading = false;
  Object.assign(mocks.query, { data: undefined, isPending: false, isFetching: false, isFetchedAfterMount: true, isError: false });
  mocks.useQuery.mockImplementation(() => mocks.query);
  mocks.query.refetch.mockResolvedValue({});
});

describe('Checkout return verifies server paid status', () => {
  it('confirms verified Basic history access without claiming Premium reports or exports', () => {
    mocks.query.data = parseSubscriptionStatus(response('basic'));
    const html = render();
    expect(html).toContain('Basic is active');
    expect(html).toContain('Extended bank history is included');
    expect(html).toContain('Reports and exports require Premium');
    expect(html).toContain('View transactions');
    expect(html).not.toContain('Premium is active');
    expect(html).not.toContain('Reports and exports are available');
  });

  it.each(['history-locked', 'expired', 'unpaid', 'stale'] as const)('withholds Basic activation for %s state', state => {
    const status = parseSubscriptionStatus(response('basic'));
    if (state === 'history-locked') status.entitlements.features.extended_history = false;
    if (state === 'expired') status.entitlements.subscriptionEnd = new Date(0);
    if (state === 'unpaid') status.subscription!.status = 'past_due';
    if (state === 'stale') mocks.query.isFetchedAfterMount = false;
    mocks.query.data = status;
    expect(render()).not.toContain('Basic is active');
    expect(render()).not.toContain('Extended bank history is included');
  });

  it('keeps Basic active through a scheduled cancellation without expanding its features', () => {
    mocks.query.data = parseSubscriptionStatus(response('basic')); mocks.query.data.cancelAtPeriodEnd = true;
    const html = render();
    expect(html).toContain('Basic is active');
    expect(html).toContain('through the end of your billing period');
    expect(html).toContain('Reports and exports require Premium');
  });

  it('does not announce reports and exports when a paid Premium response lacks export access', () => {
    mocks.query.data = parseSubscriptionStatus(response()); mocks.query.data.entitlements.features.exports = false;
    expect(render()).toContain('Confirmation is pending');
    expect(render()).not.toContain('Reports and exports are available');
  });

  it('requests fresh authenticated server state and scopes it to the signed-in account', async () => {
    render();
    const options = mocks.useQuery.mock.calls[0][0];
    expect(options).toMatchObject({ queryKey: ['checkout-return-status', 'checkout-owner'], enabled: true,
      staleTime: 0, gcTime: 0, refetchOnMount: 'always' });
    mocks.request.mockResolvedValue(Response.json(response()));
    const status = await options.queryFn({ signal: new AbortController().signal });
    expect(mocks.request.mock.calls[0][0]).toBe('/api/subscriptions/check-access');
    expect(mocks.request.mock.calls[0][1]).toMatchObject({ cache: 'no-store', signal: expect.any(AbortSignal) });
    mocks.query.data = status;
    expect(render()).toContain('Premium is active');
  });

  it.each(['isPending', 'isFetching', 'unfetched'])(
    'withholds activation while %s even with cached paid data', state => {
      mocks.query.data = parseSubscriptionStatus(response());
      if (state === 'unfetched') mocks.query.isFetchedAfterMount = false;
      else mocks.query[state as 'isPending' | 'isFetching'] = true;
      const html = render();
      expect(html).toContain('Checking your subscription');
      expect(html).not.toContain('Premium is active');
      expect(walk(StripeSuccessPage()).find(node => node.props.onClick)?.props.disabled).toBe(true);
    },
  );

  it.each(['trial', 'free'] as const)('does not claim payment for a %s account', plan => {
    mocks.query.data = parseSubscriptionStatus(response(plan));
    const html = render();
    expect(html).toContain('Confirmation is pending');
    expect(html).not.toContain('Premium is active');
    expect(html).toContain('Check again');
  });

  it.each(['expired', 'provider-past-due', 'missing-subscription', 'not-paid'])(
    'rejects inconsistent or inactive paid state: %s', state => {
      const status = parseSubscriptionStatus(response());
      if (state === 'expired') status.entitlements.subscriptionEnd = new Date(0);
      if (state === 'provider-past-due') status.subscription!.status = 'past_due';
      if (state === 'missing-subscription') status.subscription = null;
      if (state === 'not-paid') status.entitlements.isPaid = false;
      mocks.query.data = status;
      expect(render()).toContain('Confirmation is pending');
      expect(render()).not.toContain('Premium is active');
    },
  );

  it('shows recovery after a failed refresh instead of cached activation', () => {
    mocks.query.data = parseSubscriptionStatus(response()); mocks.query.isError = true;
    const html = render();
    expect(html).toContain('We could not verify your plan');
    expect(html).toContain('Try again');
    expect(html).toContain('/protected/subscriptions');
    expect(html).not.toContain('Premium is active');
    walk(StripeSuccessPage()).find(node => node.props.onClick)!.props.onClick!();
    expect(mocks.query.refetch).toHaveBeenCalledOnce();
  });

  it('asks a signed-out user to sign in and return without trusting another account cache', () => {
    mocks.auth.user = null; mocks.query.data = parseSubscriptionStatus(response());
    const html = render();
    expect(html).toContain('Sign in to verify your plan');
    expect(html).toContain('/auth/login?redirect=%2Fstripe%2Fsuccess');
    expect(html).not.toContain('Premium is active');
    expect(mocks.useQuery.mock.calls[0][0]).toMatchObject({ enabled: false, queryKey: ['checkout-return-status', null] });
  });

  it('waits for authentication before requesting or announcing paid access', () => {
    mocks.auth.loading = true; mocks.query.data = parseSubscriptionStatus(response());
    expect(render()).toContain('Checking your subscription');
    expect(render()).not.toContain('Premium is active');
    expect(mocks.useQuery.mock.calls[0][0].enabled).toBe(false);
  });

  it('accurately describes a verified paid plan scheduled to end', () => {
    mocks.query.data = parseSubscriptionStatus(response()); mocks.query.data.cancelAtPeriodEnd = true;
    expect(render()).toContain('Premium is active');
    expect(render()).toContain('through the end of your billing period');
  });
});
