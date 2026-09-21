import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ profile: {} as Record<string, string>, retrieveCustomer: vi.fn(), deleteCustomer: vi.fn(), retrieveSubscription: vi.fn(), cancelSubscription: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { doc: () => ({ get: async () => ({ data: () => h.profile }) }) } }));
vi.mock('stripe', () => ({ default: class {
  customers = { retrieve: h.retrieveCustomer, del: h.deleteCustomer };
  subscriptions = { retrieve: h.retrieveSubscription, cancel: h.cancelSubscription };
} }));
import { cancelUserStripeSubscriptions } from '@/lib/stripe/cancel-subscription';
beforeEach(() => {
  vi.clearAllMocks(); h.profile = { stripeCustomerId: 'cus_fixture', stripeSubscriptionId: 'sub_fixture' };
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  h.retrieveCustomer.mockResolvedValue({ id: 'cus_fixture' }); h.deleteCustomer.mockResolvedValue({ id: 'cus_fixture', deleted: true });
  h.retrieveSubscription.mockResolvedValue({ id: 'sub_fixture', customer: 'cus_fixture', status: 'active' });
  h.cancelSubscription.mockResolvedValue({ id: 'sub_fixture', status: 'canceled' });
});
afterEach(() => vi.unstubAllEnvs());
describe('account deletion billing closure', () => {
  it('requires a confirmed customer deletion, covering all customer subscriptions', async () => {
    expect((await cancelUserStripeSubscriptions('owner')).success).toBe(true);
    expect(h.deleteCustomer).toHaveBeenCalledExactlyOnceWith('cus_fixture');
    expect(h.cancelSubscription).not.toHaveBeenCalled();
  });
  it.each(['retrieve', 'delete'])('does not swallow customer %s failure', async operation => {
    (operation === 'retrieve' ? h.retrieveCustomer : h.deleteCustomer).mockRejectedValue(new Error('private provider response'));
    const result = await cancelUserStripeSubscriptions('owner');
    expect(result.success).toBe(false); expect(result.error?.message).not.toContain('private provider response');
  });
  it('refuses deletion when the subscription belongs to another customer', async () => {
    h.retrieveSubscription.mockResolvedValue({ customer: 'cus_other', status: 'active' });
    expect((await cancelUserStripeSubscriptions('owner')).success).toBe(false);
    expect(h.deleteCustomer).not.toHaveBeenCalled(); expect(h.cancelSubscription).not.toHaveBeenCalled();
  });
  it('can resume after a previous request already deleted the customer', async () => {
    h.retrieveSubscription.mockResolvedValue({ customer: 'cus_fixture', status: 'canceled' });
    h.retrieveCustomer.mockResolvedValue({ id: 'cus_fixture', deleted: true });
    expect((await cancelUserStripeSubscriptions('owner')).success).toBe(true);
    expect(h.deleteCustomer).not.toHaveBeenCalled();
  });
  it('requires configured billing when saved billing identifiers exist', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    expect((await cancelUserStripeSubscriptions('owner')).success).toBe(false);
    expect(h.deleteCustomer).not.toHaveBeenCalled();
    h.profile = {};
    expect((await cancelUserStripeSubscriptions('owner')).success).toBe(true);
  });
  it('closes a subscription-only legacy account and refuses an unconfirmed cancellation', async () => {
    h.profile = { stripeSubscriptionId: 'sub_fixture' };
    expect((await cancelUserStripeSubscriptions('owner')).success).toBe(true);
    expect(h.cancelSubscription).toHaveBeenCalledExactlyOnceWith('sub_fixture');
    h.cancelSubscription.mockResolvedValue({ status: 'active' });
    expect((await cancelUserStripeSubscriptions('owner')).success).toBe(false);
  });
  it('does not treat an unknown customer or an unconfirmed deletion as closed billing', async () => {
    h.retrieveCustomer.mockRejectedValueOnce({ code: 'resource_missing' });
    expect((await cancelUserStripeSubscriptions('owner')).success).toBe(false);
    h.deleteCustomer.mockResolvedValue({ id: 'cus_fixture', deleted: false });
    expect((await cancelUserStripeSubscriptions('owner')).success).toBe(false);
  });
});
