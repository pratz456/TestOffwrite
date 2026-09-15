import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// Execute the real receipt handlers with a small hook scheduler; this tests
// client state and outgoing requests, not browser layout or OCR provider output.
const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], token: vi.fn() }));
vi.mock('@/lib/firebase/client', () => ({ auth: { currentUser: { getIdToken: harness.token } } }));
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
import { ReceiptUploadScreen } from '../components/receipt-upload-screen';

type Element = ReactElement<Record<string, any>>;
function render() {
  harness.cursor = 0;
  const tree = ReceiptUploadScreen({ user: { id: 'receipt-owner' }, onBack() {}, onUploadComplete() {} }) as Element;
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
function button(tree: Element, label: string) { return walk(tree).find(node => node.props?.onClick && text(node).trim() === label)!; }
function selectImage() {
  const input = walk(render()).find(node => node.props?.type === 'file')!;
  input.props.onChange({ target: { files: [new File(['synthetic receipt'], 'receipt.png', { type: 'image/png' })], value: 'receipt.png' } });
}
let commits: FormData[] = [];
beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = []; commits = [];
  harness.token.mockResolvedValue('synthetic-token');
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body as FormData;
    if (body.get('mode') === 'commit') {
      commits.push(body);
      return Response.json({ transaction: { id: 'bank-expense', amount: 100 }, receiptUrl: '/api/receipts/private' });
    }
    return Response.json({ ocrResult: { merchant: 'Matched vendor', amount: 100, date: '2026-09-15', category: 'Supplies', confidence: .9 }, matchCandidates: [{ trans_id: 'bank-expense', merchant_name: 'Matched vendor', amount: 100, date: '2026-09-15', confidence: .95 }] });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('editing a receipt preserves the chosen bank attachment', () => {
  it.each(['Edit Manually', 'Enter receipt details manually'])('does not silently create a duplicate after %s', async label => {
    selectImage();
    await button(render(), 'Process Receipt').props.onClick();
    button(render(), label).props.onClick();
    const reviewed = render();
    expect(walk(reviewed).find(node => node.type === 'select' && node.props.value === 'attach')).toBeDefined();
    await button(reviewed, 'Confirm & Save').props.onClick();
    expect(commits).toHaveLength(1);
    expect(commits[0].get('attachTransactionId')).toBe('bank-expense');
    expect(commits[0].has('receiptData')).toBe(false);
  });
  it('creates a new transaction only after the user explicitly selects New transaction', async () => {
    selectImage(); await button(render(), 'Process Receipt').props.onClick();
    button(render(), 'Edit Manually').props.onClick();
    const choice = walk(render()).find(node => node.type === 'select' && node.props.value === 'attach')!;
    choice.props.onChange({ target: { value: 'create' } });
    const fields = render();
    walk(fields).find(node => node.props?.id === 'receipt-amount')!.props.onChange({ target: { value: '125.50' } });
    await button(render(), 'Confirm & Save').props.onClick();
    expect(commits[0].has('attachTransactionId')).toBe(false);
    expect(JSON.parse(String(commits[0].get('receiptData'))).amount).toBe(125.5);
  });
});
