import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn() }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: unknown) { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial; return [h.slots[i], (next: unknown) => { h.slots[i] = typeof next === 'function' ? next(h.slots[i]) : next; }]; },
    useEffect(effect: () => void | (() => void), deps: unknown[]) { const i = h.cursor++, old = h.slots[i]; if (!same(old?.deps, deps)) { const next: any = { deps }; h.slots[i] = next; h.effects.push(() => { old?.cleanup?.(); next.cleanup = effect(); }); } },
    useRef(initial: unknown) { const i = h.cursor++; if (!(i in h.slots)) h.slots[i] = { current: initial }; return h.slots[i]; },
    useCallback(fn: unknown, deps: unknown[]) { const i = h.cursor++; const old = h.slots[i]; if (!old || !same(old.deps, deps)) h.slots[i] = { deps, fn }; return h.slots[i].fn; },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: h.request }));
import { QuarterlyPaymentTrackingScreen } from '@/components/quarterly-payment-tracking-screen';

const walk = (n: any): any[] => Array.isArray(n) ? n.flatMap(walk) : n && typeof n === 'object' ? [n, ...walk(n.props?.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props?.children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '';
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const year = new Date().getFullYear();

function payment(quarter: number, recorded: boolean) {
  return {
    quarter, year, deadline: new Date(Date.UTC(year, quarter === 4 ? 0 : [3, 5, 8][quarter - 1], 15)).toISOString(),
    estimatedAmount: 0, paidAmount: recorded ? 2125 : 0, paidDate: recorded ? `${year}-04-01` : null,
    confirmationNumber: recorded ? 'OLD-CONF' : null, paymentMethod: recorded ? 'Check' : null,
    status: recorded ? 'recorded' : 'no_record', notes: recorded ? 'old note' : '',
  };
}

function render() {
  h.cursor = 0;
  const tree = QuarterlyPaymentTrackingScreen({ user: { id: 'owner-a' }, onBack() {} });
  h.effects.splice(0).forEach(effect => effect());
  return tree;
}

beforeEach(() => { h.slots = []; h.cursor = 0; h.effects = []; h.request.mockReset(); });
afterEach(() => { h.slots.forEach(slot => slot?.cleanup?.()); });

describe('quarterly payment tracking edits', () => {
  it('sends the legacy record id when the user edits a recorded payment', async () => {
    h.request.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST') return Response.json({ ok: true });
      return Response.json({
        payments: [payment(1, true), payment(2, false), payment(3, false), payment(4, false)],
        summary: { totalEstimated: 0, totalPaid: 2125, totalRemaining: 0, totalPenalty: null },
      });
    });
    render();
    await flush();
    expect(String(h.request.mock.calls[0][0])).toContain(`/api/tax/quarterly-payments?year=${year}`);
    const loaded = render();
    expect(text(loaded)).toContain('Confirmation: OLD-CONF');
    const record = walk(loaded).filter(node => node.props?.onClick && text(node) === 'Record Payment');
    expect(record.length).toBeGreaterThan(0);
    record[0].props.onClick();
    const opened = render();
    const openedText = text(opened);
    if (!openedText.includes('Amount paid')) throw new Error(`form did not open: ${openedText.slice(0, 500)}`);
    fill(opened, '2000', `${year}-04-12`);
    await walk(render()).find(node => node.props?.onClick && text(node) === 'Save Payment').props.onClick();
    await flush();
    const posts = () => h.request.mock.calls.map(call => call[1]).filter(init => init?.method === 'POST').map(init => JSON.parse(init.body));
    expect(posts()[0]).toMatchObject({ recordId: `Q1_${year}`, quarter: 1, year, paidAmount: 2000 });
    const again = render();
    const recordButtons = walk(again).filter(node => node.props?.onClick && text(node) === 'Record Payment');
    recordButtons[1].props.onClick();
    fill(render(), '50', `${year}-06-15`);
    await walk(render()).find(node => node.props?.onClick && text(node) === 'Save Payment').props.onClick();
    expect(posts()[1]).toMatchObject({ quarter: 2, year, paidAmount: 50 });
    expect(posts()[1]).not.toHaveProperty('recordId');
  });
});

function fill(tree: unknown, amount: string, date: string) {
  walk(tree).find(node => node.props?.placeholder === '0.00').props.onChange({ target: { value: amount } });
  walk(tree).find(node => node.props?.type === 'date').props.onChange({ target: { value: date } });
}
