import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// Runs the real UI request/state handlers. This is not a browser rendering test.
const harness = vi.hoisted(() => {
  const navigate = vi.fn(); const replace = vi.fn();
  return {
    slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn(), navigate, replace,
    // Stable like the real app router; a fresh object each render would re-run mount effects.
    router: { push: navigate, replace, back: navigate },
    upsert: vi.fn(), signUp: vi.fn(), google: vi.fn(), redirectResult: vi.fn(),
  };
});
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
vi.mock('@/lib/firebase/profiles', () => ({ upsertUserProfile: harness.upsert }));
vi.mock('@/lib/onboarding/profile-identity', () => ({ reloadProfileEmail: () => new Promise(() => {}) }));
vi.mock('@/lib/firebase/auth', () => ({ signUpUser: harness.signUp, signInWithGoogle: harness.google, handleAuthRedirectResult: harness.redirectResult }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/lib/firebase/client', () => ({ auth: { currentUser: null } }));
vi.mock('@/public/writeofflogo.png', () => ({ default: { src: '/writeofflogo.png', width: 1, height: 1 } }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => harness.router }));
vi.mock('../components/plaid-link-screen', () => ({ PlaidLinkScreen: () => null }));
vi.mock('../components/data-source-screen', () => ({ DataSourceScreen: () => null }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [harness.slots[index], (next: unknown) => { harness.slots[index] = typeof next === 'function' ? next(harness.slots[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = { current: initial };
      return harness.slots[index];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = harness.cursor++;
      if (!same(harness.slots[index]?.deps, deps)) harness.slots[index] = { deps, callback };
      return harness.slots[index].callback;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = harness.cursor++; const previous = harness.slots[index];
      if (!same(previous?.deps, deps)) {
        const next: any = { deps }; harness.slots[index] = next;
        harness.effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
      }
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});

import {
  buildConsentRecord, CONSENT_TERMS_VERSION, hasAcknowledgedRequiredConsents, hasDocumentImportConsent, parseConsentRecord, PENDING_CONSENTS_KEY,
  PENDING_CONSENTS_TTL_MS, readPendingConsents, signDocumentImportConsent, stashPendingConsents, withdrawDocumentImportConsent, type ConsentRecord,
} from '../lib/onboarding/consents';
import { DOCUMENT_IMPORT_CONSENT_TEXT, DOCUMENT_IMPORT_CONSENT_VERSION } from '../lib/onboarding/document-import-consent';
import { CONSENT_SAVE_ERROR } from '../lib/onboarding/consents-client';
import { ProfileSetupScreen } from '../components/profile-setup-screen';
import { SignUpForm } from '../components/sign-up-form';
import { ConsentCheckboxes, NoticeAtCollection } from '../components/onboarding/consent-checkboxes';

type Element = ReactElement<Record<string, any>>;
function walk(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  return node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

const validRecord: ConsentRecord = {
  version: CONSENT_TERMS_VERSION, source: 'sign-up', accepted_at: '2026-09-17T12:00:00.000Z',
  bank_data: true, ai_review: true, communications: true, document_import: false,
};

describe('consent record allowlist', () => {
  it('accepts and normalizes a complete record of the current terms', () => {
    expect(parseConsentRecord({ ...validRecord, accepted_at: '2026-09-17T12:00:00Z' })).toEqual(validRecord);
    expect(parseConsentRecord({ version: CONSENT_TERMS_VERSION, source: 'profile-setup', accepted_at: validRecord.accepted_at, bank_data: true, ai_review: true }))
      .toMatchObject({ source: 'profile-setup', communications: false });
    expect(hasAcknowledgedRequiredConsents(validRecord)).toBe(true);
  });
  it.each([
    ['null', null],
    ['an array', [validRecord]],
    ['an unknown key', { ...validRecord, marketing_partner: true }],
    ['a missing required acknowledgment', { ...validRecord, ai_review: undefined }],
    ['a declined required acknowledgment', { ...validRecord, bank_data: false }],
    ['a stale terms version', { ...validRecord, version: '2025-01-01' }],
    ['an unknown source', { ...validRecord, source: 'import' }],
    ['a non-date acceptance time', { ...validRecord, accepted_at: 'yesterday' }],
    ['a non-boolean optional acknowledgment', { ...validRecord, communications: 'yes' }],
  ])('rejects %s', (_label, input) => {
    expect(parseConsentRecord(input)).toBeNull();
    expect(hasAcknowledgedRequiredConsents(input)).toBe(false);
  });
  it('builds a record only once both required acknowledgments are checked', () => {
    const now = new Date('2026-09-17T15:30:00.000Z');
    expect(buildConsentRecord({ bank_data: true, ai_review: false, communications: true, document_import: false }, 'sign-up', now)).toBeNull();
    expect(buildConsentRecord({ bank_data: true, ai_review: true, communications: false, document_import: false }, 'profile-setup', now))
      .toEqual({ version: CONSENT_TERMS_VERSION, source: 'profile-setup', accepted_at: now.toISOString(), bank_data: true, ai_review: true, communications: false, document_import: false });
  });
  it('never records the §7216 document consent from sign-up choices alone', () => {
    const record = buildConsentRecord({ bank_data: true, ai_review: true, communications: false, document_import: true }, 'sign-up');
    expect(record).toMatchObject({ document_import: false });
    expect(record).not.toHaveProperty('document_import_signature');
  });
});

describe('§7216 document-image consent inside the consent record', () => {
  const signedAt = new Date('2026-09-18T09:00:00.000Z');
  it('is signed by typing a name, read back as consent, and withdrawn without touching the other acknowledgments', () => {
    expect(hasDocumentImportConsent(validRecord)).toBe(false);
    expect(signDocumentImportConsent(validRecord, '   ', signedAt)).toBeNull();
    expect(signDocumentImportConsent({ ...validRecord, version: '2025-01-01' }, 'Synthetic Signer', signedAt)).toBeNull();
    const signed = signDocumentImportConsent(validRecord, '  Synthetic Signer  ', signedAt)!;
    expect(signed).toEqual({ ...validRecord, document_import: true,
      document_import_signature: { version: DOCUMENT_IMPORT_CONSENT_VERSION, signed_name: 'Synthetic Signer', signed_at: signedAt.toISOString() } });
    expect(parseConsentRecord(signed)).toEqual(signed);
    expect(hasDocumentImportConsent(signed)).toBe(true);
    expect(hasAcknowledgedRequiredConsents(signed)).toBe(true);
    const withdrawn = withdrawDocumentImportConsent(signed)!;
    expect(withdrawn).toEqual(validRecord);
    expect(hasDocumentImportConsent(withdrawn)).toBe(false);
    expect(withdrawDocumentImportConsent(null)).toBeNull();
  });
  it.each([
    ['no signature', { ...validRecord, document_import: true }],
    ['a blank signed name', { ...validRecord, document_import: true, document_import_signature: { version: DOCUMENT_IMPORT_CONSENT_VERSION, signed_name: ' ', signed_at: signedAt.toISOString() } }],
    ['a non-date signing time', { ...validRecord, document_import: true, document_import_signature: { version: DOCUMENT_IMPORT_CONSENT_VERSION, signed_name: 'Synthetic Signer', signed_at: 'today' } }],
    ['an unknown signature field', { ...validRecord, document_import: true, document_import_signature: { version: DOCUMENT_IMPORT_CONSENT_VERSION, signed_name: 'Synthetic Signer', signed_at: signedAt.toISOString(), ip: '10.0.0.1' } }],
    ['a non-boolean document_import', { ...validRecord, document_import: 'yes' }],
  ])('rejects document_import: true with %s', (_label, input) => {
    expect(parseConsentRecord(input)).toBeNull();
    expect(hasDocumentImportConsent(input)).toBe(false);
  });
  it('reads a signature of an earlier consent text as no consent, not as a broken record', () => {
    const stale = { ...validRecord, document_import: true, document_import_signature: { version: '2026-01-01', signed_name: 'Synthetic Signer', signed_at: signedAt.toISOString() } };
    expect(parseConsentRecord(stale)).toEqual(validRecord);
    expect(hasAcknowledgedRequiredConsents(stale)).toBe(true);
    expect(hasDocumentImportConsent(stale)).toBe(false);
    const inert = { ...validRecord, document_import: false, document_import_signature: { version: DOCUMENT_IMPORT_CONSENT_VERSION, signed_name: 'Synthetic Signer', signed_at: signedAt.toISOString() } };
    expect(parseConsentRecord(inert)).toEqual(validRecord);
  });
  it('keeps the drafted Rev. Proc. 2013-14 wording verbatim with the mandatory statements and blanks', () => {
    expect(DOCUMENT_IMPORT_CONSENT_TEXT.startsWith('CONSENT TO DISCLOSURE OF TAX RETURN INFORMATION')).toBe(true);
    expect(DOCUMENT_IMPORT_CONSENT_TEXT).toContain('Federal law requires this consent form be provided to you.');
    expect(DOCUMENT_IMPORT_CONSENT_TEXT).toContain('You are not required to complete this form.');
    expect(DOCUMENT_IMPORT_CONSENT_TEXT).toContain('Duration: this consent is valid until you delete your WriteOff account or\nwithdraw it in Settings, whichever is earlier.');
    expect(DOCUMENT_IMPORT_CONSENT_TEXT).toContain('Treasury Inspector General for Tax Administration (TIGTA)');
    expect(DOCUMENT_IMPORT_CONSENT_TEXT).toContain('[type your full name]');
    expect(DOCUMENT_IMPORT_CONSENT_TEXT).toContain("[today's date]");
    expect(DOCUMENT_IMPORT_CONSENT_TEXT).not.toMatch(/maximi[sz]e|guarantee|file your taxes/i);
  });
});

describe('pending sign-up acknowledgments', () => {
  it('returns the stash only to the same account, case-insensitively, then clears it on use or mismatch', () => {
    const storage = memoryStorage();
    stashPendingConsents(validRecord, ' Person@Example.test ', storage, 1_000);
    expect(readPendingConsents('person@example.test', storage, 2_000)).toEqual(validRecord);
    expect(readPendingConsents('other@example.test', storage, 2_000)).toBeNull();
    expect(storage.getItem(PENDING_CONSENTS_KEY)).toBeNull();
  });
  it('expires, ignores corrupt or stale-version stashes, and never throws without storage', () => {
    const storage = memoryStorage();
    stashPendingConsents(validRecord, 'person@example.test', storage, 1_000);
    expect(readPendingConsents('person@example.test', storage, 1_000 + PENDING_CONSENTS_TTL_MS + 1)).toBeNull();
    storage.setItem(PENDING_CONSENTS_KEY, '{not json');
    expect(readPendingConsents('person@example.test', storage)).toBeNull();
    storage.setItem(PENDING_CONSENTS_KEY, JSON.stringify({ email: 'person@example.test', stashed_at: Date.now(), record: { ...validRecord, version: '2025-01-01' } }));
    expect(readPendingConsents('person@example.test', storage)).toBeNull();
    expect(readPendingConsents('person@example.test', null)).toBeNull();
    expect(() => stashPendingConsents(validRecord, 'person@example.test', null)).not.toThrow();
    expect(readPendingConsents('', storage)).toBeNull();
  });
});

describe('consent checkboxes are labeled controls', () => {
  it('pairs every checkbox with a label and marks the required ones', () => {
    const tree = ConsentCheckboxes({ values: { bank_data: true, ai_review: false, communications: false }, onChange: vi.fn(), idPrefix: 'setup' });
    const inputs = walk(tree).filter(node => node.type === 'input');
    const labels = walk(tree).filter(node => node.type === 'label');
    expect(inputs.map(node => node.props.id)).toEqual(['setup-bankConsent', 'setup-aiConsent', 'setup-commConsent']);
    expect(labels.map(node => node.props.htmlFor)).toEqual(inputs.map(node => node.props.id));
    expect(inputs.map(node => node.props['aria-required'])).toEqual([true, true, false]);
    expect(inputs.map(node => node.props.checked)).toEqual([true, false, false]);
    expect(ConsentCheckboxes({ values: { bank_data: false, ai_review: false, communications: false }, onChange: vi.fn() }).props.children.map((child: Element) => child.props.children[0].props.id))
      .toEqual(['bankConsent', 'aiConsent', 'commConsent']);
  });
});

const storage = memoryStorage();
const user = { id: 'google-user', email: 'Person@Example.test' };

beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = [];
  for (const fn of [harness.request, harness.navigate, harness.replace, harness.upsert, harness.signUp, harness.google, harness.redirectResult]) fn.mockReset();
  harness.request.mockResolvedValue(Response.json({ success: true }));
  harness.redirectResult.mockResolvedValue({ data: null, error: null });
  storage.clear();
  vi.stubGlobal('window', { localStorage: storage, history: { length: 1 } });
});
afterEach(() => vi.unstubAllGlobals());

function renderSetup(props: Record<string, unknown> = {}): Element {
  harness.cursor = 0;
  const tree = (ProfileSetupScreen as unknown as (props: any) => Element)({ user, onBack: harness.navigate, onComplete: vi.fn(), ...props });
  harness.effects.splice(0).forEach(effect => effect());
  return tree;
}
const continueButton = (tree: Element) => walk(tree).find(node => typeof node.props?.onClick === 'function' && text(node) === 'Agree and continue')!;
const checkboxes = (tree: Element) => walk(tree).find(node => node.type === ConsentCheckboxes)!;
const postedConsents = () => harness.request.mock.calls.filter(([url]) => url === '/api/database/profiles').map(([, options]) => JSON.parse(options.body).consents);

describe('profile setup collects acknowledgments before any answer is saved', () => {
  it('starts a Google account without a record on the consent step and only enables continue once both required boxes are checked', () => {
    const tree = renderSetup();
    expect(text(tree)).toContain('A few acknowledgments first');
    expect(walk(tree).some(node => node.type === NoticeAtCollection)).toBe(true);
    expect(text(NoticeAtCollection({}))).toContain('Notice at Collection');
    expect(text(tree)).not.toContain('About you');
    expect(continueButton(tree).props.disabled).toBe(true);
    checkboxes(tree).props.onChange('bank_data', true);
    expect(continueButton(renderSetup()).props.disabled).toBe(true);
    checkboxes(tree).props.onChange('ai_review', true);
    expect(continueButton(renderSetup()).props.disabled).toBe(false);
    expect(harness.request).not.toHaveBeenCalled();
  });

  it('records the acknowledgments through the profile API, then opens the profile form', async () => {
    const tree = renderSetup();
    checkboxes(tree).props.onChange('bank_data', true);
    checkboxes(tree).props.onChange('ai_review', true);
    await continueButton(renderSetup()).props.onClick();
    const next = renderSetup();
    expect(harness.request).toHaveBeenCalledExactlyOnceWith('/api/database/profiles', expect.objectContaining({ method: 'POST' }));
    expect(postedConsents()).toEqual([expect.objectContaining({ version: CONSENT_TERMS_VERSION, source: 'profile-setup', bank_data: true, ai_review: true, communications: false })]);
    expect(Date.parse(postedConsents()[0].accepted_at)).not.toBeNaN();
    expect(text(next)).toContain('About you');
    expect(text(next)).not.toContain('A few acknowledgments first');
    expect(harness.upsert).not.toHaveBeenCalled();
  });

  it('stays on the consent step with a retryable error when the record cannot be saved', async () => {
    harness.request.mockResolvedValue(Response.json({ error: 'Failed to save profile' }, { status: 503 }));
    const tree = renderSetup();
    checkboxes(tree).props.onChange('bank_data', true);
    checkboxes(tree).props.onChange('ai_review', true);
    await continueButton(renderSetup()).props.onClick();
    const next = renderSetup();
    expect(text(walk(next).find(node => node.props?.role === 'alert')!)).toBe(CONSENT_SAVE_ERROR);
    expect(text(next)).toContain('A few acknowledgments first');
    expect(continueButton(next).props.disabled).toBe(false);
    harness.request.mockResolvedValue(Response.json({ success: true }));
    await continueButton(next).props.onClick();
    expect(text(renderSetup())).toContain('About you');
  });

  it('records acknowledgments checked on the sign-up form for the same account without asking again', async () => {
    stashPendingConsents(validRecord, 'person@example.test', storage);
    renderSetup(); await flush();
    const tree = renderSetup();
    expect(postedConsents()).toEqual([validRecord]);
    expect(text(tree)).toContain('About you');
    expect(storage.getItem(PENDING_CONSENTS_KEY)).toBeNull();
  });

  it('waits for the account email to hydrate before matching a stash', async () => {
    stashPendingConsents(validRecord, 'person@example.test', storage);
    renderSetup({ user: { id: 'google-user', email: null } }); await flush();
    expect(harness.request).not.toHaveBeenCalled();
    expect(storage.getItem(PENDING_CONSENTS_KEY)).not.toBeNull();
    renderSetup(); await flush();
    expect(postedConsents()).toEqual([validRecord]);
    expect(text(renderSetup())).toContain('About you');
  });

  it('keeps a failed sign-up stash visible for retry, pre-checked, instead of skipping the step', async () => {
    harness.request.mockResolvedValue(new Response('<html>Unavailable</html>', { status: 502 }));
    stashPendingConsents(validRecord, 'person@example.test', storage);
    renderSetup(); await flush();
    const tree = renderSetup();
    expect(text(tree)).toContain('A few acknowledgments first');
    expect(checkboxes(tree).props.values).toEqual({ bank_data: true, ai_review: true, communications: true, document_import: false });
    expect(text(walk(tree).find(node => node.props?.role === 'alert')!)).toBe(CONSENT_SAVE_ERROR);
  });

  it('ignores a stash left by a different account in the same browser', async () => {
    stashPendingConsents(validRecord, 'someone-else@example.test', storage);
    renderSetup(); await flush();
    expect(text(renderSetup())).toContain('A few acknowledgments first');
    expect(harness.request).not.toHaveBeenCalled();
    expect(storage.getItem(PENDING_CONSENTS_KEY)).toBeNull();
  });

  it('skips the step when the partial profile already holds a current record, but not a stale one', async () => {
    expect(text(renderSetup({ existingConsents: validRecord }))).toContain('About you');
    expect(harness.request).not.toHaveBeenCalled();
    harness.slots = []; harness.effects = [];
    expect(text(renderSetup({ existingConsents: { ...validRecord, version: '2025-01-01' } }))).toContain('A few acknowledgments first');
  });
});

function renderSignUp(): Element {
  harness.cursor = 0;
  const tree = (SignUpForm as unknown as (props: any) => Element)({});
  harness.effects.splice(0).forEach(effect => effect());
  return tree;
}
const googleButton = (tree: Element) => walk(tree).find(node => typeof node.props?.onClick === 'function' && text(node).includes('Continue with Google'))!;
const stashed = () => JSON.parse(storage.getItem(PENDING_CONSENTS_KEY) ?? 'null');

describe('sign-up form carries acknowledgments into profile setup', () => {
  it('binds checked boxes to the Google account that signs in and continues to profile setup', async () => {
    harness.google.mockResolvedValue({ data: { user: { id: 'google-user', email: 'Person@Example.test' } }, error: null });
    renderSignUp(); await flush();
    const tree = renderSignUp();
    checkboxes(tree).props.onChange('bank_data', true);
    checkboxes(tree).props.onChange('ai_review', true);
    checkboxes(tree).props.onChange('communications', true);
    await googleButton(renderSignUp()).props.onClick();
    expect(harness.navigate).toHaveBeenCalledWith('/protected/profile-setup');
    expect(stashed()).toMatchObject({ email: 'person@example.test', record: { version: CONSENT_TERMS_VERSION, source: 'sign-up', bank_data: true, ai_review: true, communications: true } });
    expect(readPendingConsents('person@example.test', storage)).toMatchObject({ source: 'sign-up', communications: true });
  });

  it('still lets Google continue without the boxes so setup can collect them post-auth', async () => {
    harness.google.mockResolvedValue({ data: { user: { id: 'google-user', email: 'person@example.test' } }, error: null });
    renderSignUp(); await flush();
    const tree = renderSignUp();
    expect(googleButton(tree).props.disabled).toBe(false);
    expect(text(tree)).toContain('we ask for them before profile setup');
    await googleButton(tree).props.onClick();
    expect(harness.navigate).toHaveBeenCalledWith('/protected/profile-setup');
    expect(stashed()).toBeNull();
  });

  it('requires the acknowledgments for email sign-up and stashes them for the verified account', async () => {
    harness.signUp.mockResolvedValue({ data: { user: { id: 'email-user', email: 'new@example.test' } }, error: null });
    renderSignUp(); await flush();
    let tree = renderSignUp();
    const field = (id: string) => walk(tree).find(node => node.props?.id === id)!;
    field('email').props.onChange({ target: { value: 'New@Example.test' } });
    field('password').props.onChange({ target: { value: 'Sup3r-Secret!!' } });
    field('confirmPassword').props.onChange({ target: { value: 'Sup3r-Secret!!' } });
    tree = renderSignUp();
    const form = walk(tree).find(node => node.type === 'form')!;
    await form.props.onSubmit({ preventDefault() {} });
    expect(harness.signUp).not.toHaveBeenCalled();
    expect(text(walk(renderSignUp()).find(node => node.props?.role === 'alert')!)).toContain('required acknowledgments');
    checkboxes(tree).props.onChange('bank_data', true);
    checkboxes(tree).props.onChange('ai_review', true);
    await walk(renderSignUp()).find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} });
    expect(harness.signUp).toHaveBeenCalledWith('New@Example.test', 'Sup3r-Secret!!');
    expect(harness.replace).toHaveBeenCalledWith('/auth/sign-up-success');
    expect(stashed()).toMatchObject({ email: 'new@example.test', record: { source: 'sign-up', communications: false } });
  });
});
