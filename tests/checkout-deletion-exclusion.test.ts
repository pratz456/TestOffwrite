import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ records: new Map<string, Record<string, any>>(), create: vi.fn(), retrieve: vi.fn(), remove: vi.fn(), session: vi.fn(), failProfileSave: false, failRelease: false }));
vi.mock('@/lib/firebase/admin', () => {
  const doc = (path: string): any => ({ path,
    get: async () => ({ exists: h.records.has(path), data: () => h.records.get(path) }),
    update: async (data: any) => { if (h.failProfileSave) throw new Error('private database error'); h.records.set(path, { ...h.records.get(path), ...data }); },
  });
  return { adminDb: { doc, runTransaction: async (work: any) => {
    const writes: Array<() => void> = [];
    const result = await work({ get: (ref: any) => ref.get(),
      set: (ref: any, data: any, options: any) => writes.push(() => h.records.set(ref.path, { ...(options?.merge ? h.records.get(ref.path) : {}), ...data })),
      update: (ref: any, data: any) => { if (h.failRelease && data.billingOperations && !Object.keys(data.billingOperations).length) throw new Error('release failed'); writes.push(() => h.records.set(ref.path, { ...h.records.get(ref.path), ...data })); },
    }); writes.forEach(write => write()); return result;
  } } };
});
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: async () => ({ uid: 'owner' }) }));
vi.mock('@/lib/stripe/subscription-sync', () => ({
  getStripeClient: () => ({ customers: { create: h.create, retrieve: h.retrieve, del: h.remove },
    subscriptions: { list: async () => ({ data: [] }) }, checkout: { sessions: { create: h.session } } }),
  configuredPriceIds: () => ['price_premium'], subscriptionPlanForPrice: () => 'premium',
}));
import { POST } from '@/app/api/stripe/create-checkout/route';
import { beginCheckoutOperation, finishCheckoutOperation } from '@/lib/stripe/checkout-operations';
const marker = 'account_deletions/owner', profile = 'user_profiles/owner';
const request = () => new Request('https://writeoff.test/api/stripe/create-checkout', { method: 'POST', body: JSON.stringify({ interval: 'monthly' }) });
const operations = () => Object.values(h.records.get(marker)?.billingOperations ?? {}) as Record<string, any>[];
beforeEach(() => {
  vi.clearAllMocks(); h.records.clear(); h.failProfileSave = false; h.failRelease = false;
  h.records.set(profile, { email: 'synthetic@example.invalid' });
  vi.stubEnv('STRIPE_PRICE_ID_MONTHLY', 'price_premium'); vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://writeoffapp.com');
  h.create.mockResolvedValue({ id: 'cus_created' }); h.retrieve.mockResolvedValue({ id: 'cus_saved', metadata: { firebase_uid: 'owner' } });
  h.remove.mockResolvedValue({ id: 'cus_created', deleted: true }); h.session.mockResolvedValue({ id: 'cs_fixture', url: 'https://checkout.stripe.test/fixture' });
});
afterEach(() => vi.unstubAllEnvs());

describe('checkout exclusion during account deletion', () => {
  it('rejects future checkout before provider access when the permanent deletion marker exists', async () => {
    h.records.set(marker, { deletionRequested: true });
    const response = await POST(request());
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'ACCOUNT_DELETION_PENDING' });
    expect(h.create).not.toHaveBeenCalled(); expect(h.retrieve).not.toHaveBeenCalled(); expect(h.session).not.toHaveBeenCalled();
  });
  it('keeps an in-flight customer creation visible to deletion and only releases after its ID is saved', async () => {
    let resolve!: (value: { id: string }) => void;
    h.create.mockImplementation(() => new Promise(value => { resolve = value; }));
    const running = POST(request()); await new Promise(setImmediate);
    expect(operations()).toMatchObject([{ state: 'in_flight' }]);
    h.records.set(marker, { ...h.records.get(marker), deletionRequested: true, linkOperations: { bank: { state: 'in_flight' } } });
    expect((await POST(request())).status).toBe(409);
    resolve({ id: 'cus_created' }); expect((await running).status).toBe(200);
    expect(h.records.get(profile)?.stripeCustomerId).toBe('cus_created'); expect(operations()).toEqual([]);
    expect(h.records.get(marker)).toMatchObject({ deletionRequested: true, linkOperations: { bank: { state: 'in_flight' } } });
    expect(h.create).toHaveBeenCalledOnce();
  });
  it('releases ordinary existing-customer checkout without changing bank operations', async () => {
    h.records.set(profile, { stripeCustomerId: 'cus_saved' }); h.records.set(marker, { linkOperations: { bank: {} } });
    expect((await POST(request())).status).toBe(200); expect(h.create).not.toHaveBeenCalled(); expect(operations()).toEqual([]);
    expect(h.records.get(marker)?.linkOperations).toEqual({ bank: {} });
  });
  it('retains unknown customer creation outcomes instead of authorizing erasure on a timer', async () => {
    h.create.mockRejectedValue(new Error('private ambiguous provider failure'));
    const response = await POST(request());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private ambiguous');
    expect(operations()).toMatchObject([{ state: 'customer_create_unknown', recoveryRequired: true }]);
    const value = operations()[0]; value.startedAt = 0;
    expect((await POST(request())).status).toBe(409); expect(h.create).toHaveBeenCalledOnce();
  });
  it('revokes an unsaved new customer before releasing its operation', async () => {
    h.failProfileSave = true;
    expect((await POST(request())).status).toBe(503);
    expect(h.remove).toHaveBeenCalledExactlyOnceWith('cus_created'); expect(h.session).not.toHaveBeenCalled(); expect(operations()).toEqual([]);
  });
  it.each(['throws', 'unconfirmed'])('retains the recovery ID when customer compensation %s', async outcome => {
    h.failProfileSave = true;
    if (outcome === 'throws') h.remove.mockRejectedValue(new Error('private cleanup response'));
    else h.remove.mockResolvedValue({ deleted: false });
    expect((await POST(request())).status).toBe(503);
    expect(operations()).toMatchObject([{ state: 'customer_cleanup_required', customerId: 'cus_created', recoveryRequired: true }]);
    expect(h.session).not.toHaveBeenCalled();
  });
  it('can release a session-create failure once the customer is durably discoverable for deletion', async () => {
    h.session.mockRejectedValue(new Error('temporary session failure'));
    expect((await POST(request())).status).toBe(503);
    expect(h.records.get(profile)?.stripeCustomerId).toBe('cus_created'); expect(operations()).toEqual([]); expect(h.remove).not.toHaveBeenCalled();
  });
  it('reports pending status if operation release cannot be persisted', async () => {
    h.failRelease = true;
    const response = await POST(request());
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: 'BILLING_OPERATION_PENDING' });
    expect(operations()).toHaveLength(1);
  });
  it('does not allow concurrent billing operations or remove another operation map', async () => {
    const id = await beginCheckoutOperation('owner');
    await expect(beginCheckoutOperation('owner')).rejects.toMatchObject({ code: 'BILLING_OPERATION_PENDING' });
    h.records.set(marker, { ...h.records.get(marker), deletionRequested: true, linkOperations: { bank: {} } });
    await finishCheckoutOperation('owner', id);
    expect(h.records.get(marker)).toMatchObject({ deletionRequested: true, linkOperations: { bank: {} }, billingOperations: {} });
  });
});
