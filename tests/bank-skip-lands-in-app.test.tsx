import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => ({
  slots: [] as any[], cursor: 0, effects: [] as (() => void)[],
  request: vi.fn(), upsert: vi.fn(),
  profile: undefined as Record<string, unknown> | undefined,
  bankConsents: [] as Record<string, unknown>[],
  auth: vi.fn(), exchange: vi.fn(), accounts: vi.fn(), remove: vi.fn(), save: vi.fn(), sync: vi.fn(),
  begin: vi.fn(), retain: vi.fn(), finish: vi.fn(), unresolved: vi.fn(), owner: vi.fn(), quarantine: vi.fn(),
  historyReady: vi.fn(), reconnectCanLink: vi.fn(), saveReconnect: vi.fn(),
}));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial: unknown) {
      const index = h.cursor++;
      if (!(index in h.slots)) h.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [h.slots[index], (next: unknown) => { h.slots[index] = typeof next === 'function' ? next(h.slots[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = h.cursor++;
      if (!(index in h.slots)) h.slots[index] = { current: initial };
      return h.slots[index];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = h.cursor++;
      if (!same(h.slots[index]?.deps, deps)) h.slots[index] = { deps, callback };
      return h.slots[index].callback;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = h.cursor++; const previous = h.slots[index];
      if (!same(previous?.deps, deps)) {
        const next: any = { deps }; h.slots[index] = next;
        h.effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
      }
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: h.request }));
vi.mock('@/lib/firebase/profiles', () => ({ upsertUserProfile: h.upsert }));
vi.mock('@/lib/onboarding/profile-identity', () => ({ reloadProfileEmail: async () => 'person@example.test' }));
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    doc: () => ({
      get: async () => ({ exists: h.profile !== undefined, data: () => h.profile }),
    }),
    collection: () => ({
      where: () => ({ get: async () => ({ docs: [] }) }),
      get: async () => ({ docs: h.bankConsents.map(data => ({ data: () => data })) }),
      doc: () => ({ create: async (data: Record<string, unknown>) => { h.bankConsents.push({ ...data }); } }),
    }),
  },
  FieldValue: { serverTimestamp: () => 'server-time', delete: () => 'delete-field' },
}));
vi.mock('@/components/plaid-link-screen', () => {
  const React = require('react');
  return {
    PlaidLinkScreen: (props: { onSkip?: () => void }) => React.createElement('button', { type: 'button', onClick: props.onSkip }, 'Not now'),
  };
});
vi.mock('@/lib/plaid/reconnect', () => ({ assertReconnectCanLink: h.reconnectCanLink, saveReconnectConnection: h.saveReconnect }));
vi.mock('@/lib/plaid/history-review', () => ({
  assertBankHistoryReadyForNewConnection: h.historyReady,
  BANK_HISTORY_REVIEW_REQUIRED: 'BANK_HISTORY_REVIEW_REQUIRED',
  BANK_HISTORY_REVIEW_MESSAGE: 'Review saved bank history with WriteOff support.',
}));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: h.auth }));
vi.mock('@/lib/plaid/client', () => ({ plaidClient: { itemPublicTokenExchange: h.exchange, accountsGet: h.accounts, itemRemove: h.remove } }));
vi.mock('@/lib/plaid/connections', () => ({ assertPlaidTokenEncryptionConfigured() {}, savePlaidConnection: h.save }));
vi.mock('@/lib/plaid/sync-helper', () => ({ syncUserTransactionsIncremental: h.sync }));
vi.mock('@/lib/plaid/link-operations', () => ({
  ACCOUNT_DELETION_IN_PROGRESS: 'ACCOUNT_DELETION_IN_PROGRESS', beginPlaidLinkOperation: h.begin,
  retainPlaidLinkRecovery: h.retain, finishPlaidLinkOperation: h.finish, markPlaidLinkOperationUnresolved: h.unresolved,
  existingPlaidLinkOwner: h.owner, quarantinePlaidLinkRecovery: h.quarantine,
}));

import { ProfileSetupScreen } from '@/components/profile-setup-screen';
import { DataSourceScreen } from '@/components/data-source-screen';
import { PlaidLinkScreen } from '@/components/plaid-link-screen';
import { buildConsentRecord } from '@/lib/onboarding/consents';
import { PROFILE_COMPLETE_SCREEN } from '@/lib/onboarding/profile';
import { POST as exchangePublicToken } from '@/app/api/plaid/exchange-public-token/route';

type Element = ReactElement<Record<string, any>>;
const walk = (node: any): Element[] => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';

const user = { id: 'owner', email: 'person@example.test' };
const existingConsents = buildConsentRecord(
  { terms: true, ai_review: true, communications: false, document_import: false },
  'sign-up',
  new Date('2026-09-17T12:00:00.000Z'),
)!;
const onComplete = vi.fn();

function render(): Element {
  h.cursor = 0;
  let tree: any = (ProfileSetupScreen as unknown as (props: any) => Element)({
    user, existingConsents, onBack() {}, onComplete,
  });
  h.effects.splice(0).forEach(effect => effect());
  if (tree?.type === DataSourceScreen) {
    tree = tree.type(tree.props);
    h.effects.splice(0).forEach(effect => effect());
  }
  if (tree?.type === PlaidLinkScreen) tree = tree.type(tree.props);
  return tree;
}

const control = (tree: Element, id: string) => {
  const node = walk(tree).find(item => item.props?.id === id);
  if (!node) throw new Error(`missing control ${id}`);
  return node;
};
const clickLabel = (tree: Element, label: string) => {
  const node = walk(tree).find(item => typeof item.props?.onClick === 'function' && text(item).includes(label));
  if (!node) throw new Error(`missing action ${label}; saw ${text(tree).slice(0, 240)}`);
  return node.props.onClick();
};

beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = [];
  h.profile = undefined;
  h.bankConsents = [];
  h.request.mockReset();
  h.upsert.mockReset();
  h.upsert.mockResolvedValue({ error: null });
  h.request.mockResolvedValue(Response.json({ success: true }));
  onComplete.mockReset();
  vi.stubGlobal('window', {
    addEventListener() {},
    removeEventListener() {},
    location: { origin: 'https://writeoff.test', href: 'https://writeoff.test/protected/profile-setup', search: '' },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  h.auth.mockResolvedValue({ uid: 'owner' });
});

describe('skipping the bank step during sign-up', () => {
  it('lands in the app with no bank consent stored, and the exchange route rejects that account', async () => {
    let tree = render();
    expect(text(tree)).toContain('About you');
    control(tree, 'profile-name').props.onChange({ target: { value: 'Ada Lovelace' } });
    control(tree, 'profile-state').props.onChange({ target: { value: 'California' } });
    control(tree, 'profile-filingStatus').props.onChange({ target: { value: 'Single' } });
    tree = render();
    await clickLabel(tree, 'Next');
    tree = render();
    control(tree, 'profile-profession').props.onChange({ target: { value: 'Consultant' } });
    control(tree, 'profile-businessEntityType').props.onChange({ target: { value: 'Sole Proprietor / Independent Contractor' } });
    control(tree, 'profile-primaryWorkLocation').props.onChange({ target: { value: 'Home Office' } });
    control(tree, 'profile-income').props.onChange({ target: { value: 'Under $11,600' } });
    tree = render();
    await clickLabel(tree, 'Next');
    tree = render();
    await clickLabel(tree, 'Save and continue');
    tree = render();
    expect(text(tree)).toContain('How do you want to add your data?');
    await clickLabel(tree, 'Connect Bank Account');
    tree = render();
    await clickLabel(tree, 'Connect Bank with Plaid');
    tree = render();
    expect(text(tree)).toBe('Not now');
    await clickLabel(tree, 'Not now');

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Ada Lovelace', email: 'person@example.test', state: 'California',
    }), PROFILE_COMPLETE_SCREEN);
    expect(PROFILE_COMPLETE_SCREEN).toBe('dashboard');
    expect(h.request).not.toHaveBeenCalled();
    expect(h.bankConsents).toEqual([]);
    expect(h.profile).toBeUndefined();

    const response = await exchangePublicToken(new Request('https://writeoff.test/api/plaid/exchange-public-token', {
      method: 'POST', body: JSON.stringify({ public_token: 'public-sandbox-test' }),
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Acknowledge how WriteOff uses bank transactions before connecting a bank.' });
    expect(h.exchange).not.toHaveBeenCalled();
    expect(h.begin).not.toHaveBeenCalled();
    expect(h.bankConsents).toEqual([]);
  });
});
