import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(), construct: vi.fn(), retrieve: vi.fn(), update: vi.fn(), refresh: vi.fn(),
  profile: { stripeCustomerId: 'cus_owner', stripeSubscriptionId: 'sub_owner' } as Record<string, string>,
}));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: h.auth }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { doc: () => ({ get: async () => ({ data: () => h.profile }) }) } }));
vi.mock('stripe', () => ({ default: class {
  constructor(key: string, options: unknown) { h.construct(key, options); }
  subscriptions = { retrieve: h.retrieve, update: h.update };
} }));
vi.mock('@/lib/stripe/subscription-sync', async original => ({
  ...await original<typeof import('@/lib/stripe/subscription-sync')>(), refreshSubscriptionForUser: h.refresh,
}));
import { POST as cancel } from '@/app/api/stripe/cancel-subscription/route';
import { POST as reactivate } from '@/app/api/stripe/reactivate-subscription/route';

const request = () => new Request('https://writeoff.test/api/stripe/action', { method: 'POST' });
const subscription = (extra = {}) => ({ id: 'sub_owner', customer: 'cus_owner', metadata: { firebase_uid: 'owner' }, status: 'active', cancel_at_period_end: false, ...extra });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  h.profile = { stripeCustomerId: 'cus_owner', stripeSubscriptionId: 'sub_owner' };
  h.auth.mockResolvedValue({ uid: 'owner' }); h.retrieve.mockResolvedValue(subscription());
  h.update.mockResolvedValue(subscription()); h.refresh.mockResolvedValue(subscription());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('owner billing actions', () => {
  it.each([cancel, reactivate])('requires authentication before constructing a provider client', async action => {
    h.auth.mockRejectedValue(new Error('unauthorized'));
    expect((await action(request())).status).toBe(401);
    expect(h.construct).not.toHaveBeenCalled();
  });
  it.each([cancel, reactivate])('rejects a conflicting subscription owner without a billing mutation', async action => {
    h.retrieve.mockResolvedValue(subscription({ metadata: { firebase_uid: 'someone-else' }, cancel_at_period_end: true }));
    expect((await action(request())).status).toBe(503);
    expect(h.update).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled();
  });
  it('schedules cancellation at period end and verifies the result with bounded provider requests', async () => {
    const response = await cancel(request());
    expect(response.status).toBe(200);
    expect(h.update).toHaveBeenCalledExactlyOnceWith('sub_owner', { cancel_at_period_end: true });
    expect(h.refresh).toHaveBeenCalledExactlyOnceWith('owner', expect.any(Object), 'sub_owner');
    expect(h.construct).toHaveBeenCalledWith('sk_test_fixture', expect.objectContaining({ timeout: 15000, maxNetworkRetries: 1 }));
    expect((await response.json()).message).toContain('end at the close of the current billing period');
  });
  it.each(['canceled', 'scheduled'])('refreshes saved entitlements when cancellation is already %s, without another mutation', async state => {
    h.retrieve.mockResolvedValue(subscription({ status: state === 'canceled' ? 'canceled' : 'active', cancel_at_period_end: true }));
    expect((await cancel(request())).status).toBe(200);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.refresh).toHaveBeenCalledExactlyOnceWith('owner', expect.any(Object), 'sub_owner');
  });
  it('reenables renewal without changing the subscription plan or charging separately', async () => {
    h.retrieve.mockResolvedValue(subscription({ cancel_at_period_end: true }));
    expect((await reactivate(request())).status).toBe(200);
    expect(h.update).toHaveBeenCalledExactlyOnceWith('sub_owner', { cancel_at_period_end: false });
    expect(h.refresh).toHaveBeenCalledExactlyOnceWith('owner', expect.any(Object), 'sub_owner');
  });
  it('does not claim paid access when renewal was already enabled on a past-due subscription', async () => {
    h.retrieve.mockResolvedValue(subscription({ status: 'past_due' }));
    const response = await reactivate(request());
    expect(response.status).toBe(200);
    expect((await response.json()).message).not.toContain('already active');
    expect(h.refresh).toHaveBeenCalledExactlyOnceWith('owner', expect.any(Object), 'sub_owner');
    expect(h.update).not.toHaveBeenCalled();
  });
  it('requires a new subscription after terminal cancellation', async () => {
    h.retrieve.mockResolvedValue(subscription({ status: 'canceled' }));
    expect((await reactivate(request())).status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });
  it.each([cancel, reactivate])('returns retryable failure rather than success when persistence fails after a provider update', async action => {
    h.retrieve.mockResolvedValue(subscription({ cancel_at_period_end: action === reactivate }));
    h.refresh.mockRejectedValue(new Error('PRIVATE PROVIDER PAYLOAD'));
    const response = await action(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE');
    expect(h.update).toHaveBeenCalledOnce();
  });
});
