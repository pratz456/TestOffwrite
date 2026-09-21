import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], api: vi.fn(), error: vi.fn(), success: vi.fn(), user: { id: 'settings-owner' } }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[] | undefined) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useRef(initial: unknown) { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = { current: initial }; return harness.slots[index]; },
    useState(initial: any) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [harness.slots[index], (next: any) => { harness.slots[index] = typeof next === 'function' ? next(harness.slots[index]) : next; }];
    },
    useMemo(factory: () => unknown, deps: unknown[]) {
      const index = harness.cursor++;
      if (!same(harness.slots[index]?.deps, deps)) harness.slots[index] = { deps, value: factory() };
      return harness.slots[index].value;
    },
    useCallback(callback: unknown, deps: unknown[]) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = harness.cursor++;
      if (!same(harness.slots[index]?.deps, deps)) { harness.slots[index]?.cleanup?.(); harness.slots[index] = { deps }; harness.effects.push(() => { harness.slots[index].cleanup = effect(); }); }
    },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: harness.user }) }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.api }));
vi.mock('@/components/ui/toast', () => ({ useToasts: () => ({ showSuccess: harness.success, showError: harness.error }) }));
import { TaxFormsSetupScreen } from '../components/tax-forms-setup-screen';
function render() { harness.cursor = 0; const tree = TaxFormsSetupScreen(); harness.effects.splice(0).forEach(effect => effect()); return tree; }
function walk(node: any): any[] { if (Array.isArray(node)) return node.flatMap(walk); if (!node || typeof node !== 'object') return []; return [node, ...walk(node.props?.children)]; }
function text(node: any): string { return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? ''); }
const existing = { id: 'saved-asset', description: 'Existing computer', datePlacedInService: '2026-03-01', cost: 2000, businessUsePercent: 50, category: 'computer', method: 'MACRS_5YR' };
const payload = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
async function settle() { await new Promise(resolve => setTimeout(resolve, 0)); }
beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = []; harness.api.mockReset(); harness.error.mockReset(); harness.success.mockReset(); harness.user = { id: 'settings-owner' };
  harness.api.mockImplementation(async (url: string) => payload(url.endsWith('/assets') ? [existing] : url.endsWith('/home-office') ? { totalHomeSqFt: 1500, officeSqFt: 200, rentOrMortgageInterest: 12000, utilities: 1200 } : { taxYear: 2026, scheduleCNetProfit: 10000, adjustments: 50 }));
});
afterEach(() => vi.restoreAllMocks());
describe('saved tax settings are loaded before editing', () => {
  it('preserves saved home-office values and does not re-post existing assets', async () => {
    expect(text(render())).toContain('Loading saved tax settings'); await settle();
    let tree = render(); expect(walk(tree).find(node => node.props?.id === 'totalHomeSqFt').props.value).toBe(1500);
    await walk(tree).find(node => text(node).trim() === 'Save Home Office Settings' && node.props?.onClick).props.onClick();
    const post = harness.api.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(post![1].body)).toMatchObject({ totalHomeSqFt: 1500, officeSqFt: 200, rentOrMortgageInterest: 12000 });
    walk(render()).find(node => node.type === 'button' && text(node).trim() === 'Assets').props.onClick();
    tree = render(); expect(text(tree)).toContain('Existing computer');
    expect(walk(tree).find(node => node.props?.onClick && text(node).trim() === 'Save Assets').props.disabled).toBe(true);
  });
  it('blocks editing and saving after a partial settings read fails', async () => {
    harness.api.mockImplementation(async (url: string) => url.endsWith('/assets') ? new Response('{}', { status: 503 }) : payload(null));
    render(); await settle(); const tree = render();
    expect(text(tree)).toContain('Could not load saved tax settings');
    expect(walk(tree).some(node => node.props?.id === 'totalHomeSqFt')).toBe(false);
    expect(harness.api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
  it('deletes saved assets on the server and keeps them visible if deletion fails', async () => {
    render(); await settle(); walk(render()).find(node => node.type === 'button' && text(node).trim() === 'Assets').props.onClick();
    harness.api.mockResolvedValue(new Response('{}', { status: 503 }));
    await walk(render()).find(node => node.props?.['aria-label'] === 'Remove Existing computer').props.onClick();
    expect(text(render())).toContain('Existing computer'); expect(harness.error).toHaveBeenCalled();
    harness.api.mockResolvedValue(payload(null));
    await walk(render()).find(node => node.props?.['aria-label'] === 'Remove Existing computer').props.onClick();
    expect(text(render())).not.toContain('Existing computer');
    expect(harness.api.mock.calls.at(-1)?.[1]).toMatchObject({ method: 'DELETE', body: JSON.stringify({ assetId: 'saved-asset' }) });
  });
  it('does not reveal the previous account settings while the next account loads', async () => {
    render(); await settle(); render(); harness.user = { id: 'next-owner' }; harness.api.mockReturnValue(new Promise(() => {}));
    expect(text(render())).toContain('Loading saved tax settings');
    expect(walk(render()).some(node => node.props?.id === 'totalHomeSqFt')).toBe(false);
  });
  it('saves only new assets, preserves zero business use and cannot duplicate on a second save', async () => {
    render(); await settle(); walk(render()).find(node => node.type === 'button' && text(node).trim() === 'Assets').props.onClick();
    for (const [id, value] of [['assetDescription', 'New monitor'], ['assetDate', '2026-05-01'], ['assetCost', '400'], ['assetBusinessUse', '0']]) {
      walk(render()).find(node => node.props?.id === id).props.onChange({ target: { value } });
    }
    walk(render()).find(node => node.props?.onClick && text(node).trim() === 'Add Asset').props.onClick();
    harness.api.mockImplementation(async (_url: string, options: { body: string }) => payload([{ ...JSON.parse(options.body).assets[0], id: 'new-server-id' }]));
    await walk(render()).find(node => node.props?.onClick && text(node).trim() === 'Save Assets').props.onClick();
    const posts = harness.api.mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(posts).toHaveLength(1); expect(JSON.parse(posts[0][1].body).assets).toMatchObject([{ description: 'New monitor', businessUsePercent: 0 }]);
    expect(text(render())).toContain('Existing computer');
    expect(walk(render()).find(node => node.props?.onClick && text(node).trim() === 'Save Assets').props.disabled).toBe(true);
    await walk(render()).find(node => node.props?.onClick && text(node).trim() === 'Save Assets').props.onClick();
    expect(harness.api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });

  it('coalesces rapid asset save clicks before a React render', async () => {
    render(); await settle(); walk(render()).find(node => node.type === 'button' && text(node).trim() === 'Assets').props.onClick();
    for (const [id, value] of [['assetDescription', 'Rapid click monitor'], ['assetDate', '2026-05-01'], ['assetCost', '400']]) walk(render()).find(node => node.props?.id === id).props.onChange({ target: { value } });
    walk(render()).find(node => node.props?.onClick && text(node).trim() === 'Add Asset').props.onClick();
    let finish!: (response: Response) => void;
    harness.api.mockReturnValue(new Promise<Response>(resolve => { finish = resolve; }));
    const handler = walk(render()).find(node => node.props?.onClick && text(node).trim() === 'Save Assets').props.onClick;
    const first = handler(); const second = handler();
    expect(harness.api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    finish(payload([{ ...existing, id: 'saved-new' }])); await Promise.all([first, second]);
  });
  it.each(['POST', 'DELETE'])('ignores a late %s response after an account switch', async method => {
    render(); await settle(); walk(render()).find(node => node.type === 'button' && text(node).trim() === 'Assets').props.onClick();
    if (method === 'POST') {
      for (const [id, value] of [['assetDescription', 'Old account draft'], ['assetDate', '2026-05-01'], ['assetCost', '400']]) walk(render()).find(node => node.props?.id === id).props.onChange({ target: { value } });
      walk(render()).find(node => node.props?.onClick && text(node).trim() === 'Add Asset').props.onClick();
    }
    let finish!: (response: Response) => void;
    harness.api.mockReturnValue(new Promise<Response>(resolve => { finish = resolve; }));
    const handler = walk(render()).find(node => method === 'POST' ? node.props?.onClick && text(node).trim() === 'Save Assets' : node.props?.['aria-label'] === 'Remove Existing computer').props.onClick;
    const pending = handler();
    const options = harness.api.mock.calls.at(-1)![1];
    const collisionId = method === 'POST' ? JSON.parse(options.body).assets[0].id : existing.id;
    harness.user = { id: 'next-owner' };
    harness.api.mockImplementation(async (url: string) => payload(url.endsWith('/assets') ? [{ ...existing, id: collisionId, description: 'Next account asset' }] : null));
    render(); await settle(); render(); harness.success.mockClear();
    finish(payload([{ ...existing, id: 'old-response', description: 'Old response secret' }])); await pending;
    const tree = render(); expect(text(tree)).toContain('Next account asset'); expect(text(tree)).not.toContain('Old response secret');
    expect(harness.success).not.toHaveBeenCalled();
  });

});
