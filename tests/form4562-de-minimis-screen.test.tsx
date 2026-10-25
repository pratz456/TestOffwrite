import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calc4562, DE_MINIMIS_SAFE_HARBOR_LIMIT, type Asset } from '@/lib/reports/calc4562';

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn() }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial: unknown) { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial; return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === 'function' ? (next as (value: unknown) => unknown)(h.slots[i]) : next; }]; },
    useEffect(effect: () => void | (() => void), deps: unknown[]) { const i = h.cursor++; const old = h.slots[i]; if (!same(old?.deps, deps)) { const next: any = { deps }; h.slots[i] = next; h.effects.push(() => { old?.cleanup?.(); next.cleanup = effect(); }); } },
    useRef(initial: unknown) { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = { current: initial }; return h.slots[i]; },
    useCallback(fn: unknown) { return fn; },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {} }) }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
vi.mock('@/components/ui/toast', () => ({ useToasts: () => ({ toasts: [], removeToast() {}, showSuccess() {}, showError() {} }), ToastContainer: () => null }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: (...args: unknown[]) => h.request(...args) }));
vi.mock('@/components/premium-feature-gate', () => ({ PremiumFeatureGate: ({ children }: { children: unknown }) => children }));
vi.mock('@/components/ui/card', () => ({ Card: ({ children }: { children: unknown }) => children }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children }: { children: unknown }) => children }));
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: () => null }));
vi.mock('@/components/ui/input', () => ({ Input: () => null }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children }: { children: unknown }) => children }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: unknown }) => children,
  SelectContent: ({ children }: { children: unknown }) => children,
  SelectItem: ({ children }: { children: unknown }) => children,
  SelectTrigger: ({ children }: { children: unknown }) => children,
  SelectValue: () => null,
}));
vi.mock('lucide-react', () => ({ ArrowLeft: () => null, Download: () => null, Calculator: () => null, Plus: () => null, Trash2: () => null, AlertCircle: () => null }));

import Form4562Page from '../app/protected/form4562/page';

const TAX_YEAR = 2026;
const text = (node: any): string => {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') {
    if (typeof node.type === 'function') return text(node.type(node.props));
    return text(node.props?.children);
  }
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
};
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const render = () => { h.cursor = 0; const tree = Form4562Page(); h.effects.splice(0).forEach(effect => effect()); return tree; };
const camera = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'camera', description: 'Camera', datePlacedInService: new Date(Date.UTC(TAX_YEAR, 9, 1)), cost: 1200, businessUsePercent: 40,
  category: 'equipment', method: 'MACRS_5YR', section179Requested: false, bonusEligible: false, ...overrides,
});
const expectNoListedQuestions = (content: string) => {
  expect(content).not.toContain('What kind of equipment is it?');
  expect(content).not.toContain('Answer now');
  expect(content).not.toContain('Do you use it in your main line of work?');
  expect(content).not.toContain('Do you use it only at your business location?');
  expect(content).not.toContain('Is that a studio or office outside your home?');
  expect(content).not.toContain('PLACEHOLDER: Used in my main line of work');
  expect(content).not.toContain('PLACEHOLDER: Used only at my business location');
};

beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; h.request.mockReset();
  vi.stubGlobal('window', { location: { search: '' } });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.UTC(TAX_YEAR, 6, 15, 12)));
});
afterEach(() => { h.slots.forEach(slot => slot?.cleanup?.()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Form 4562 worksheet screen', () => {
  it('shows no question for a $1,200 camera at 40 percent business use in an elected year', async () => {
    const asset = camera();
    const calculation = calc4562([asset], 50000, TAX_YEAR, { deMinimisSafeHarborYears: [TAX_YEAR] });
    const row = calculation.assets.find(item => item.asset.id === 'camera')!;
    expect(row.treatment).toBe('de_minimis_expense');
    expect(row.deMinimisExpense).toBe(480);
    h.request.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/tax/form-4562')) {
        return new Response(JSON.stringify({
          taxYear: TAX_YEAR, assets: [asset], calculation, businessIncome: 50000,
          elections: { deMinimisSafeHarborYears: [TAX_YEAR] }, deMinimisElected: true, deMinimisLimit: DE_MINIMIS_SAFE_HARBOR_LIMIT,
          section179Limits: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    render(); await flush();
    const content = text(render());
    expect(content).toContain('Camera');
    expect(content).toContain('expensed $480');
    expectNoListedQuestions(content);
    expect(content).not.toContain('PLACEHOLDER: This asset needs review.');
    expect(content).not.toContain('PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown.');
    expect(row.listedEquipmentHold).toBeNull();
    expect(calculation.heldAssets).toEqual([]);
  });

  it('shows no release questions for a $1,200 photo camera at 40 percent with blank answers in an elected year', async () => {
    const asset = camera({ listedEquipmentKind: 'photo_audio_video_communication' });
    const calculation = calc4562([asset], 50000, TAX_YEAR, { deMinimisSafeHarborYears: [TAX_YEAR] });
    const row = calculation.assets.find(item => item.asset.id === 'camera')!;
    expect(row.deMinimisExpense).toBe(480);
    h.request.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/tax/form-4562')) {
        return new Response(JSON.stringify({
          taxYear: TAX_YEAR, assets: [asset], calculation, businessIncome: 50000,
          elections: { deMinimisSafeHarborYears: [TAX_YEAR] }, deMinimisElected: true, deMinimisLimit: DE_MINIMIS_SAFE_HARBOR_LIMIT,
          section179Limits: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    render(); await flush();
    const content = text(render());
    expect(content).toContain('expensed $480');
    expectNoListedQuestions(content);
  });

  it('shows no question for the $1,200 camera when the worksheet is in review and the year is elected', async () => {
    const asset = camera();
    const van = camera({ id: 'van', description: 'Van', cost: 20000, businessUsePercent: 100, category: 'vehicle' });
    h.request.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.includes('/api/tax/form-4562')) {
        return new Response(JSON.stringify({
          error: 'Asset depreciation needs review: Confirm the asset class, vehicle limits and listed-property rules.',
          code: 'DEPRECIATION_REVIEW_REQUIRED',
          deMinimisElected: true,
          deMinimisLimit: DE_MINIMIS_SAFE_HARBOR_LIMIT,
        }), { status: 422, headers: { 'Content-Type': 'application/json' } });
      }
      if (path.includes('/api/settings/assets')) return new Response(JSON.stringify({ data: [asset, van] }), { status: 200 });
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    render(); await flush();
    const content = text(render());
    expect(content).toContain('Camera');
    expect(content).toContain('Van');
    expect(content).toContain('Confirm the asset class, vehicle limits and listed-property rules.');
    expectNoListedQuestions(content);
  });
});
