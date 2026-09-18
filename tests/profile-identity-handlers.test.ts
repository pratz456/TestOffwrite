import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { AuthUser } from '@/lib/firebase/auth';
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], upsert: vi.fn(), reload: vi.fn(), beforeUnload: vi.fn() }));
vi.mock('@/lib/firebase/profiles', () => ({ upsertUserProfile: harness.upsert }));
vi.mock('@/lib/hooks/use-before-unload', () => ({ useBeforeUnload: harness.beforeUnload }));
vi.mock('@/lib/onboarding/profile-identity', () => ({ reloadProfileEmail: harness.reload }));
vi.mock('@/components/plaid-link-screen', () => ({ PlaidLinkScreen: () => null }));
vi.mock('@/components/data-source-screen', () => ({ DataSourceScreen: () => null }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
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
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = harness.cursor++; const previous = harness.slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        const next: any = { deps }; harness.slots[index] = next;
        harness.effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
      }
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
import { ProfileSetupScreen } from '../components/profile-setup-screen';
import { CONSENT_TERMS_VERSION } from '../lib/onboarding/consents';
type Element = ReactElement<Record<string, any>>;
const user = (email: string | null): AuthUser => ({ id: 'google-user', email, emailVerified: true, sessionReady: true, user_metadata: { name: 'Original Google Name' } });
// These tests cover the profile form; the acknowledgments step that precedes it is covered in tests/onboarding-consents.test.ts.
const acknowledged = { version: CONSENT_TERMS_VERSION, source: 'sign-up', accepted_at: '2026-09-17T12:00:00.000Z', terms: true, bank_data: true, ai_review: true, communications: false };
function render(email: string | null, uid = 'google-user', existingConsents: unknown = acknowledged) {
  harness.cursor = 0;
  const tree = ProfileSetupScreen({ user: { ...user(email), id: uid }, existingConsents, onBack() {}, onComplete() {} }) as Element;
  harness.effects.splice(0).forEach(effect => effect());
  return tree;
}
function walk(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  return node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
}
function text(node: any): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return typeof node === 'string' ? node : '';
}
function field(tree: Element, id: string) { return walk(tree).find(node => node.props.id === id)!; }
function button(tree: Element, label: string) { return walk(tree).find(node => node.props.onClick && text(node).trim() === label)!; }
function select(tree: Element, id: string, value: string) {
  const control = field(tree, id);
  expect(control.type).toBe('select');
  control.props.onChange({ target: { value } });
}
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
beforeEach(() => { harness.slots = []; harness.cursor = 0; harness.effects = []; vi.clearAllMocks(); harness.upsert.mockResolvedValue({ error: null }); harness.reload.mockImplementation(() => new Promise(() => {})); });
afterEach(() => { harness.slots.forEach(slot => slot?.cleanup?.()); });

describe('profile setup uses the hydrated authenticated email', () => {
  it('fills a late email without replacing the name the user already typed', () => {
    field(render(null), 'profile-name').props.onChange({ target: { value: 'My preferred name' } });
    const hydrated = render('google-owner@example.test');
    expect(field(hydrated, 'profile-email').props.value).toBe('google-owner@example.test');
    expect(field(hydrated, 'profile-email').props.disabled).toBe(true);
    expect(field(hydrated, 'profile-name').props.value).toBe('My preferred name');
  });
  it('uses the current authenticated address when a same-user identity is refreshed', () => {
    render('old@example.test');
    expect(field(render('current@example.test'), 'profile-email').props.value).toBe('current@example.test');
    expect(field(render(null), 'profile-email').props.value).toBe('');
  });
  it('never requests a reload for an identity that already has an email', () => {
    render('owner@example.test'); render('owner@example.test');
    expect(harness.reload).not.toHaveBeenCalled();
  });
  it('recovers a missing email once without clearing typed details or looping', async () => {
    harness.reload.mockResolvedValue('recovered@example.test');
    field(render(null), 'profile-name').props.onChange({ target: { value: 'Typed name' } });
    await tick(); const recovered = render(null);
    expect(field(recovered, 'profile-email').props.value).toBe('recovered@example.test');
    expect(field(recovered, 'profile-name').props.value).toBe('Typed name');
    render(null); render(null); expect(harness.reload).toHaveBeenCalledOnce();
  });
  it('does not turn an automatic identity refresh into an unsaved-edit warning', async () => {
    harness.reload.mockResolvedValue('recovered@example.test');
    render(null); await tick(); render(null);
    expect(harness.beforeUnload).toHaveBeenLastCalledWith(false);
    field(render(null), 'profile-name').props.onChange({ target: { value: 'Typed name' } }); render(null);
    expect(harness.beforeUnload).toHaveBeenLastCalledWith(true);
  });
  it('offers an explicit retry without automatically repeating a failed request', async () => {
    harness.reload.mockRejectedValueOnce(new Error('We could not load your account email. Please try again.')).mockResolvedValueOnce('recovered@example.test');
    render(null); await tick(); const failed = render(null); render(null);
    expect(harness.reload).toHaveBeenCalledOnce();
    button(failed, 'Refresh account email').props.onClick(); render(null); await tick();
    expect(field(render(null), 'profile-email').props.value).toBe('recovered@example.test');
    expect(harness.reload).toHaveBeenCalledTimes(2);
  });
  it('ignores an in-flight recovery after changing to another account', async () => {
    let finish!: (email: string) => void;
    harness.reload.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    render(null); render(null, 'replacement-user'); finish('old-owner@example.test'); await tick();
    expect(field(render(null, 'replacement-user'), 'profile-email').props.value).toBe('');
  });
  it('does not let an old recovery replace a newly hydrated current email', async () => {
    let finish!: (email: string) => void;
    harness.reload.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    render(null); render('current@example.test'); finish('old@example.test'); await tick();
    expect(field(render('current@example.test'), 'profile-email').props.value).toBe('current@example.test');
  });
  it('saves the hydrated email with all typed answers through the real submit handler', async () => {
    const empty = render(null);
    field(empty, 'profile-name').props.onChange({ target: { value: 'My preferred name' } });
    select(empty, 'profile-state', 'California'); select(empty, 'profile-filingStatus', 'Single');
    expect(button(render(null), 'Next').props.disabled).toBe(true);
    const hydrated = render('google-owner@example.test');
    expect(button(hydrated, 'Next').props.disabled).toBe(false);
    button(hydrated, 'Next').props.onClick();
    const work = render('google-owner@example.test');
    select(work, 'profile-businessEntityType', 'Sole Proprietor / Independent Contractor');
    select(work, 'profile-primaryWorkLocation', 'Home Office'); select(work, 'profile-income', 'Under $11,600');
    select(work, 'profile-profession', 'Software Developer');
    button(render('google-owner@example.test'), 'Next').props.onClick();
    await button(render('google-owner@example.test'), 'Save and continue').props.onClick();
    expect(harness.upsert).toHaveBeenCalledWith('google-user', expect.objectContaining({
      email: 'google-owner@example.test', name: 'My preferred name', state: 'California', filing_status: 'Single',
      primary_work_location: 'Home Office', income: 'Under $11,600',
    }));
  });
});


describe('short profile setup steps preserve required facts', () => {
  const email = 'owner@example.test';
  it('opens on the acknowledgments step, not the form, when the account has no consent record', () => {
    const tree = render(email, 'google-user', null);
    expect(field(tree, 'profile-name')).toBeUndefined();
    expect(text(tree)).toContain('A few acknowledgments first');
    expect(harness.upsert).not.toHaveBeenCalled();
  });
  function completePersonal() {
    const tree = render(email);
    select(tree, 'profile-state', 'California'); select(tree, 'profile-filingStatus', 'Single');
    button(render(email), 'Next').props.onClick();
    return render(email);
  }
  function completeWork() {
    const tree = completePersonal();
    select(tree, 'profile-businessEntityType', 'Sole Proprietor / Independent Contractor');
    select(tree, 'profile-primaryWorkLocation', 'Home Office'); select(tree, 'profile-income', 'Under $11,600');
    select(tree, 'profile-profession', 'Software Developer');
    button(render(email), 'Next').props.onClick();
    return render(email);
  }
  it('uses native pickers with empty initial tax facts and resets profession add after each selection', () => {
    const initial = render(email);
    for (const id of ['profile-state', 'profile-filingStatus']) {
      const picker = field(initial, id);
      expect(picker.type).toBe('select');
      expect(picker.props.value).toBe('');
    }
    const work = completePersonal();
    for (const id of ['profile-businessEntityType', 'profile-primaryWorkLocation', 'profile-income', 'profile-profession']) {
      expect(field(work, id).type).toBe('select');
      expect(field(work, id).props.value).toBe('');
    }
    select(work, 'profile-profession', 'Software Developer');
    const updated = render(email);
    expect(field(updated, 'profile-profession').props.value).toBe('');
    expect(walk(field(updated, 'profile-profession')).some(node => node.type === 'option' && node.props.value === 'Software Developer')).toBe(false);
    expect(walk(updated).some(node => node.props['aria-label'] === 'Remove Software Developer')).toBe(true);
  });
  it('requires the current personal facts before showing work, with no assumed filing status', () => {
    const initial = render(email);
    expect(field(initial, 'profile-businessEntityType')).toBeUndefined();
    expect(button(initial, 'Next').props.disabled).toBe(true);
    button(initial, 'Next').props.onClick();
    expect(field(render(email), 'profile-name')).toBeDefined();
    select(initial, 'profile-state', 'California');
    expect(button(render(email), 'Next').props.disabled).toBe(true);
    select(render(email), 'profile-filingStatus', 'Single');
    button(render(email), 'Next').props.onClick();
    const work = render(email);
    expect(field(work, 'profile-businessEntityType')).toBeDefined();
    expect(field(work, 'profile-name')).toBeUndefined();
    expect(button(work, 'Next').props.disabled).toBe(true);
    expect(harness.upsert).not.toHaveBeenCalled();
  });
  it('supports multiple professions and still requires custom profession text', () => {
    const work = completePersonal();
    select(work, 'profile-businessEntityType', 'Sole Proprietor / Independent Contractor');
    select(work, 'profile-primaryWorkLocation', 'Home Office'); select(work, 'profile-income', 'Under $11,600');
    select(work, 'profile-profession', 'Software Developer'); select(render(email), 'profile-profession', 'Other');
    expect(button(render(email), 'Next').props.disabled).toBe(true);
    const custom = walk(render(email)).find(node => node.props['aria-label'] === 'Your profession')!;
    custom.props.onChange({ target: { value: 'Mural artist' } });
    expect(button(render(email), 'Next').props.disabled).toBe(false);
    walk(render(email)).find(node => node.props['aria-label'] === 'Remove Software Developer')!.props.onClick();
    expect(button(render(email), 'Next').props.disabled).toBe(false);
    walk(render(email)).find(node => node.props['aria-label'] === 'Remove Other')!.props.onClick();
    expect(button(render(email), 'Next').props.disabled).toBe(true);
  });
  it('retains prior answers when moving backward and validates optional details before saving', async () => {
    let details = completeWork();
    button(details, 'Add income & personal details').props.onClick();
    field(render(email), 'profile-yearOfBirth').props.onChange({ target: { value: '18' } });
    details = render(email);
    expect(button(details, 'Save and continue').props.disabled).toBe(true);
    await button(details, 'Save and continue').props.onClick();
    expect(harness.upsert).not.toHaveBeenCalled();
    field(details, 'profile-yearOfBirth').props.onChange({ target: { value: '1990' } });
    button(render(email), 'Previous').props.onClick();
    expect(walk(render(email)).some(node => node.props['aria-label'] === 'Remove Software Developer')).toBe(true);
    button(render(email), 'Previous').props.onClick();
    expect(field(render(email), 'profile-name').props.value).toBe('Original Google Name');
    button(render(email), 'Next').props.onClick(); button(render(email), 'Next').props.onClick();
    expect(field(render(email), 'profile-yearOfBirth').props.value).toBe('1990');
    await button(render(email), 'Save and continue').props.onClick();
    expect(harness.upsert).toHaveBeenCalledExactlyOnceWith('google-user', expect.objectContaining({
      email, name: 'Original Google Name', year_of_birth: '1990', profession: 'Software Developer',
      state: 'California', filing_status: 'Single', business_entity_type: 'Sole Proprietor / Independent Contractor',
      primary_work_location: 'Home Office', income: 'Under $11,600',
    }));
  });
});
