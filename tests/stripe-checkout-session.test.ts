import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
const h = vi.hoisted(() => ({ records: new Map<string, any>(), sessions: new Map<string, any>(),
  subscriptions: [] as any[], byKey: new Map<string, any>(), create: vi.fn(), expire: vi.fn(), list: vi.fn(),
  retrieve: vi.fn(), listSubscriptions: vi.fn(), lostCreateResponse: false, failStateSave: false }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { doc: (path: string) => ({
  get: async () => ({ data: () => h.records.get(path) }),
  set: async (data: any) => { if (h.failStateSave && data.sessionId) throw Error('database unavailable'); h.records.set(path, structuredClone(data)); },
}) } }));
vi.mock('@/lib/stripe/subscription-sync', () => ({ configuredPriceIds: () => ['price_month', 'price_year'] }));
import { getOrCreateCheckoutSession } from '@/lib/stripe/checkout-session';
const path = 'user_profiles/owner/stripe_sync/checkout';
const params = (price = 'price_month'): Stripe.Checkout.SessionCreateParams => ({ customer: 'cus_1', mode: 'subscription',
  metadata: { firebase_uid: 'owner' }, line_items: [{ price, quantity: 1 }], success_url: 'https://writeoff.test/success' });
const stripe = { checkout: { sessions: { create: h.create, retrieve: h.retrieve, expire: h.expire, list: h.list,
  listLineItems: async (id: string) => ({ data: [{ price: { id: h.sessions.get(id).price }, quantity: 1 }], has_more: false }) } },
  subscriptions: { list: h.listSubscriptions } } as unknown as Stripe;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-24T12:00:00Z')); vi.clearAllMocks();
  h.records.clear(); h.sessions.clear(); h.byKey.clear(); h.subscriptions = []; h.lostCreateResponse = false; h.failStateSave = false;
  h.listSubscriptions.mockImplementation(async () => ({ data: h.subscriptions, has_more: false }));
  h.list.mockImplementation(async () => ({ data: [...h.sessions.values()].filter(session => session.status === 'open'), has_more: false }));
  h.retrieve.mockImplementation(async (id: string) => { if (!h.sessions.has(id)) throw Error('missing session'); return h.sessions.get(id); });
  h.expire.mockImplementation(async (id: string) => {
    const session = h.sessions.get(id);
    if (session.status !== 'open') throw Error('session already completed');
    session.status = 'expired'; return session;
  });
  h.create.mockImplementation(async (input: Stripe.Checkout.SessionCreateParams, { idempotencyKey }: { idempotencyKey: string }) => {
    let session = h.byKey.get(idempotencyKey);
    if (!session) {
      session = { id: `cs_${h.sessions.size + 1}`, customer: input.customer, metadata: input.metadata, mode: input.mode,
        price: input.line_items![0].price, status: 'open', url: 'https://checkout.stripe.test/session' };
      h.sessions.set(session.id, session); h.byKey.set(idempotencyKey, session);
    }
    if (h.lostCreateResponse) { h.lostCreateResponse = false; throw Error('response lost'); }
    return session;
  });
});
afterEach(() => vi.useRealTimers());

describe('one durable outstanding Checkout per owner', () => {
  it('reuses the same open session after the old five-minute idempotency boundary', async () => {
    const first = await getOrCreateCheckoutSession('owner', stripe, params());
    vi.advanceTimersByTime(6 * 60 * 1000);
    const second = await getOrCreateCheckoutSession('owner', stripe, params());
    expect(second.id).toBe(first.id); expect(h.create).toHaveBeenCalledOnce();
    expect(h.records.get(path).sessionId).toBe(first.id);
  });
  it('expires a monthly session before creating a yearly replacement', async () => {
    const monthly = await getOrCreateCheckoutSession('owner', stripe, params());
    const yearly = await getOrCreateCheckoutSession('owner', stripe, params('price_year'));
    expect(yearly.id).not.toBe(monthly.id); expect(h.sessions.get(monthly.id).status).toBe('expired');
    expect([...h.sessions.values()].filter(session => session.status === 'open')).toHaveLength(1);
    expect(h.expire.mock.invocationCallOrder[0]).toBeLessThan(h.create.mock.invocationCallOrder[1]);
  });
  it('replays identical persisted parameters/key when creation succeeded but its response was lost', async () => {
    h.lostCreateResponse = true;
    await expect(getOrCreateCheckoutSession('owner', stripe, params())).rejects.toThrow('response lost');
    vi.advanceTimersByTime(6 * 60 * 1000);
    const session = await getOrCreateCheckoutSession('owner', stripe, params());
    expect(session.id).toBe('cs_1'); expect(h.sessions.size).toBe(1);
    expect(h.create.mock.calls[1]).toEqual(h.create.mock.calls[0]);
  });
  it('recovers a session after the final state write failed without creating another', async () => {
    h.failStateSave = true;
    await expect(getOrCreateCheckoutSession('owner', stripe, params())).rejects.toThrow('database unavailable');
    h.failStateSave = false;
    expect((await getOrCreateCheckoutSession('owner', stripe, params())).id).toBe('cs_1');
    expect(h.sessions.size).toBe(1); expect(h.create.mock.calls[1]).toEqual(h.create.mock.calls[0]);
  });
  it('does not replay an unresolved attempt past the guaranteed idempotency window', async () => {
    h.lostCreateResponse = true;
    await expect(getOrCreateCheckoutSession('owner', stripe, params())).rejects.toThrow();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    await expect(getOrCreateCheckoutSession('owner', stripe, params())).rejects.toThrow('needs review');
    expect(h.create).toHaveBeenCalledOnce();
  });
  it('adopts an open session created by the previous release', async () => {
    h.sessions.set('cs_legacy', { id: 'cs_legacy', customer: 'cus_1', metadata: { firebase_uid: 'owner' },
      mode: 'subscription', status: 'open', price: 'price_month', url: 'https://checkout.stripe.test/legacy' });
    expect((await getOrCreateCheckoutSession('owner', stripe, params())).id).toBe('cs_legacy');
    expect(h.create).not.toHaveBeenCalled();
  });
  it('closes every old open checkout before creating one replacement', async () => {
    for (const id of ['cs_old_1', 'cs_old_2']) h.sessions.set(id, { id, customer: 'cus_1', metadata: {},
      mode: 'subscription', status: 'open', price: 'price_month', url: 'https://checkout.stripe.test/old' });
    await getOrCreateCheckoutSession('owner', stripe, params());
    expect(h.expire).toHaveBeenCalledTimes(2); expect(h.create).toHaveBeenCalledOnce();
    expect([...h.sessions.values()].filter(session => session.status === 'open')).toHaveLength(1);
  });
  it('does not create another when completion beats session expiration', async () => {
    await getOrCreateCheckoutSession('owner', stripe, params());
    h.expire.mockRejectedValue(Error('session already completed'));
    await expect(getOrCreateCheckoutSession('owner', stripe, params('price_year'))).rejects.toThrow('completed');
    expect(h.create).toHaveBeenCalledOnce();
  });
  it('rechecks subscriptions after expired/closed session lookup', async () => {
    const first = await getOrCreateCheckoutSession('owner', stripe, params());
    h.sessions.get(first.id).status = 'complete';
    h.subscriptions = [{ status: 'active', items: { data: [{ price: { id: 'price_month' } }] } }];
    await expect(getOrCreateCheckoutSession('owner', stripe, params('price_year'))).rejects.toThrow('existing subscription');
    expect(h.create).toHaveBeenCalledOnce();
  });
  it('fails closed on incomplete pagination instead of missing another open session', async () => {
    h.list.mockResolvedValue({ data: [], has_more: true });
    await expect(getOrCreateCheckoutSession('owner', stripe, params())).rejects.toThrow('needs review');
    expect(h.create).not.toHaveBeenCalled();
  });
  it('never expires another owner or unrelated product checkout', async () => {
    h.sessions.set('cs_other', { id: 'cs_other', customer: 'cus_1', metadata: { firebase_uid: 'another' },
      mode: 'subscription', status: 'open', price: 'price_year' });
    await expect(getOrCreateCheckoutSession('owner', stripe, params())).rejects.toThrow('ownership');
    h.sessions.get('cs_other').metadata = {}; h.sessions.get('cs_other').price = 'price_unrelated';
    await expect(getOrCreateCheckoutSession('owner', stripe, params())).rejects.toThrow('existing checkout');
    expect(h.expire).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
  });
});
