import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], fetch: vi.fn(), user: { uid: 'owner', filing_status: 'single' } }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useState(initial: unknown) { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial; return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === 'function' ? (next as (value: unknown) => unknown)(h.slots[i]) : next; }]; },
    useEffect(effect: () => void | (() => void), deps: unknown[]) { const i = h.cursor++; const old = h.slots[i]; if (!same(old?.deps, deps)) { const next: any = { deps }; h.slots[i] = next; h.effects.push(() => { old?.cleanup?.(); next.cleanup = effect(); }); } },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {} }) }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('@/components/ui/toast', () => ({ useToasts: () => ({ toasts: [], removeToast() {}, showSuccess() {}, showError() {} }), ToastContainer: () => null }));
vi.mock('@/lib/firebase/client', () => ({ auth: { currentUser: { getIdToken: async () => 'token' } } }));
vi.mock('@/components/premium-feature-gate', () => ({ PremiumFeatureGate: ({ children }: { children: unknown }) => children }));
vi.mock('@/components/ui/card', () => ({ Card: ({ children }: { children: unknown }) => children }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children }: { children: unknown }) => children }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: unknown }) => children,
  SelectContent: ({ children }: { children: unknown }) => children,
  SelectItem: ({ children }: { children: unknown }) => children,
  SelectTrigger: ({ children }: { children: unknown }) => children,
  SelectValue: () => null,
}));
vi.mock('lucide-react', () => ({ ArrowLeft: () => null, Download: () => null, User: () => null, AlertCircle: () => null, CheckCircle: () => null }));

import ScheduleSEPage from '../app/protected/scheduleSE/page';

const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const MESSAGE = 'PLACEHOLDER: An equipment asset needs an answer or review before this figure can be shown.';
const render = () => { h.cursor = 0; const tree = ScheduleSEPage(); h.effects.splice(0).forEach(effect => effect()); return tree; };

beforeEach(() => {
  h.slots = []; h.cursor = 0; h.effects = []; h.fetch.mockReset();
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => h.fetch(String(input), init);
  vi.stubGlobal('fetch', fetchImpl);
  globalThis.fetch = fetchImpl as typeof fetch;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.UTC(2026, 6, 15, 12)));
});
afterEach(() => { h.slots.forEach(slot => slot?.cleanup?.()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Schedule SE page', () => {
  it('shows the review message and no profit when the auto route is in depreciation review', async () => {
    h.fetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/tax/schedule-se/auto')) {
        return new Response(JSON.stringify({ error: `Asset depreciation needs review: ${MESSAGE}`, code: 'DEPRECIATION_REVIEW_REQUIRED' }), { status: 422, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: { scheduleCNetProfit: 99999, taxYear: 2026 } }), { status: 200 });
    });
    render(); await flush();
    const content = text(render());
    expect(content).toContain(MESSAGE);
    expect(content).not.toContain('99999');
    expect(content).not.toContain('Schedule C Net Profit');
  });

  it('shows the auto calculation when nothing is held', async () => {
    h.fetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/tax/schedule-se/auto')) {
        return new Response(JSON.stringify({
          netProfit: 4000,
          calculation: {
            netEarnings: 3694, seBase: 3694, totalSETax: 565.13, halfSEDeduction: 282.57,
            socialSecurityTax: 457.66, medicareTax: 107.13, additionalMedicareTax: 0,
            netProfitFromScheduleC: 4000, adjustments: 0,
          },
        }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });
    render(); await flush();
    const content = text(render());
    expect(content).toContain('4000.00');
    expect(content).toContain('3694');
    expect(content).not.toContain(MESSAGE);
    expect(h.fetch.mock.calls.some(call => String(call[0]).includes('tax-summary'))).toBe(false);
  });
});
