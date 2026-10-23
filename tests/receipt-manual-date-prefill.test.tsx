import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

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
function button(tree: Element, label: string) {
  const text = (node: any): string => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' ? node : '';
  return walk(tree).find(node => node.props?.onClick && text(node).trim() === label)!;
}
function shownDate(): string {
  const input = walk(render()).find(node => node.props?.type === 'file')!;
  input.props.onChange({ target: { files: [new File(['synthetic receipt'], 'receipt.png', { type: 'image/png' })], value: 'receipt.png' } });
  button(render(), 'Enter receipt details manually').props.onClick();
  return walk(render()).find(node => node.props?.id === 'receipt-date')!.props.value;
}

beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = [];
  harness.token.mockResolvedValue('synthetic-token');
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('manual receipt entry shows the local calendar day', () => {
  it('shows December 31 at 11:30 PM local time', () => {
    vi.setSystemTime(new Date(2025, 11, 31, 23, 30));
    expect(shownDate()).toBe('2025-12-31');
  });

  it('shows January 1 at 12:30 AM local time', () => {
    vi.setSystemTime(new Date(2026, 0, 1, 0, 30));
    expect(shownDate()).toBe('2026-01-01');
  });
});
