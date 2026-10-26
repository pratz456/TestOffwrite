import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { QueryClient } from '@tanstack/react-query';

const holder = vi.hoisted(() => ({
  client: null as import('@tanstack/react-query').QueryClient | null,
  signOutUser: vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null })),
}));
const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void | (() => void)>,
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [harness.slots[index], (next: unknown) => {
        harness.slots[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(harness.slots[index]) : next;
      }];
    },
    useRef(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = { current: initial };
      return harness.slots[index];
    },
    useEffect(effect: () => void | (() => void), dependencies?: unknown[]) {
      const index = harness.cursor++;
      const previous = harness.slots[index] as unknown[] | undefined;
      const changed = !dependencies || !previous || previous.length !== dependencies.length
        || previous.some((value, position) => !Object.is(value, dependencies[position]));
      if (!changed) return;
      harness.slots[index] = dependencies;
      harness.effects.push(effect);
    },
  };
});
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return { ...actual, useMutation: (options: unknown) => options, useQueryClient: () => holder.client };
});
vi.mock('@/lib/firebase/auth', () => ({ signOutUser: () => holder.signOutUser(), waitForAuth: vi.fn() }));
vi.mock('@/lib/firebase/client', () => ({ auth: { currentUser: null }, db: {}, app: {} }));
vi.mock('firebase/auth', () => ({ onIdTokenChanged: () => () => {}, getAuth: () => ({ currentUser: null }) }));

import { QueryClient } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/firebase/auth-context';
import { QueryCacheAuthSync } from '@/lib/react-query/auth-cache';
import { queryKeys as accountQueryKeys } from '@/lib/firebase/hooks';
import { queryKeys as profileQueryKeys } from '@/lib/react-query/hooks';
import { useUpdateTransaction } from '@/lib/firebase/mutations';

const userA = 'user-a';
const userB = 'user-b';
const transactionId = 'tx-1';
const transaction = {
  id: transactionId, trans_id: transactionId, merchant_name: 'Cafe', amount: 12,
  category: 'Meals', date: '2026-09-16', notes: 'private',
};
const transactions = [transaction];
const profile = { name: 'Account A' };

function createClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  holder.client = client;
  return client;
}
function resetHarness() {
  harness.slots = [];
  harness.cursor = 0;
  harness.effects = [];
}
function seed(client: QueryClient, userId: string) {
  client.setQueryData(accountQueryKeys.transactions(userId), transactions);
  client.setQueryData(profileQueryKeys.userProfile(userId), profile);
  client.setQueryData(accountQueryKeys.transaction(userId, transactionId), transaction);
}
function expectAccountEntries(client: QueryClient, userId: string) {
  expect(client.getQueryData(accountQueryKeys.transactions(userId))).toEqual(transactions);
  expect(client.getQueryData(profileQueryKeys.userProfile(userId))).toEqual(profile);
  expect(client.getQueryData(accountQueryKeys.transaction(userId, transactionId))).toEqual(transaction);
}
function expectNoAccountEntries(client: QueryClient, userId: string) {
  expect(client.getQueryCache().getAll()).toEqual([]);
  expect(client.getQueryData(accountQueryKeys.transactions(userId))).toBeUndefined();
  expect(client.getQueryData(profileQueryKeys.userProfile(userId))).toBeUndefined();
  expect(client.getQueryData(accountQueryKeys.transaction(userId, transactionId))).toBeUndefined();
  expect(client.getQueryCache().getAll().some(query => query.queryKey.includes(userId))).toBe(false);
}
function track(client: QueryClient) {
  const order: string[] = [];
  const cancelQueries = client.cancelQueries.bind(client);
  const clear = client.clear.bind(client);
  client.cancelQueries = ((...args: Parameters<QueryClient['cancelQueries']>) => {
    order.push('cancel');
    return cancelQueries(...args);
  }) as QueryClient['cancelQueries'];
  client.clear = ((...args: Parameters<QueryClient['clear']>) => {
    order.push('clear');
    return clear(...args);
  }) as QueryClient['clear'];
  return order;
}
async function flush() {
  for (let step = 0; step < 20; step += 1) await Promise.resolve();
}
async function renderUid(uid: string | null) {
  harness.cursor = 0;
  harness.effects = [];
  QueryCacheAuthSync({ uid });
  for (const effect of harness.effects.splice(0)) effect();
  await flush();
}
function signOutFromProvider() {
  harness.cursor = 0;
  harness.effects = [];
  const element = AuthProvider({ children: null }) as ReactElement<{ value: { signOut: () => Promise<void> } }>;
  return element.props.value.signOut;
}

beforeEach(() => {
  resetHarness();
  holder.signOutUser.mockReset();
  holder.signOutUser.mockResolvedValue({ error: null });
  createClient();
});

describe('query cache follows the signed-in account', () => {
  it('empties transactions, profile, and transaction cache entries after sign-out', async () => {
    const client = holder.client!;
    seed(client, userA);
    const order = track(client);
    let emptyBeforeAuthReturns = false;
    holder.signOutUser.mockImplementation(async () => {
      emptyBeforeAuthReturns = client.getQueryCache().getAll().length === 0;
      return { error: null };
    });
    await signOutFromProvider()();
    expect(holder.signOutUser).toHaveBeenCalledOnce();
    expect(emptyBeforeAuthReturns).toBe(true);
    expect(order).toEqual(['cancel', 'clear']);
    expectNoAccountEntries(client, userA);

    const listenerClient = createClient();
    seed(listenerClient, userA);
    resetHarness();
    await renderUid(userA);
    expectAccountEntries(listenerClient, userA);
    const listenerOrder = track(listenerClient);
    await renderUid(null);
    expect(listenerOrder).toEqual(['cancel', 'clear']);
    expectNoAccountEntries(listenerClient, userA);
  });

  it('empties the cache when uid A changes to uid B', async () => {
    const client = holder.client!;
    seed(client, userA);
    await renderUid(userA);
    expectAccountEntries(client, userA);
    const order = track(client);
    await renderUid(userB);
    expect(order).toEqual(['cancel', 'clear']);
    expectNoAccountEntries(client, userA);
    expect(client.getQueryData(accountQueryKeys.transaction(userB, transactionId))).toBeUndefined();
  });

  it('does not clear the cache on first load or a same uid update', async () => {
    const client = holder.client!;
    seed(client, userA);
    const order = track(client);
    await renderUid(null);
    await renderUid(userA);
    await renderUid(userA);
    expect(order).toEqual([]);
    expectAccountEntries(client, userA);

    const restored = createClient();
    seed(restored, userA);
    resetHarness();
    const restoredOrder = track(restored);
    await renderUid(userA);
    await renderUid(userA);
    const refreshed = createClient();
    for (const query of restored.getQueryCache().getAll()) refreshed.setQueryData(query.queryKey, query.state.data);
    holder.client = refreshed;
    const refreshedOrder = track(refreshed);
    await renderUid(userA);
    expect(restoredOrder).toEqual([]);
    expect(refreshedOrder).toEqual([]);
    expectAccountEntries(restored, userA);
    expectAccountEntries(refreshed, userA);
  });
});

describe('transaction cache key includes the uid', () => {
  it('applies and rolls back an optimistic update under the uid transaction key', async () => {
    const client = holder.client!;
    const userId = userA;
    const original = { ...transaction };
    const updates = { notes: 'Client meeting' };
    client.setQueryData(accountQueryKeys.transactions(userId), [original]);
    client.setQueryData(accountQueryKeys.transaction(userId, transactionId), original);
    expect(accountQueryKeys.transaction(userId, transactionId)).toEqual(['transaction', userId, transactionId]);
    expect(accountQueryKeys.transaction(userB, transactionId)).toEqual(['transaction', userB, transactionId]);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mutation = useUpdateTransaction() as unknown as {
      onMutate: (value: { transactionId: string; userId: string; updates: { notes: string } }) => Promise<{
        previousTransaction: typeof original;
        userId: string;
        transactionId: string;
      }>;
      onError: (error: Error, value: { transactionId: string; userId: string; updates: { notes: string } }, context: {
        previousTransaction: typeof original;
        userId: string;
        transactionId: string;
      }) => void;
    };
    const args = { transactionId, userId, updates };
    const context = await mutation.onMutate(args);
    expect(client.getQueryData(accountQueryKeys.transaction(userId, transactionId))).toMatchObject({ ...original, ...updates });
    expect(client.getQueryData<typeof original[]>(accountQueryKeys.transactions(userId))?.[0]).toMatchObject(updates);
    mutation.onError(new Error('save failed'), args, context);
    expect(client.getQueryData(accountQueryKeys.transaction(userId, transactionId))).toEqual(original);
    expect(client.getQueryData(accountQueryKeys.transactions(userId))).toEqual([original]);
  });
});
