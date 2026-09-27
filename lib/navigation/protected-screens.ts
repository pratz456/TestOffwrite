const screens = [
  'dashboard', 'settings', 'receipt-upload', 'transactions',
  'review-transactions', 'schedule-c-export',
  'banks-detail', 'categories', 'plaid-link',
  'transaction-detail', 'reports', 'ai-insights', 'quarterly-taxes',
  'mileage-tracker', 'income-tracking',
  'tax-assistant', 'quarterly-payments', 'action-items',
  'add-manual-transaction', 'tax-filing-hub', 'tax-organizer', 'w2-income', 'tax-preview',
  'deductions-entry', 'form-8879', 'document-import',
] as const;

export type ProtectedScreen = typeof screens[number];

export function protectedScreen(raw: string | null | undefined): ProtectedScreen {
  const name = raw?.split('?')[0];
  if (name === 'categorize' || name === 'add-expense') return 'add-manual-transaction';
  if (name === 'edit-expense') return 'transactions';
  if (name === 'plaid') return 'banks-detail';
  if (name === 'tax-calendar') return 'quarterly-taxes';
  if (name === 'deductions-detail') return 'deductions-entry';
  if (name === 'expenses-detail') return 'transactions';
  if (name === 'profit-loss-detail' || name === 'profit-loss-report') return 'reports';
  if (name === 'tax-form-wizard') return 'tax-filing-hub';
  if (name === 'state-tax-calculator') return 'tax-preview';
  return screens.includes(name as ProtectedScreen) ? name as ProtectedScreen : 'dashboard';
}

/** Screen transitions and Back use the same URL, including entry from a direct link. */
export function protectedScreenUrl(raw: string): string {
  const screen = protectedScreen(raw);
  if (screen === 'dashboard') return '/protected';
  const query = new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '');
  if (screen === 'settings') {
    const target = new URLSearchParams();
    if (/^[a-z-]+$/.test(query.get('tab') ?? '')) target.set('tab', query.get('tab')!);
    return `/protected/settings${target.size ? `?${target.toString()}` : ''}`;
  }
  if (screen === 'reports') {
    const target = new URLSearchParams();
    const year = Number(query.get('year'));
    if (Number.isInteger(year) && year >= 2000 && year <= new Date().getUTCFullYear()) target.set('year', String(year));
    return `/protected/reports${target.size ? `?${target.toString()}` : ''}`;
  }
  if (screen === 'transactions') return '/protected/transactions';
  const target = new URLSearchParams({ screen });
  if (query.has('from')) target.set('from', protectedScreen(query.get('from')));
  if ((screen === 'transaction-detail' || screen === 'review-transactions') && query.get('transactionId')) target.set('transactionId', query.get('transactionId')!);
  if (screen === 'transaction-detail' && query.get('section') === 'details') target.set('section', 'details');
  if (screen === 'plaid-link' && /^[A-Za-z0-9_-]{1,128}$/.test(query.get('itemId') ?? '')) target.set('itemId', query.get('itemId')!);
  if (screen === 'income-tracking') {
    // Deep link from an income-reconciliation notice: open one tab for one tax year.
    if (/^[a-z]+$/.test(query.get('tab') ?? '')) target.set('tab', query.get('tab')!);
    if (/^\d{4}$/.test(query.get('year') ?? '')) target.set('year', query.get('year')!);
  }
  return `/protected?${target.toString()}`;
}

export function previousProtectedScreen(current: ProtectedScreen, stack: readonly string[], from?: string | null) {
  const remaining = [...stack];
  while (remaining.length && remaining[remaining.length - 1] === current) remaining.pop();
  const previous = current === 'transaction-detail' && from
    ? protectedScreen(from)
    : protectedScreen(remaining.pop());
  return { screen: previous === current ? 'dashboard' as const : previous, stack: remaining };
}
