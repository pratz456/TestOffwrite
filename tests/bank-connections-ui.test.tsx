import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn(), notify: vi.fn(), success: vi.fn(), error: vi.fn(), connect: vi.fn() }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: h.request }));
vi.mock('@/lib/onboarding/profile-events', () => ({ notifyProfileUpdated: h.notify }));
vi.mock('sonner', () => ({ toast: { success: h.success, error: h.error } }));
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
import { BanksDetailScreen } from '@/components/banks-detail-screen';
type Element = ReactElement<Record<string, any>>;
const walk = (node: any): Element[] => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : [];
const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');
let owner = 'bank-owner';
let items: any[], accounts: any[];
function render() { h.cursor = 0; const tree = BanksDetailScreen({ user: { id: owner }, onBack() {}, onConnectBank: h.connect }); h.effects.splice(0).forEach(f => f()); return tree; }
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
async function mount() { render(); await flush(); return render(); }
function button(label: string) { return walk(render()).find(n => n.props?.onClick && (text(n) === label || n.props['aria-label'] === label))!; }
beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; vi.clearAllMocks(); owner = 'bank-owner';
  items = [ { itemId: 'item-one', accountIds: ['acc-one'], status: 'active', relinkRequired: false }, { itemId: 'item-two', accountIds: ['acc-two'], status: 'active', relinkRequired: false } ];
  accounts = [ { account_id: 'acc-one', plaid_item_id: 'item-one', name: 'First Bank', balance: 25 }, { account_id: 'acc-two', plaid_item_id: 'item-two', name: 'Second Bank', balance: 100 }, { account_id: 'manual', name: 'Manual records' } ];
  h.request.mockImplementation(async (url: string, options: RequestInit = {}) => {
    if (options.method === 'DELETE') { items = items.filter(item => !url.endsWith(item.itemId)); return Response.json({ success: true }); }
    if (url === '/api/plaid/items') return Response.json({ items });
    if (url === '/api/database/accounts') return Response.json({ accounts });
    return Response.json({ transactions_saved: 1 });
  });
});

describe('bank management keeps each connection and saved records separate', () => {
  it('disconnects only the selected item and retains its history, the other bank, and manual accounts', async () => {
    await mount(); button('Disconnect First Bank').props.onClick();
    walk(render()).find(n => n.props?.onConfirm)!.props.onConfirm(); await flush();
    expect(h.request).toHaveBeenCalledWith('/api/plaid/items/item-one', { method: 'DELETE' });
    expect(h.request.mock.calls.some(([url, options]) => url === '/api/plaid/items' && options?.method === 'DELETE')).toBe(false);
    expect(h.notify).toHaveBeenCalledWith(owner);
    const content = text(render()); expect(content).toContain('First Bank'); expect(content).toContain('Second Bank'); expect(content).toContain('Manual records'); expect(content).toContain('1 connected');
  });
  it('does not clear records or claim success when disconnection fails', async () => {
    await mount(); h.request.mockResolvedValueOnce(Response.json({ error: 'Connection is busy' }, { status: 409 }));
    button('Disconnect First Bank').props.onClick(); walk(render()).find(n => n.props?.onConfirm)!.props.onConfirm(); await flush();
    expect(text(render())).toContain('2 connected'); expect(h.success).not.toHaveBeenCalled(); expect(h.error).toHaveBeenCalledWith('Connection is busy');
  });
  it('repairs the selected current item but creates a fresh connection for the old provider account', async () => {
    await mount(); button('Repair connection').props.onClick(); expect(h.connect).toHaveBeenCalledWith('item-one');
    items[0] = { ...items[0], status: 'relink_required', relinkRequired: true };
    h.slots = []; await mount(); button('Reconnect bank').props.onClick(); expect(h.connect).toHaveBeenLastCalledWith(undefined);
  });
  it('sends the exact item when syncing and never makes up a missing balance', async () => {
    await mount(); button('Sync').props.onClick(); await flush();
    expect(h.request).toHaveBeenCalledWith('/api/plaid/sync-transactions', expect.objectContaining({ body: JSON.stringify({ incremental: true, itemId: 'item-one' }) }));
    expect(text(render())).toContain('Unavailable'); expect(text(render())).not.toContain('0 transactions');
  });
  it('hides old account data immediately when the signed-in user changes', async () => {
    await mount(); h.request.mockImplementation(() => new Promise(() => {})); owner = 'other-owner';
    const content = text(render()); expect(content).not.toContain('First Bank'); expect(content).not.toContain('Manual records');
  });
});
