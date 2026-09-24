import React, { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canUseSubscriptionFeature, parseSubscriptionStatus, type SubscriptionStatus } from '@/lib/subscriptions/client-status';

const mocks = vi.hoisted(() => ({ status: null as SubscriptionStatus | null, error: null as string | null,
  buttons: [] as Array<{ children: unknown; onClick: () => void | Promise<void> }>, push: vi.fn(), request: vi.fn(), refetch: vi.fn() }));
vi.mock('@/lib/hooks/use-subscription', () => ({ useSubscription: () => ({ status: mocks.status, isLoading: false, error: mocks.error, refetch: mocks.refetch,
  canAccess: (feature: 'reports' | 'exports' | 'extended_history') => !mocks.error && canUseSubscriptionFeature(mocks.status, feature) }) }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: { id: 'basic-plan-user' } }) }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: mocks.request }));
vi.mock('@/lib/firebase/profiles', () => ({ getUserProfile: vi.fn(), upsertUserProfile: vi.fn() }));
vi.mock('@/lib/hooks/use-before-unload', () => ({ useBeforeUnload: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
  if (onClick) mocks.buttons.push({ children, onClick: onClick as () => void });
  return <button {...props} onClick={onClick}>{children}</button>;
} }));

import { HistoricalAccessUpgradeCard } from '@/components/historical-access-upgrade-card';
import { PaymentSettingsTab } from '@/components/settings-screen';
import { PremiumFeatureGate } from '@/components/premium-feature-gate';
import { ScheduleCExportScreen } from '@/components/schedule-c-export-screen';

const future = '2099-01-01T00:00:00.000Z';
function status(plan: 'basic' | 'premium' | 'trial' = 'basic', expired = false) {
  const paid = plan !== 'trial';
  const fullAccess = plan === 'premium' || plan === 'trial';
  const end = expired ? '2020-01-01T00:00:00.000Z' : future;
  return parseSubscriptionStatus({ success: true, data: {
    hasAccess: !expired, isPaid: paid && !expired, isTrial: plan === 'trial', subscriptionEnd: paid ? end : null, trialEnd: !paid ? end : null,
    entitlements: { plan: expired ? 'free' : plan, hasAccess: !expired, isPaid: paid && !expired, isTrial: !paid,
      status: expired ? 'expired' : paid ? 'active' : 'trial', reason: 'test',
      features: { reports: fullAccess && !expired, exports: fullAccess && !expired, extended_history: !expired },
      subscriptionEnd: paid ? end : null, trialEnd: !paid ? end : null },
    subscription: paid ? { id: 'sub_basic_ui', plan, status: expired ? 'canceled' : 'active', currentPeriodStart: null, currentPeriodEnd: end,
      cancelAtPeriodEnd: false, canceledAt: null, planInterval: 'month', planAmount: plan === 'basic' ? 7.99 : 14.99, planCurrency: 'usd' } : null,
  } });
}
const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join('')
  : isValidElement<{ children?: unknown }>(node) ? text((node as ReactElement<{ children?: unknown }>).props.children)
    : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const renderCard = (variant: 'default' | 'slim' | 'square' = 'default') => renderToStaticMarkup(<HistoricalAccessUpgradeCard variant={variant} />);
const renderSettings = () => renderToStaticMarkup(<PaymentSettingsTab beforeNavigate={action => action()} />);
const renderGate = (feature: 'reports' | 'exports' = 'reports', inline = false) => renderToStaticMarkup(
  <PremiumFeatureGate feature={feature} featureName={feature} inline={inline}>PRIVATE FEATURE</PremiumFeatureGate>);

beforeEach(() => { vi.clearAllMocks(); mocks.buttons = []; mocks.error = null; mocks.status = status(); });

describe('Basic billing presentation and actions', () => {
  it.each(['default', 'slim', 'square'] as const)('labels active Basic accurately in the %s card and routes it to billing', variant => {
    const html = renderCard(variant);
    expect(html).toContain('WriteOff Basic is active');
    expect(html).toContain('Extended bank history is included');
    expect(html).toContain('Reports and exports require Premium');
    expect(html).toContain('$7.99/month');
    expect(html).not.toContain('WriteOff Premium is active');
    expect(mocks.buttons.map(button => text(button.children))).toEqual(['Manage billing']);
    mocks.buttons[0].onClick();
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/protected/settings?tab=payment');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('keeps Basic history until scheduled cancellation with renewal off and billing management', () => {
    mocks.status!.cancelAtPeriodEnd = true;
    mocks.status!.subscription!.cancelAtPeriodEnd = true;
    const html = renderCard();
    expect(html).toContain('WriteOff Basic is active');
    expect(html).toContain('Basic access continues until');
    expect(html).toContain('Renewal is off');
    expect(html).toContain('Reports and exports require Premium');
    expect(mocks.buttons.map(button => text(button.children))).toEqual(['Manage billing']);
  });

  it('does not claim past-due Basic access or invite a duplicate checkout', () => {
    mocks.status = status('basic', true);
    mocks.status!.subscription!.status = 'past_due';
    const html = renderCard();
    expect(html).toContain('WriteOff Basic is inactive');
    expect(html).toContain('Extended bank history is not active');
    expect(mocks.buttons.map(button => text(button.children))).toEqual(['Manage billing']);
  });

  it.each(['default', 'slim', 'square'] as const)('offers a fresh Premium plan after Basic is terminal in the %s card', variant => {
    for (const providerStatus of ['canceled', 'incomplete_expired']) {
      mocks.buttons = [];
      mocks.status = status('basic', true);
      mocks.status!.subscription!.status = providerStatus;
      const html = renderCard(variant);
      expect(html).toContain('Unlock WriteOff Premium');
      expect(mocks.buttons.map(button => text(button.children))).toEqual([variant === 'default' ? 'Subscribe Now' : 'Subscribe']);
      expect(html).not.toContain('Basic is inactive');
    }
  });

  it.each(['default', 'slim', 'square'] as const)('recovers existing Premium billing without offering duplicate checkout in the %s card', variant => {
    for (const providerStatus of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused', 'payment_pending', 'payment_required']) {
      mocks.buttons = [];
      mocks.status = status('premium', true);
      mocks.status!.subscription!.status = providerStatus;
      const html = renderCard(variant);
      expect(html).not.toContain('Subscribe');
      expect(mocks.buttons.map(button => text(button.children))).toEqual(['Manage billing']);
      mocks.buttons[0].onClick();
      expect(mocks.push).toHaveBeenLastCalledWith('/protected/settings?tab=payment');
      expect(mocks.request).not.toHaveBeenCalled();
    }
  });

  it('routes an existing Stripe trial to billing while a local free trial can subscribe', () => {
    mocks.status = status('trial');
    mocks.status.subscription = { ...status('premium').subscription!, status: 'trialing' };
    expect(renderCard()).not.toContain('Subscribe Now');
    expect(mocks.buttons.map(button => text(button.children))).toEqual(['Manage billing']);
    mocks.buttons = [];
    mocks.status = status('trial');
    expect(renderCard()).toContain('Subscribe Now');
  });

  it('does not infer feature access solely from paid Basic status', () => {
    mocks.status!.entitlements.features.extended_history = false;
    const html = renderCard();
    expect(html).not.toContain('Basic is active');
    expect(html).not.toContain('history is included');
  });

  it('shows the provider Basic amount in Settings with only its included feature', () => {
    const html = renderSettings();
    expect(html).toContain('WriteOff Basic');
    expect(html).toContain('Basic · Monthly');
    expect(html).toContain('$7.99/month');
    expect(html).toContain('Extended bank history is included');
    expect(html).toContain('Reports and exports require Premium');
    expect(html).not.toContain('Reports, exports and extended bank history are included');
    expect(html).toContain('Manage Subscription');
  });

  it('does not announce renewal for Basic scheduled to end', () => {
    mocks.status!.cancelAtPeriodEnd = true;
    mocks.status!.subscription!.cancelAtPeriodEnd = true;
    mocks.status!.daysRemaining = 12;
    const html = renderSettings();
    expect(html).toContain('Access ends in');
    expect(html).not.toContain('Renews in');
    expect(html).toContain('Cancelling at period end');
  });

  it.each(['active', 'trialing'])('labels expired Basic inactive despite provider status %s', providerStatus => {
    mocks.status = status('basic', true);
    mocks.status!.subscription!.status = providerStatus;
    mocks.status!.daysRemaining = 0;
    mocks.status!.trialEnd = '2019-12-01T00:00:00.000Z';
    const html = renderSettings();
    expect(html).toContain('>Inactive</');
    expect(html).not.toContain('>Active</');
    expect(html).not.toContain('>active</');
    expect(html).not.toContain('>trialing</');
    expect(html).toContain('Extended bank history is not active');
    expect(html).toContain('Period ended');
    expect(html).not.toContain('Next billing');
    expect(html).not.toContain('Renews in');
  });

  it.each(['premium', 'trial'] as const)('retains the full feature description for %s in Settings', plan => {
    mocks.status = status(plan);
    expect(renderSettings()).toContain('Reports, exports and extended bank history are included');
  });

  it('keeps Premium active without showing duplicate checkout on its compact card', () => {
    mocks.status = status('premium');
    expect(renderCard()).toContain('WriteOff Premium is active');
    expect(renderCard('slim')).toBe('');
  });

  it('withholds cached Basic access when verification failed', () => {
    mocks.error = 'Failed refresh';
    const html = renderCard();
    expect(html).toContain('We could not verify your plan');
    expect(html).not.toContain('Basic is active');
    expect(mocks.buttons.map(button => text(button.children))).toEqual(['Try again']);
  });
});

describe('locked feature billing recovery', () => {
  it.each([
    ['reports', false], ['reports', true], ['exports', false], ['exports', true],
  ] as const)('routes Basic %s gate (inline=%s) to existing billing', (feature, inline) => {
    const html = renderGate(feature, inline);
    expect(html).toContain('Premium');
    expect(html).not.toContain('PRIVATE FEATURE');
    expect(html).not.toContain('Subscribe');
    expect(mocks.buttons.map(button => text(button.children))).toEqual(['Manage billing']);
    mocks.buttons[0].onClick();
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/protected/settings?tab=payment');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'])('manages a nonterminal %s subscription when feature access is denied', providerStatus => {
    mocks.status = status('basic', true);
    mocks.status!.subscription!.status = providerStatus;
    mocks.status!.subscription!.cancelAtPeriodEnd = true;
    expect(renderGate()).not.toContain('Subscribe Now');
    expect(mocks.buttons.map(button => text(button.children))).toEqual(['Manage billing']);
    mocks.buttons[0].onClick();
    expect(mocks.push).toHaveBeenCalledWith('/protected/settings?tab=payment');
  });

  it.each(['canceled', 'incomplete_expired'])('allows fresh plan recovery for a terminal %s subscription', providerStatus => {
    mocks.status = status('basic', true);
    mocks.status!.subscription!.status = providerStatus;
    expect(renderGate()).toContain('Subscribe Now');
    mocks.buttons[0].onClick();
    expect(mocks.push).toHaveBeenCalledWith('/protected/subscriptions');
  });

  it.each(['premium', 'trial'] as const)('continues to unlock feature content for %s', plan => {
    mocks.status = status(plan);
    expect(renderGate('exports')).toBe('PRIVATE FEATURE');
    expect(mocks.buttons).toEqual([]);
  });

  it('offers plans after the free trial expires', () => {
    mocks.status = status('trial', true);
    expect(renderGate()).toContain('Subscribe Now');
    mocks.buttons[0].onClick();
    expect(mocks.push).toHaveBeenCalledWith('/protected/subscriptions');
  });

  it('shows verification recovery without a purchase prompt after a failed refresh', () => {
    mocks.error = 'Verification unavailable';
    const html = renderGate();
    expect(html).toContain('Your plan could not be verified');
    expect(html).not.toContain('Subscribe');
    expect(html).not.toContain('PRIVATE FEATURE');
  });

  it('uses the shared billing recovery and exports flag on the Schedule C screen', () => {
    mocks.status = status('premium');
    mocks.status!.entitlements.features.exports = false;
    const html = renderToStaticMarkup(<ScheduleCExportScreen user={{ id: 'test' }} onBack={() => {}} transactions={[]} />);
    expect(html).toContain('Subscription Required to Export');
    expect(html).not.toContain('Subscribe Now');
    const manage = mocks.buttons.find(button => text(button.children) === 'Manage billing');
    expect(manage).toBeDefined();
    manage!.onClick();
    expect(mocks.push).toHaveBeenCalledWith('/protected/settings?tab=payment');
  });
});
