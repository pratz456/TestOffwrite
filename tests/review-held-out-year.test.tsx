import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../lib/firebase/transactions';

const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useState(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [harness.slots[index], (value: unknown) => { harness.slots[index] = typeof value === 'function' ? (value as (current: unknown) => unknown)(harness.slots[index]) : value; }];
    },
    useRef(initial: unknown) { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = { current: initial }; return harness.slots[index]; },
    useEffect() {},
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: vi.fn() }));
vi.mock('@/lib/hooks/use-ai-availability', () => ({ useAiAvailability: () => ({ status: 'configured', refresh: vi.fn(), message: '' }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
import { ReviewTransactionsScreen } from '../components/review-transactions-screen';

const row = (id: string, year: number, amount: number, merchant: string, reason: string): Transaction => ({
  id, trans_id: id, merchant_name: merchant, amount, category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', date: `${year}-06-15`,
  iso_currency_code: 'USD', is_deductible: true, review_status: 'confirmed', possibleDuplicate: true, possibleDuplicateReason: reason,
} as Transaction);
const transactions = [
  row('credit-2026', 2026, -25000, 'Flagged deposit', 'legacy_match'),
  row('debit-2026', 2026, 40, 'Flagged supplies', 'bank_linked'),
  row('debit-2025', 2025, 80, 'Other year supplies', 'cross_document'),
];
function walk(node: unknown): any[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== 'object') return [];
  return [node, ...walk((node as { props?: { children?: unknown } }).props?.children)];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object' && 'props' in node) return text((node as { props?: { children?: unknown } }).props?.children);
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}
function duplicates(year: string) {
  harness.slots = [];
  harness.cursor = 0;
  const tree = ReviewTransactionsScreen({ user: { id: 'owner' }, onBack() {}, transactions, onTransactionUpdate() {}, onTransactionClick() {} });
  const node = walk(tree).find(item => item?.type?.name === 'PossibleDuplicatesReview');
  expect(node).toBeTruthy();
  harness.slots = [];
  harness.cursor = 0;
  const opened = node.type(node.props);
  const select = walk(opened).find(item => item.type === 'select');
  expect(select).toBeTruthy();
  expect(walk(select).filter(item => item.type === 'option').map(item => item.props.value)).toEqual(['2026', '2025', '2024']);
  select.props.onChange({ target: { value: year } });
  harness.cursor = 0;
  return text(node.type(node.props));
}
beforeEach(() => { harness.slots = []; harness.cursor = 0; });

describe('review possible duplicates follow the selected tax year', () => {
  it('counts and lists only the selected year when flagged rows exist in two years', () => {
    const year2026 = duplicates('2026');
    expect(year2026).toContain('2 possible duplicate rows');
    expect(year2026).toContain('Flagged deposit');
    expect(year2026).toContain('Flagged supplies');
    expect(year2026).toContain('$25,000.00');
    expect(year2026).toContain('$40.00');
    expect(year2026).not.toContain('Other year supplies');
    expect(year2026).not.toContain('$80.00');
    expect(year2026).not.toMatch(/legacy_match|bank_linked|cross_document|ambiguous_account|statement_match/);
    const year2025 = duplicates('2025');
    expect(year2025).toContain('1 possible duplicate row is');
    expect(year2025).toContain('review it');
    expect(year2025).toContain('Other year supplies');
    expect(year2025).toContain('$80.00');
    expect(year2025).not.toContain('Flagged deposit');
    expect(year2025).not.toContain('Flagged supplies');
    expect(year2025).not.toContain('$25,000.00');
    expect(year2025).not.toContain('$40.00');
    expect(year2025).not.toMatch(/legacy_match|bank_linked|cross_document/);
  });
});
