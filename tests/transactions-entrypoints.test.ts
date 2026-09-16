import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';

// Run the real page/form handlers with controlled hook state and network calls.
const harness = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, push: vi.fn(), request: vi.fn() }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useState(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [harness.slots[index], (next: unknown) => { harness.slots[index] = typeof next === 'function' ? next(harness.slots[index]) : next; }];
    },
    useMemo<T>(factory: () => T) { return factory(); },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: harness.push }) }));
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: { id: 'new-accountless-user' } }) }));
vi.mock('@/lib/firebase/hooks', () => ({ useTransactions: () => ({ transactions: [], isLoading: false, error: null }) }));
vi.mock('@/components/sync-status-indicator', () => ({ SyncStatusIndicator: () => null }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
import TransactionsPage from '../app/protected/transactions/page';
import { AddManualTransactionScreen } from '../components/add-manual-transaction-screen';

type Props = {
  children?: unknown; type?: string; placeholder?: string; value?: unknown; 'aria-label'?: string;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
  onSubmit?: (event: { preventDefault(): void }) => Promise<void>;
};
type Element = ReactElement<Props>;
function render(component: () => ReactElement) { harness.cursor = 0; return component(); }
function walk(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  return isValidElement<Props>(node) ? [node, ...walk(node.props.children)] : [];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (isValidElement<Props>(node)) return text(node.props.children);
  return typeof node === 'string' ? node : '';
}
function manualForm() { return AddManualTransactionScreen({ user: { id: 'new-accountless-user' }, onBack() {} }); }
function enterExpense() {
  walk(render(manualForm)).find(node => node.props?.placeholder === 'e.g. Adobe, Staples, AWS')!.props.onChange!({ target: { value: 'Synthetic office supplies' } });
  walk(render(manualForm)).find(node => node.props?.type === 'number')!.props.onChange!({ target: { value: '42.50' } });
  return walk(render(manualForm)).find(node => node.type === 'form')!;
}
beforeEach(() => { harness.slots = []; harness.cursor = 0; vi.resetAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('transaction page actions reach working accountless flows', () => {
  it.each([
    ['Upload receipt', '/protected?screen=receipt-upload'],
    ['Add transaction', '/protected?screen=add-manual-transaction'],
  ])('%s navigates to its real form', (label, url) => {
    const page = render(TransactionsPage);
    const action = walk(page).find(node => node.props?.['aria-label'] === label);
    expect(action).toBeDefined();
    action!.props.onClick!();
    expect(harness.push).toHaveBeenCalledExactlyOnceWith(url);
    expect(walk(page).some(node => node.type === 'input' && node.props.type === 'file')).toBe(false);
  });

  it('the destination expense form saves through the authenticated API without a linked bank', async () => {
    harness.request.mockResolvedValue(Response.json({ success: true }, { status: 201 }));
    await enterExpense().props.onSubmit!({ preventDefault() {} });
    expect(harness.request).toHaveBeenCalledOnce();
    const [url, options] = harness.request.mock.calls[0];
    expect(url).toBe('/api/transactions/manual');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toMatchObject({ merchant_name: 'Synthetic office supplies', amount: 42.5, type: 'expense', iso_currency_code: 'USD' });
    expect(JSON.parse(options.body)).not.toHaveProperty('account_id');
    expect(text(render(manualForm))).toContain('Expense saved');
  });

  it('the destination preserves entered details and shows a failed save instead of success', async () => {
    harness.request.mockResolvedValue(Response.json({ error: 'Unable to save this expense. Please retry.' }, { status: 503 }));
    await enterExpense().props.onSubmit!({ preventDefault() {} });
    const form = render(manualForm);
    expect(text(form)).toContain('Unable to save this expense. Please retry.');
    expect(text(form)).not.toContain('Expense saved');
    expect(walk(form).find(node => node.props?.placeholder === 'e.g. Adobe, Staples, AWS')!.props.value).toBe('Synthetic office supplies');
  });
});
