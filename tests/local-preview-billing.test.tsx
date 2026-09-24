import React, { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubscriptionStatus } from '@/lib/subscriptions/client-status';

const mocks = vi.hoisted(() => ({ status: null as SubscriptionStatus | null, open: vi.fn(), assign: vi.fn(), push: vi.fn(), request: vi.fn(),
  buttons: [] as Array<{ children: unknown; onClick: () => void | Promise<void> }> }));
vi.mock('@/lib/hooks/use-subscription', () => ({ useSubscription: () => ({ status: mocks.status, isLoading: false, error: null, refetch: vi.fn(), canAccess: () => false }) }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: { id: 'preview-owner' } }) }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: mocks.request }));
vi.mock('@/lib/firebase/profiles', () => ({ getUserProfile: vi.fn(), upsertUserProfile: vi.fn() }));
vi.mock('@/lib/hooks/use-before-unload', () => ({ useBeforeUnload: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, back: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
  if (onClick) mocks.buttons.push({ children, onClick: onClick as () => void });
  return <button {...props}>{children}</button>;
} }));

import { openLocalPreviewBilling } from '@/lib/subscriptions/local-preview-billing';
import { HistoricalAccessUpgradeCard } from '@/components/historical-access-upgrade-card';
import { PaymentSettingsTab } from '@/components/settings-screen';
import { PremiumFeatureGate } from '@/components/premium-feature-gate';
import SubscriptionsPage from '@/app/protected/subscriptions/page';
import { parseSubscriptionStatus } from '@/lib/subscriptions/client-status';

function paidStatus(cancelAtPeriodEnd = false) {
  return parseSubscriptionStatus({ success: true, data: {
    hasAccess: true, isPaid: true, isTrial: false, cancelAtPeriodEnd, subscriptionEnd: '2099-01-01T00:00:00.000Z',
    entitlements: { plan: 'premium', hasAccess: true, isPaid: true, isTrial: false, status: 'active', reason: 'paid_active',
      features: { reports: true, exports: true, extended_history: true }, subscriptionEnd: '2099-01-01T00:00:00.000Z' },
    subscription: { id: 'sub_preview', plan: 'premium', status: 'active', cancelAtPeriodEnd,
      currentPeriodEnd: '2099-01-01T00:00:00.000Z', currentPeriodStart: null, canceledAt: null, planInterval: 'month', planAmount: 14.99, planCurrency: 'usd' },
  } });
}
const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join('')
  : isValidElement<{ children?: unknown }>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
async function click(label: string) {
  const button = mocks.buttons.find(value => text(value.children).trim() === label);
  expect(button, label).toBeDefined();
  await button!.onClick();
}
function expectHandoff(path = '/protected/settings?tab=payment') {
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith(`https://writeoffapp.com${path}`, '_blank', 'noopener,noreferrer');
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.assign).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.buttons = []; mocks.status = null;
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'local-account-preview');
  vi.stubGlobal('window', { location: { hostname: '127.0.0.1', assign: mocks.assign }, open: mocks.open });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('local real-account billing handoff', () => {
  it.each(['Subscribe Now', 'Subscribe'] as const)('opens live plans for %s without local checkout', async label => {
    renderToStaticMarkup(<HistoricalAccessUpgradeCard variant={label === 'Subscribe' ? 'slim' : 'default'} />);
    await click(label); expectHandoff('/protected/subscriptions');
  });
  it('opens live billing when re-enabling a subscription without reactivating locally', async () => {
    mocks.status = paidStatus(true);
    renderToStaticMarkup(<HistoricalAccessUpgradeCard />);
    await click('Re-enable Subscription'); expectHandoff();
  });
  it('opens live billing from the active plan card', async () => {
    mocks.status = paidStatus(); renderToStaticMarkup(<HistoricalAccessUpgradeCard />);
    await click('Manage billing'); expectHandoff();
  });
  it.each(['Manage Subscription', 'Cancel Subscription', 'Open Billing Portal'])('hands off %s without a local provider mutation', async label => {
    mocks.status = paidStatus(); renderToStaticMarkup(<PaymentSettingsTab beforeNavigate={action => action()} />);
    await click(label); expectHandoff();
  });
  it.each([['Sync Subscription', '/protected/settings?tab=payment'], ['View Upgrade Options', '/protected/subscriptions']])('hands off %s for an account without a plan', async (label, path) => {
    renderToStaticMarkup(<PaymentSettingsTab beforeNavigate={action => action()} />);
    await click(label); expectHandoff(path);
  });
  it.each([false, true])('opens live plan recovery from a feature gate (existing=%s)', async existing => {
    if (existing) mocks.status = paidStatus();
    renderToStaticMarkup(<PremiumFeatureGate>Private report</PremiumFeatureGate>);
    await click(existing ? 'Manage billing' : 'Subscribe Now');
    expectHandoff(existing ? undefined : '/protected/subscriptions');
  });
  it('opens live billing from the subscriptions page', async () => {
    mocks.status = paidStatus(); renderToStaticMarkup(<SubscriptionsPage />);
    await click('Manage billing and payment methods'); expectHandoff();
  });
  it.each([
    ['production', 'local-account-preview', '127.0.0.1'],
    ['development', 'staging', '127.0.0.1'],
    ['development', 'local-account-preview', 'writeoffapp.com'],
    ['development', 'local-account-preview', '127.0.0.1.attacker.example'],
  ])('never enables the preview handoff in %s / %s / %s', (nodeEnv, appEnv, hostname) => {
    vi.stubEnv('NODE_ENV', nodeEnv); vi.stubEnv('NEXT_PUBLIC_APP_ENV', appEnv);
    vi.stubGlobal('window', { location: { hostname }, open: mocks.open });
    expect(openLocalPreviewBilling()).toBe(false); expect(mocks.open).not.toHaveBeenCalled();
  });
  it('retains the production portal request and validated Stripe redirect', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.request.mockResolvedValue({ ok: true, json: async () => ({ url: 'https://billing.stripe.com/p/session/test' }) });
    mocks.status = paidStatus(); renderToStaticMarkup(<PaymentSettingsTab beforeNavigate={action => action()} />);
    await click('Open Billing Portal');
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith('/api/stripe/create-portal-session', { method: 'POST' });
    expect(mocks.assign).toHaveBeenCalledExactlyOnceWith('https://billing.stripe.com/p/session/test');
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
