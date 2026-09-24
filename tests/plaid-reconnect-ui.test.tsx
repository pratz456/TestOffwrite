import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReconnectRecord, ReconnectView } from '@/lib/plaid/reconnect-contract';
const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn(), replace: vi.fn(), uid: 'owner' }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: any) { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: any) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next; }]; },
    useRef(initial: any) { const i = h.cursor++; return h.slots[i] ??= { current: initial }; },
    useCallback(callback: any, deps: any[]) { const i = h.cursor++; if (!same(h.slots[i]?.deps, deps)) h.slots[i] = { callback, deps }; return h.slots[i].callback; },
    useEffect(effect: () => void | (() => void), deps: any[]) { const i = h.cursor++, old = h.slots[i]; if (!same(old?.deps, deps)) { const next: any = { deps }; h.slots[i] = next; h.effects.push(() => { old?.cleanup?.(); next.cleanup = effect(); }); } },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: h.request }));
vi.mock('@/lib/firebase/client', () => ({ auth: { get currentUser() { return { uid: h.uid }; } } }));
vi.mock('@/components/plaid-link-screen', () => ({ PlaidLinkScreen: () => null }));
import { PlaidReconnectScreen, ReconnectRecordReview } from '@/components/plaid-reconnect-screen';
const walk = (node: any): any[] => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
const content = (node: any): string => Array.isArray(node) ? node.map(content).join('') : node && typeof node === 'object' ? content(node.props?.children) : String(node ?? '');
function render(component: () => any) { h.cursor = 0; const tree = component(); h.effects.splice(0).forEach(effect => effect()); return tree; }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const button = (tree: any, label: string) => walk(tree).find(node => node.props?.onClick && content(node) === label)!;
const checkbox = (tree: any, label: string) => walk(walk(tree).find(node => node.type === 'label' && content(node).includes(label))).find(node => node.props?.type === 'checkbox')!;
const account = (id: string) => ({ id, name: id, mask: '1234', type: 'checking', currency: 'USD' });
const record = (extra: Partial<ReconnectRecord> = {}): ReconnectRecord => ({ id: 'new-tx', version: 'reviewed-version', accountId: 'new-account', date: '2026-08-01', amount: 25, merchant: 'Coffee', currency: 'USD', status: 'pending', event: 'added', correction: false, candidates: [{ reference: 'saved/reference', version: 'saved-version', accountId: 'old-account', date: '2026-08-01', amount: 25, merchant: 'Coffee', currency: 'USD', confirmed: true, exact: true }], ...extra });
const view = (extra: Partial<ReconnectView> = {}): ReconnectView => ({ sessionId: 'review-1', phase: 'review', itemId: 'item-1', accounts: [account('new-account')], legacyAccounts: [account('old-account'), account('second-old-account')], mappings: {}, historyReady: true, mappingComplete: false, pendingCount: 1, deferredCount: 0, resolvedCount: 0, records: [record()], nextCursor: null, cutoverDate: null, ...extra });
let responseView: ReconnectView;
const screen = (sessionId = 'review-1') => () => PlaidReconnectScreen({ user: { id: 'owner' }, sessionId });
async function mount(component: () => any) { render(component); await flush(); return render(component); }
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; h.uid = 'owner'; vi.clearAllMocks(); responseView = view();
  vi.stubGlobal('window', { history: { replaceState: h.replace } });
  h.request.mockImplementation(async () => Response.json({ success: true, reconnect: responseView }));
});
afterEach(() => { h.slots.forEach(slot => slot?.cleanup?.()); vi.unstubAllGlobals(); });

describe('owner-guided account mapping', () => {
  it('requires explicit mapping for every account and a final account confirmation', async () => {
    responseView.accounts.push(account('another-account'));
    const component = screen(); let tree = await mount(component);
    expect(button(tree, 'Confirm account matches').props.disabled).toBe(true);
    const fieldsets = walk(tree).filter(node => node.type === 'fieldset');
    checkbox(fieldsets[0], 'old-account').props.onChange({ target: { checked: true } });
    tree = render(component);
    expect(button(tree, 'Confirm account matches').props.disabled).toBe(true);
    checkbox(walk(tree).filter(node => node.type === 'fieldset')[1], 'different account').props.onChange({ target: { checked: true } });
    tree = render(component);
    expect(button(tree, 'Confirm account matches').props.disabled).toBe(true);
    checkbox(tree, 'I checked every account').props.onChange({ target: { checked: true } }); tree = render(component);
    await button(tree, 'Confirm account matches').props.onClick(); await flush();
    expect(h.request).toHaveBeenLastCalledWith('/api/plaid/reconnect', expect.objectContaining({ body: JSON.stringify({ action: 'map', sessionId: 'review-1', mappings: { 'new-account': ['old-account'], 'another-account': [] }, confirmAccountMapping: true }) }));
  });
  it('allows multiple legacy accounts for one new account without treating deselection as different', async () => {
    const component = screen(); let tree = await mount(component);
    checkbox(tree, 'old-account').props.onChange({ target: { checked: true } }); tree = render(component);
    checkbox(tree, 'second-old-account').props.onChange({ target: { checked: true } }); tree = render(component);
    checkbox(tree, 'I checked every account').props.onChange({ target: { checked: true } }); tree = render(component);
    await button(tree, 'Confirm account matches').props.onClick(); await flush();
    expect(JSON.parse(h.request.mock.calls.at(-1)![1].body).mappings).toEqual({ 'new-account': ['old-account', 'second-old-account'] });
    tree = render(component); checkbox(tree, 'old-account').props.onChange({ target: { checked: true } }); tree = render(component);
    checkbox(tree, 'old-account').props.onChange({ target: { checked: false } }); tree = render(component);
    expect(checkbox(tree, 'different account').props.checked).toBe(false);
    expect(button(tree, 'Confirm account matches').props.disabled).toBe(true);
  });
});

describe('explicit transaction decisions', () => {
  it('never chooses an exact candidate automatically and submits both reviewed versions', async () => {
    const decide = vi.fn().mockResolvedValue(undefined); const item = record();
    const component = () => ReconnectRecordReview({ record: item, accountName: 'New bank', disabled: false, onDecision: decide });
    let tree = render(component);
    expect(decide).not.toHaveBeenCalled(); expect(button(tree, 'Same transaction · keep saved record').props.disabled).toBe(true);
    walk(tree).find(node => node.props?.type === 'radio').props.onChange(); tree = render(component);
    await button(tree, 'Same transaction · keep saved record').props.onClick();
    expect(decide).toHaveBeenCalledWith({ recordId: 'new-tx', version: 'reviewed-version', decision: 'duplicate', canonicalReference: 'saved/reference', canonicalVersion: 'saved-version' });
  });
  it('requires explicit acknowledgment when selected candidate details differ', async () => {
    const decide = vi.fn().mockResolvedValue(undefined); const item = record(); item.candidates[0].exact = false;
    const component = () => ReconnectRecordReview({ record: item, accountName: 'New bank', disabled: false, onDecision: decide });
    let tree = render(component); walk(tree).find(node => node.props?.type === 'radio').props.onChange(); tree = render(component);
    expect(button(tree, 'Same transaction · keep saved record').props.disabled).toBe(true);
    checkbox(tree, 'I reviewed the different').props.onChange({ target: { checked: true } }); tree = render(component);
    await button(tree, 'Same transaction · keep saved record').props.onClick();
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ confirmDifferentDetails: true, decision: 'duplicate' }));
  });
  it('clears a prior match acknowledgment after the saved candidate changes', async () => {
    const decide = vi.fn().mockResolvedValue(undefined); let item = record(); item.candidates[0].exact = false;
    const component = () => ReconnectRecordReview({ record: item, accountName: 'New bank', disabled: false, onDecision: decide });
    let tree = render(component); walk(tree).find(node => node.props?.type === 'radio').props.onChange(); tree = render(component);
    checkbox(tree, 'I reviewed the different').props.onChange({ target: { checked: true } }); tree = render(component);
    expect(button(tree, 'Same transaction · keep saved record').props.disabled).toBe(false);
    item = { ...item, candidates: [{ ...item.candidates[0], version: 'changed-saved-record' }] }; render(component); tree = render(component);
    expect(button(tree, 'Same transaction · keep saved record').props.disabled).toBe(true);
    expect(walk(tree).find(node => node.props?.type === 'radio').props.checked).toBe(false);
  });
  it('keeps existing correction decisions independent of matching suggestions', async () => {
    const decide = vi.fn().mockResolvedValue(undefined); const item = record({ correction: true, canApplyCorrection: false, canChooseDistinct: false });
    const component = () => ReconnectRecordReview({ record: item, accountName: 'New bank', disabled: false, onDecision: decide });
    const tree = render(component);
    expect(button(tree, 'Separate transaction · add to review')).toBeUndefined();
    expect(button(tree, 'Apply bank change · review classification again')).toBeUndefined();
    await button(tree, 'Keep my saved record unchanged').props.onClick();
    expect(decide).toHaveBeenCalledWith({ recordId: 'new-tx', version: 'reviewed-version', decision: 'keep_existing' });
  });
  it('shows old and new bank details and freezes the prior saved version for corrections', async () => {
    const decide = vi.fn().mockResolvedValue(undefined); const item = record({ correction: true, canApplyCorrection: true,
      previousRecord: { reference: 'saved/new-tx', version: 'prior-classification-version', accountId: 'new-account', date: '2026-07-31', amount: 24, merchant: 'Old coffee name', currency: 'USD', confirmed: true } });
    const component = () => ReconnectRecordReview({ record: item, accountName: 'New bank', disabled: false, onDecision: decide });
    const tree = render(component); expect(content(tree)).toContain('Previously saved'); expect(content(tree)).toContain('Old coffee name'); expect(content(tree)).toContain('$24.00');
    await button(tree, 'Apply bank change · review classification again').props.onClick();
    expect(decide).toHaveBeenCalledWith({ recordId: 'new-tx', version: 'reviewed-version', decision: 'apply_correction', previousVersion: 'prior-classification-version' });
  });
  it('makes correction application and deferral explicit', async () => {
    const decide = vi.fn().mockResolvedValue(undefined); const item = record({ correction: true, canApplyCorrection: true, event: 'removed' });
    const component = () => ReconnectRecordReview({ record: item, accountName: 'New bank', disabled: false, onDecision: decide });
    const tree = render(component); expect(content(tree)).toContain('bank removed this transaction');
    await button(tree, 'Apply bank removal').props.onClick(); await button(tree, 'Decide later').props.onClick();
    expect(decide).toHaveBeenNthCalledWith(1, { recordId: 'new-tx', version: 'reviewed-version', decision: 'apply_correction' });
    expect(decide).toHaveBeenNthCalledWith(2, { recordId: 'new-tx', version: 'reviewed-version', decision: 'defer' });
  });
});

describe('resumable review, pagination and activation', () => {
  it.each([{ historyReady: false }, { mappingComplete: false }, { pendingCount: 1 }])('does not activate before prerequisites are complete: %j', async extra => {
    responseView = view({ mappingComplete: true, mappings: { 'new-account': ['old-account'] }, pendingCount: 0, ...extra });
    expect(button(await mount(screen()), 'Activate bank connection').props.disabled).toBe(true);
  });
  it('requires deferred acknowledgment and displays active-but-unresolved history afterward', async () => {
    responseView = view({ mappingComplete: true, pendingCount: 0, deferredCount: 1, records: [record({ status: 'deferred' })] });
    const component = screen(); let tree = await mount(component);
    expect(button(tree, 'Activate bank connection').props.disabled).toBe(true);
    checkbox(tree, 'I understand that 1 records remain unresolved').props.onChange({ target: { checked: true } }); tree = render(component);
    responseView = { ...responseView, phase: 'active' };
    await button(tree, 'Activate bank connection').props.onClick(); await flush(); tree = render(component);
    expect(JSON.parse(h.request.mock.calls.at(-1)![1].body)).toEqual({ action: 'activate', sessionId: 'review-1', acknowledgeDeferred: true });
    expect(content(tree)).toContain('Bank reconnected · history review remains'); expect(content(tree)).not.toContain('history review complete');
    expect(walk(tree).find(node => node.type === ReconnectRecordReview)?.props.record.status).toBe('deferred');
  });
  it('loads all pages by opaque cursor and resets to remaining first page after a decision', async () => {
    responseView = view({ mappingComplete: true, nextCursor: 'cursor+/=' });
    const component = screen(); let tree = await mount(component);
    await button(tree, 'Next page').props.onClick(); tree = render(component);
    expect(h.request).toHaveBeenLastCalledWith('/api/plaid/reconnect?sessionId=review-1&cursor=cursor%2B%2F%3D', expect.anything());
    expect(content(tree)).toContain('Page 2');
    responseView = { ...responseView, records: [] };
    await walk(tree).find(node => node.type === ReconnectRecordReview).props.onDecision({ recordId: 'new-tx', version: 'reviewed-version', decision: 'defer' }); tree = render(component);
    expect(content(tree)).toContain('Page 1');
  });
  it('preserves the unresolved state and offers refresh when a stale decision is rejected', async () => {
    responseView = view({ mappingComplete: true }); const component = screen(); let tree = await mount(component);
    h.request.mockResolvedValueOnce(Response.json({ error: 'This record changed. Refresh before deciding.' }, { status: 409 }));
    await walk(tree).find(node => node.type === ReconnectRecordReview).props.onDecision({ recordId: 'new-tx', version: 'reviewed-version', decision: 'distinct' }); tree = render(component);
    expect(content(tree)).toContain('This record changed'); expect(content(tree)).toContain('1 need a decision');
    expect(button(tree, 'Activate bank connection').props.disabled).toBe(true);
  });
  it('does not show a stale previous-owner review after account switching', async () => {
    let uid = 'owner'; const component = () => PlaidReconnectScreen({ user: { id: uid }, sessionId: 'review-1' });
    await mount(component); h.request.mockImplementation(() => new Promise(() => {})); uid = 'other'; h.uid = 'other';
    const tree = render(component); expect(content(tree)).not.toContain('Reconnect in progress'); expect(content(tree)).not.toContain('Coffee');
  });
  it('rejects a response belonging to another reconnect session', async () => {
    responseView = view({ sessionId: 'different-review' }); const tree = await mount(screen());
    expect(content(tree)).toContain('could not be verified'); expect(content(tree)).not.toContain('Reconnect in progress');
  });
});
