import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ profile: {} as Record<string, unknown>, create: vi.fn(), retrieve: vi.fn(), update: vi.fn(), portal: vi.fn() }));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: async () => ({ uid: 'owner' }) }));
vi.mock('@/lib/security/rate-limit', () => ({ enforceRateLimit: async () => ({ allowed: true }), RATE_LIMITS: { stripePortal: {} } }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { doc: () => ({ get: async () => ({ data: () => h.profile }), update: h.update }) } }));
vi.mock('stripe', () => ({ default: class {
  customers = { create: h.create, retrieve: h.retrieve };
  billingPortal = { sessions: { create: h.portal } };
} }));
import { POST } from '@/app/api/stripe/create-portal-session/route';
const request = () => new Request('https://writeoff.test/api/stripe/create-portal-session', { method: 'POST' });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture'); h.profile = {};
  h.retrieve.mockResolvedValue({ id: 'cus_owner', metadata: { firebase_uid: 'owner' } });
  h.portal.mockResolvedValue({ url: 'https://billing.stripe.test/session' });
});
afterEach(() => vi.unstubAllEnvs());
describe('billing portal never creates a customer outside checkout', () => {
  it.each(['missing', 'deleted', 'not_found'])('directs %s customer to subscription checkout without provider/account writes', async state => {
    if (state !== 'missing') h.profile = { stripeCustomerId: 'cus_owner' };
    if (state === 'deleted') h.retrieve.mockResolvedValue({ id: 'cus_owner', deleted: true });
    if (state === 'not_found') h.retrieve.mockRejectedValue({ code: 'resource_missing' });
    const response = await POST(request());
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'BILLING_ACCOUNT_REQUIRED' });
    expect(h.create).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled(); expect(h.portal).not.toHaveBeenCalled();
  });
  it('opens the portal for the verified linked customer', async () => {
    h.profile = { stripeCustomerId: 'cus_owner' };
    expect((await POST(request())).status).toBe(200);
    expect(h.portal).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_owner' }));
    expect(h.create).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
  });
  it('rejects conflicting owner metadata', async () => {
    h.profile = { stripeCustomerId: 'cus_other' };
    h.retrieve.mockResolvedValue({ id: 'cus_other', metadata: { firebase_uid: 'another' } });
    expect((await POST(request())).status).toBe(403); expect(h.portal).not.toHaveBeenCalled();
  });
});
