import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
const state = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: new Map<number, () => void>(), load: vi.fn(), save: vi.fn(), beforeUnload: vi.fn(), tab: '', push: vi.fn(), navigate: vi.fn() }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useContext: () => null,
    useState(initial: unknown) {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [state.slots[index], (next: unknown) => { state.slots[index] = typeof next === 'function' ? next(state.slots[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = state.cursor++;
      if (!(index in state.slots)) state.slots[index] = { current: initial };
      return state.slots[index];
    },
    useEffect(effect: () => void | (() => void), dependencies: unknown[]) {
      const index = state.cursor++;
      const previous = state.slots[index] as unknown[] | undefined;
      if (previous?.length === dependencies.length && previous.every((value, position) => Object.is(value, dependencies[position]))) return;
      state.slots[index] = dependencies;
      state.effects.push(() => {
        state.cleanups.get(index)?.();
        const cleanup = effect();
        if (typeof cleanup === 'function') state.cleanups.set(index, cleanup);
      });
    },
    useCallback<T>(callback: T, dependencies: unknown[]) {
      const index = state.cursor++;
      const previous = state.slots[index] as { dependencies: unknown[]; callback: T } | undefined;
      if (previous?.dependencies.length === dependencies.length && previous.dependencies.every((value, position) => Object.is(value, dependencies[position]))) return previous.callback;
      state.slots[index] = { callback, dependencies };
      return callback;
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});

vi.mock('@/lib/firebase/profiles', () => ({ getUserProfile: state.load, upsertUserProfile: state.save }));
vi.mock('@/lib/hooks/use-before-unload', () => ({ useBeforeUnload: state.beforeUnload }));
vi.mock('@/lib/hooks/use-subscription', () => ({ useSubscription: () => ({ status: null, isLoading: false, refetch: vi.fn() }) }));
vi.mock('next/navigation', () => { const router = { push: state.push }; return { useRouter: () => router, useSearchParams: () => new URLSearchParams(state.tab ? { tab: state.tab } : {}) }; });
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: vi.fn() }));
import { SettingsScreen } from '../components/settings-screen';
import { requestAppNavigation } from '../lib/navigation/navigation-guard';

type Props = { children?: unknown; label?: string; title?: string; summary?: string; defaultOpen?: boolean; open?: boolean;
  value?: unknown; disabled?: boolean; readOnly?: boolean; type?: string; 'aria-label'?: string;
  onChange?: (event: { target: { value: string } }) => void; onClick?: () => void | Promise<void>;
  onValueChange?: (value: string) => void;
};
type Element = ReactElement<Props>;
const walk = (node: unknown): Element[] => Array.isArray(node) ? node.flatMap(walk) : isValidElement<Props>(node) ? [node, ...walk(node.props.children)] : [];
const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join('') : isValidElement<Props>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
let user = { id: 'settings-user', email: 'identity@example.test', user_metadata: { name: 'Synthetic User' } };
function render() { state.cursor = 0; return SettingsScreen({ user, onBack() {}, onNavigate: state.navigate, inAppNavigation: true }); }
async function effects() { state.effects.splice(0).forEach(effect => effect()); for (let i = 0; i < 8; i++) await Promise.resolve(); }
async function mount() { render(); await effects(); return render(); }
function field(label: string) {
  const wrapper = walk(render()).find(node => node.props.label === label);
  expect(wrapper, `Missing field ${label}`).toBeDefined();
  return walk(wrapper).find(node => node.props.onChange || node.props.onValueChange)!;
}
function change(label: string, value: string) {
  const input = field(label);
  if (input.props.onChange) input.props.onChange({ target: { value } });
  else input.props.onValueChange!(value);
}
function click(label: string) {
  const button = walk(render()).find(node => node.props.onClick && (text(node) === label || node.props['aria-label'] === label));
  expect(button, `Missing button ${label}`).toBeDefined(); return button!.props.onClick!();
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const saved = { name: 'Saved Name', email: 'identity@example.test', profession: 'Consultant', state: 'California', filing_status: 'Single', w2_income: 50000, w2_federal_withheld: 5500, mailing_address: { city: 'Los Angeles', state: 'CA' } };
beforeEach(() => {
  state.slots = []; state.cursor = 0; state.effects = []; state.cleanups.clear(); state.tab = '';
  user = { id: 'settings-user', email: 'identity@example.test', user_metadata: { name: 'Synthetic User' } };
  vi.resetAllMocks(); vi.useFakeTimers(); vi.stubGlobal('window', new EventTarget()); state.load.mockResolvedValue({ data: saved, error: null }); state.save.mockResolvedValue({ error: null });
});
afterEach(() => { state.cleanups.forEach(cleanup => cleanup()); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('compact settings preserve profile editing and account access', () => {
  it('opens the tax profile first and summarizes other sections while retaining every profile field', async () => {
    const tree = await mount();
    const sections = walk(tree).filter(node => typeof node.props.summary === 'string');
    expect(sections.map(node => node.props.title)).toEqual(['Tax profile', 'Personal Information', 'Professional Information', 'Business Details', 'Mailing Address']);
    expect(sections[0].props.summary).toBe('Single · California');
    expect(sections[1].props.summary).toContain('Saved Name');
    for (const section of sections) {
      const details = (section.type as (props: Props) => Element)(section.props);
      expect(details.type).toBe('details');
      expect(details.props.open).toBe(section.props.title === 'Tax profile' ? true : undefined);
      expect(walk(details).some(node => node.props.label)).toBe(true);
    }
    expect(field('W-2 Income').props.value).toBe(50000);
    const emailWrapper = walk(tree).find(node => node.props.label === 'Email')!;
    expect(walk(emailWrapper).find(node => node.props.readOnly)?.props.value).toBe('identity@example.test');
  });
  it('announces future AI updates only after a relevant profile change saves successfully', async () => {
    await mount(); change('W-2 Income', '61000');
    expect(text(render())).not.toContain('AI reviews will update');
    await vi.advanceTimersByTimeAsync(1500);
    expect(text(render())).toContain('AI reviews will update using your new profile. Confirmed categories stay saved.');
    change('Full Name', 'Cosmetic name change');
    await vi.advanceTimersByTimeAsync(1500);
    expect(text(render())).not.toContain('AI reviews will update');
  });
  it('does not announce AI updates for cosmetic-only changes or a failed profile save', async () => {
    await mount(); change('Full Name', 'Cosmetic name');
    await vi.advanceTimersByTimeAsync(1500);
    expect(text(render())).not.toContain('AI reviews will update');
    state.save.mockResolvedValueOnce({ error: new Error('Synthetic save failure') });
    change('W-2 Income', '65000');
    await vi.advanceTimersByTimeAsync(1500);
    expect(text(render())).toContain('Save failed');
    expect(text(render())).not.toContain('AI reviews will update');
  });

  it('merges rapid edits across sections and saves the newest values', async () => {
    await mount(); change('Full Name', 'Edited Name'); change('W-2 Income', '61000');
    await vi.advanceTimersByTimeAsync(1500);
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(state.save.mock.calls[0]).toEqual(['settings-user', expect.objectContaining({ name: 'Edited Name', w2_income: 61000, w2_federal_withheld: 5500, email: 'identity@example.test', profession: 'Consultant' })]);
    render(); expect(state.beforeUnload).toHaveBeenLastCalledWith(false);
  });
  it('queues edits made during a save without declaring those newer changes saved', async () => {
    await mount(); const pending = deferred<{ error: null }>(); state.save.mockReturnValueOnce(pending.promise);
    change('Full Name', 'First Name'); await vi.advanceTimersByTimeAsync(1500);
    change('Full Name', 'Final Name'); change('W-2 Income', '65000'); await vi.advanceTimersByTimeAsync(1500);
    expect(state.save).toHaveBeenCalledTimes(1);
    pending.resolve({ error: null }); await effects();
    render(); expect(state.beforeUnload).toHaveBeenLastCalledWith(true);
    expect(text(render())).not.toContain('Saved');
    await vi.advanceTimersByTimeAsync(1500);
    expect(state.save).toHaveBeenCalledTimes(2);
    expect(state.save.mock.calls[1][1]).toMatchObject({ name: 'Final Name', w2_income: 65000 });
    render(); expect(state.beforeUnload).toHaveBeenLastCalledWith(false);
  });
  it('keeps failed edits dirty and retries the same newest values', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await mount(); state.save.mockResolvedValueOnce({ error: new Error('Offline') });
    change('Full Name', 'Unsaved Name'); await vi.advanceTimersByTimeAsync(1500);
    expect(text(render())).toContain('Save failed'); expect(field('Full Name').props.value).toBe('Unsaved Name');
    expect(state.beforeUnload).toHaveBeenLastCalledWith(true);
    await click('Retry'); expect(state.save.mock.calls[1][1]).toMatchObject({ name: 'Unsaved Name' });
    render(); expect(state.beforeUnload).toHaveBeenLastCalledWith(false);
  });
  it('keeps newer edits after an older save fails and queues their save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await mount(); const pending = deferred<{ error: Error }>(); state.save.mockReturnValueOnce(pending.promise);
    change('Full Name', 'Earlier edit'); await vi.advanceTimersByTimeAsync(1500);
    change('Full Name', 'Newest edit'); pending.resolve({ error: new Error('Offline') }); await effects();
    expect(field('Full Name').props.value).toBe('Newest edit'); expect(state.beforeUnload).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(1500); expect(state.save.mock.calls[1][1]).toMatchObject({ name: 'Newest edit' });
  });
  it('cancels pending autosave when unmounted', async () => {
    await mount(); change('Full Name', 'Pending edit'); state.cleanups.forEach(cleanup => cleanup());
    await vi.advanceTimersByTimeAsync(2000); expect(state.save).not.toHaveBeenCalled();
  });
  it('ignores a late save result after the profile owner changes', async () => {
    await mount(); const pending = deferred<{ error: null }>(); state.save.mockReturnValueOnce(pending.promise);
    change('Full Name', 'Old owner edit'); await vi.advanceTimersByTimeAsync(1500);
    user = { ...user, id: 'second-user', email: 'second@example.test' };
    state.load.mockResolvedValueOnce({ data: { ...saved, name: 'Second User', email: 'second@example.test' }, error: null });
    render(); await effects(); render(); change('Full Name', 'Second User Edit');
    pending.resolve({ error: null }); await effects();
    expect(field('Full Name').props.value).toBe('Second User Edit'); expect(state.beforeUnload).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(state.save.mock.calls[1]).toEqual(['second-user', expect.objectContaining({ name: 'Second User Edit', email: 'second@example.test' })]);
  });
  it('cancels pending edits on owner change and resets a profile missing on the new account', async () => {
    await mount(); change('Full Name', 'Old owner pending edit');
    user = { id: 'new-user', email: 'new@example.test', user_metadata: { name: 'New User' } };
    state.load.mockResolvedValueOnce({ data: null, error: null }); render(); await effects();
    expect(field('Full Name').props.value).toBe('New User'); expect(field('W-2 Income').props.value).toBe('');
    await vi.advanceTimersByTimeAsync(2000); expect(state.save).not.toHaveBeenCalled();
  });
  it('shows a retry after profile read errors and blocks editing unloaded defaults', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.load.mockResolvedValueOnce({ data: null, error: { code: 'unavailable' } }); await mount();
    expect(text(render())).toContain('Your settings could not be loaded.'); expect(walk(render()).some(node => node.props.label === 'Full Name')).toBe(false);
    await click('Retry loading settings'); render(); await effects(); expect(field('Full Name').props.value).toBe('Saved Name');
  });
  it('keeps tax fields editable and opens billing when linked from a payment flow', async () => {
    state.tab = 'tax'; await mount(); change('HSA Contribution', '3200');
    await vi.advanceTimersByTimeAsync(1500); expect(state.save.mock.calls[0][1]).toMatchObject({ hsa_contribution: 3200, name: 'Saved Name' });
    await click('AccountAccount');
    const tree = render(); expect(text(tree)).toContain('Connect Bank'); expect(text(tree)).toContain('Export Data'); expect(text(tree)).toContain('Delete Account');
  });
  it('preserves selected professions and custom text when adding and removing professions', async () => {
    await mount(); change('Add profession', 'Other'); change('Custom Profession', 'Illustrator');
    change('Add profession', 'Graphic Designer'); await vi.advanceTimersByTimeAsync(1500);
    expect(state.save.mock.calls.at(-1)![1]).toMatchObject({ profession: 'Consultant, Graphic Designer, Illustrator' });
    await click('Remove Consultant'); await vi.advanceTimersByTimeAsync(1500);
    expect(state.save.mock.calls.at(-1)![1]).toMatchObject({ profession: 'Graphic Designer, Illustrator' });
    expect(field('Custom Profession').props.value).toBe('Illustrator');
  });
  it('saves dirty settings before allowing shared app navigation', async () => {
    await mount(); change('Full Name', 'Name before leaving');
    expect(requestAppNavigation('/protected')).toBe(false); expect(state.push).not.toHaveBeenCalled();
    await effects(); await vi.advanceTimersByTimeAsync(0);
    expect(state.save.mock.calls[0][1]).toMatchObject({ name: 'Name before leaving' });
    expect(state.push).toHaveBeenCalledExactlyOnceWith('/protected');
  });
  it('stays on settings after a navigation save fails and retries before leaving', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await mount(); state.save.mockResolvedValueOnce({ error: new Error('Offline') }); change('Full Name', 'Unsaved draft');
    expect(requestAppNavigation('/protected/transactions')).toBe(false); await effects(); await vi.advanceTimersByTimeAsync(2000);
    expect(state.push).not.toHaveBeenCalled(); expect(text(render())).toContain('Save failed');
    await click('Retry'); await vi.advanceTimersByTimeAsync(0);
    expect(state.push).toHaveBeenCalledExactlyOnceWith('/protected/transactions');
  });
  it('does not navigate until newer edits made during the save also finish saving', async () => {
    await mount(); const first = deferred<{ error: null }>(); const second = deferred<{ error: null }>();
    state.save.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    change('Full Name', 'First draft'); expect(requestAppNavigation('/protected')).toBe(false);
    change('Full Name', 'Final draft'); change('W-2 Income', '0'); first.resolve({ error: null });
    await effects(); await vi.advanceTimersByTimeAsync(0);
    expect(state.push).not.toHaveBeenCalled(); expect(state.save.mock.calls[1][1]).toMatchObject({ name: 'Final draft', w2_income: 0 });
    second.resolve({ error: null }); await effects(); await vi.advanceTimersByTimeAsync(0);
    expect(state.push).toHaveBeenCalledExactlyOnceWith('/protected');
  });
  it('cancels pending navigation and removes the app guard when unmounted', async () => {
    await mount(); const pending = deferred<{ error: null }>(); state.save.mockReturnValueOnce(pending.promise);
    change('Full Name', 'Pending draft'); expect(requestAppNavigation('/protected')).toBe(false);
    state.cleanups.forEach(cleanup => cleanup()); pending.resolve({ error: null }); await effects(); await vi.advanceTimersByTimeAsync(2000);
    expect(state.push).not.toHaveBeenCalled(); expect(requestAppNavigation('/protected')).toBe(true);
  });
  it('guards both internal bank routes until dirty edits save', async () => {
    await mount(); change('Full Name', 'Bank connection draft'); await click('AccountAccount');
    await click('Connect Bank'); expect(state.navigate).not.toHaveBeenCalled(); await effects(); await vi.advanceTimersByTimeAsync(0);
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('plaid-link?from=settings');
    await click('ProfileProfile'); change('Full Name', 'Manage bank draft'); await click('AccountAccount');
    await click('Accounts'); expect(state.navigate).toHaveBeenCalledTimes(1); await effects(); await vi.advanceTimersByTimeAsync(0);
    expect(state.navigate).toHaveBeenLastCalledWith('plaid');
  });
  it('shows legacy picker values without silently changing the saved profile', async () => {
    state.load.mockResolvedValueOnce({ data: { ...saved, state: 'TX', filing_status: 'single' }, error: null }); await mount();
    for (const [label, value] of [['State', 'TX'], ['Filing Status', 'single']]) {
      const picker = field(label); expect(picker.props.value).toBe(value);
      const select = (picker.type as (props: Props) => Element)(picker.props);
      expect(walk(select).some(option => option.type === 'option' && option.props.value === value && text(option) === `${value} (saved)`)).toBe(true);
    }
    change('Full Name', 'Legacy values retained'); await vi.advanceTimersByTimeAsync(1500);
    expect(state.save.mock.calls[0][1]).toMatchObject({ state: 'TX', filing_status: 'single' });
    change('State', 'Texas'); await vi.advanceTimersByTimeAsync(1500); expect(state.save.mock.calls[1][1]).toMatchObject({ state: 'Texas' });
  });
  it('sends explicit numeric clears as null while preserving zero and untouched omissions', async () => {
    state.load.mockResolvedValueOnce({ data: { ...saved, hsa_contribution: 1200, prior_year_tax: 5000 }, error: null }); await mount();
    change('W-2 Income', ''); change('W-2 Federal Tax Withheld', '0'); await click('TaxTax'); change('HSA Contribution', '');
    await vi.advanceTimersByTimeAsync(1500);
    const payload = state.save.mock.calls[0][1];
    expect(payload).toMatchObject({ w2_income: null, hsa_contribution: null, w2_federal_withheld: 0, prior_year_tax: 5000 });
    expect(payload.business_income).toBeUndefined();
    // The persistence helper omits undefined during merge; explicit null survives.
    const firestoreMerge = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
    expect(firestoreMerge).not.toHaveProperty('business_income');
    expect(firestoreMerge).toMatchObject({ w2_income: null, hsa_contribution: null, w2_federal_withheld: 0 });
  });
  it('opens fresh settings for the actual missing-profile result', async () => {
    state.load.mockResolvedValueOnce({ data: null, error: { code: 'PROFILE_NOT_FOUND' } }); await mount();
    expect(field('Full Name').props.value).toBe('Synthetic User'); expect(field('W-2 Income').props.value).toBe('');
    change('Full Name', 'New account profile'); await vi.advanceTimersByTimeAsync(1500);
    expect(state.save.mock.calls[0][1]).toMatchObject({ name: 'New account profile', email: 'identity@example.test' });
  });
  it('opens the subscription disclosure for the legacy payment deep link', async () => {
    state.tab = 'payment'; await mount();
    expect(walk(render()).find(node => node.props.title === 'Subscription')?.props.defaultOpen).toBe(true);
  });
});
