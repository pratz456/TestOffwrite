import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const holder = vi.hoisted(() => ({
  client: null as import('@tanstack/react-query').QueryClient | null,
  signOut: (async () => {}) as () => Promise<void>,
  push: vi.fn(),
  events: [] as Array<{ call: 'signOutUser' | 'auth.signOut'; empty: boolean }>,
  signOutUser: vi.fn(async (): Promise<{ error: { message: string } | null }> => ({ error: null })),
  authSignOut: vi.fn(async () => {}),
}));
const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void | (() => void)>,
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const hooks = {
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
  return { ...actual, ...hooks, default: { ...(actual as { default?: object }).default, ...hooks } };
});
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return { ...actual, useQueryClient: () => holder.client };
});
vi.mock('@/lib/firebase/auth', () => ({ signOutUser: () => holder.signOutUser(), waitForAuth: vi.fn() }));
vi.mock('@/lib/firebase/client', () => ({
  auth: {
    currentUser: { uid: 'user-a', getIdToken: async () => 'token' },
    signOut: () => holder.authSignOut(),
  },
  db: {},
  app: {},
}));
vi.mock('@/lib/firebase/auth-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/firebase/auth-context')>('@/lib/firebase/auth-context');
  return {
    ...actual,
    useAuth: () => ({ user: { id: 'user-a', email: 'a@example.test' }, loading: false, signOut: () => holder.signOut() }),
  };
});
vi.mock('@/lib/firebase/profiles', () => ({
  getUserProfile: async () => ({ data: { name: 'Account A', email: 'a@example.test', filing_status: 'single' }, error: null }),
}));
vi.mock('@/lib/firebase/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/lib/firebase/hooks')>('@/lib/firebase/hooks');
  return { ...actual, useTransactions: () => ({ transactions: [], isLoading: false, error: null }) };
});
vi.mock('@/lib/hooks/use-transaction-polling', () => ({
  useTransactionPolling: () => ({ isSyncing: false, lastSyncTime: null, syncNow: () => {} }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: holder.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/dashboard-screen', () => ({ default: function DashboardScreen() { return null; } }));

import { QueryClient } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/firebase/auth-context';
import { queryKeys as accountQueryKeys } from '@/lib/firebase/hooks';
import { queryKeys as profileQueryKeys } from '@/lib/react-query/hooks';
import { Dashboard } from '@/components/dashboard';
import ProtectedPage from '@/app/protected/page';

const userA = 'user-a';
const transactionId = 'tx-1';
const transaction = { id: transactionId, trans_id: transactionId, notes: 'private' };

function resetHarness() {
  harness.slots = [];
  harness.cursor = 0;
  harness.effects = [];
}
function cacheEmpty() {
  return holder.client!.getQueryCache().getAll().length === 0;
}
function seed() {
  const client = holder.client!;
  client.setQueryData(accountQueryKeys.transactions(userA), [transaction]);
  client.setQueryData(profileQueryKeys.userProfile(userA), { name: 'Account A' });
  client.setQueryData(accountQueryKeys.transaction(userA, transactionId), transaction);
}
function installSignOut() {
  resetHarness();
  holder.client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const element = AuthProvider({ children: null }) as ReactElement<{ value: { signOut: () => Promise<void> } }>;
  holder.signOut = element.props.value.signOut;
  resetHarness();
}
async function flush() {
  for (let step = 0; step < 20; step += 1) await Promise.resolve();
}
async function renderLoaded(render: () => unknown) {
  harness.cursor = 0;
  harness.effects = [];
  render();
  const effects = harness.effects.splice(0);
  for (const effect of effects) effect();
  await flush();
  harness.cursor = 0;
  harness.effects = [];
  return render();
}
function walk(node: unknown): Array<{ props?: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (node && typeof node === 'object' && 'props' in node) {
    const element = node as { props?: Record<string, unknown> };
    return [element, ...walk(element.props?.children)];
  }
  return [];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object' && 'props' in node) return text((node as { props?: { children?: unknown } }).props?.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}

beforeEach(() => {
  holder.events = [];
  holder.push.mockReset();
  holder.signOutUser.mockReset();
  holder.authSignOut.mockReset();
  holder.signOutUser.mockImplementation(async () => {
    holder.events.push({ call: 'signOutUser', empty: cacheEmpty() });
    await holder.authSignOut();
    return { error: null };
  });
  holder.authSignOut.mockImplementation(async () => {
    holder.events.push({ call: 'auth.signOut', empty: cacheEmpty() });
  });
  installSignOut();
  seed();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ transactions: [] })));
  vi.stubGlobal('window', { location: { href: '/protected' } });
  vi.stubGlobal('React', { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: { ...(props as object), children } }) });
});

describe('sign-out screens clear cached data first', () => {
  it('clears the query cache before auth.signOut from the dashboard', async () => {
    const tree = await renderLoaded(() => Dashboard({ user: { id: userA, email: 'a@example.test' } }));
    const button = walk(tree).find(node => typeof node.props?.onClick === 'function' && text(node).includes('Sign Out'));
    expect(button).toBeDefined();
    await (button!.props!.onClick as () => Promise<void>)();
    expect(holder.events).toEqual([
      { call: 'signOutUser', empty: true },
      { call: 'auth.signOut', empty: true },
    ]);
    expect(cacheEmpty()).toBe(true);
  });

  it('clears the query cache before signOutUser from the protected page', async () => {
    const tree = await renderLoaded(() => ProtectedPage({}));
    const screen = walk(tree).find(node => typeof node.props?.onSignOut === 'function');
    expect(screen).toBeDefined();
    await (screen!.props!.onSignOut as () => Promise<void>)();
    expect(holder.events).toEqual([
      { call: 'signOutUser', empty: true },
      { call: 'auth.signOut', empty: true },
    ]);
    expect(holder.push).toHaveBeenCalledWith('/');
    expect(cacheEmpty()).toBe(true);
  });
});
