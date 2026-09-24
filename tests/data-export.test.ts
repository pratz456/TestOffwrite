import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), fail: '', reads: [] as string[], counts: [] as string[] }));
vi.mock('@/lib/firebase/admin', () => {
  function doc(path: string) { return { id: path.split('/').at(-1)!, ref: { path }, exists: state.rows.has(path), data: () => state.rows.get(path), get: async () => doc(path), collection: (name: string) => query(`${path}/${name}`) }; }
  function query(path: string, group = false, filters: [string, unknown][] = []) {
    const matching = () => [...state.rows].filter(([key, value]) => (group ? key.split('/').at(-2) === path : key.slice(0, key.lastIndexOf('/')) === path)
      && filters.every(([field, wanted]) => value[field] === wanted));
    return { doc: (id: string) => doc(`${path}/${id}`), where: (field: string, _op: string, value: unknown) => query(path, group, [...filters, [field, value]]),
      count: () => ({ get: async () => { state.counts.push(path); return { data: () => ({ count: matching().length }) }; } }),
      get: async () => {
        state.reads.push(path); if (state.fail === path) throw Error('private database credentials');
        const docs = [...state.rows].filter(([key, value]) => (group ? key.split('/').at(-2) === path : key.slice(0, key.lastIndexOf('/')) === path)
          && filters.every(([field, wanted]) => value[field] === wanted)).map(([key]) => doc(key));
        return { docs, empty: !docs.length };
      } };
  }
  return { adminDb: { collection: (path: string) => query(path), collectionGroup: (path: string) => query(path, true) } };
});
import { readOwnedTransactions, ExportDataUnavailableError } from '@/lib/reports/export-records';
import { generateUserDataExport, generateDataPackage } from '@/lib/reports/data-export';
import { ExportReviewRequiredError } from '@/lib/reports/transaction-export';
function seed(path: string, data: Record<string, unknown>) { state.rows.set(path, data); }
beforeEach(() => {
  state.rows.clear(); state.fail = ''; state.reads.length = 0;
  seed('user_profiles/owner', { email: 'owner@example.com', taxpayerSSN: 'SECRET_SSN', authorizationPin: 'SECRET_PIN',
    bank_account_number: 'SECRET_BANK', stripeCustomerId: 'SECRET_STRIPE', ein_encrypted: 'SECRET_EIN', ein_last4: '6789' });
  seed('user_profiles/owner/accounts/account', { name: 'Checking', access_token: 'SECRET_TOKEN', item_id: 'SECRET_ITEM', mask: '1234' });
  seed('user_profiles/owner/accounts/account/transactions/manual', { date: '2026-01-01', amount: -1200, account_id: 'account', merchant_name: 'Client', is_deductible: false, deduction_score: 0, iso_currency_code: 'USD' });
  seed('user_profiles/owner/accounts/account/transactions/current', { userId: 'owner', trans_id: 'PRIVATE_PROVIDER_ID', date: '2026-12-31T23:30:00-08:00', amount: 100, is_deductible: true, pending: false, receipt_url: '/api/receipts/receipt', business_purpose: 'Design work', ai_analysis: '{bad JSON' });
  seed('transactions/legacy', { user_id: 'owner', date: '2025-12-31', amount: 20, is_deductible: null, ai_analysis: JSON.stringify({ accessToken: 'SECRET_AI', reason: 'Tentative' }) });
  seed('transactions/foreign', { userId: 'someone-else', date: '2026-01-01', amount: 999999 });
  seed('receipts/receipt', { userId: 'owner', transactionId: 'PRIVATE_PROVIDER_ID', filename: 'receipt.png', size: 12, storagePath: 'private/provider-path', imageBase64: 'SECRET_BYTES', receiptUrl: 'https://external.test/?token=SECRET_URL' });
  for (const name of ['gross_receipts', 'income_1099', 'w2_income', 'tax_deductions', 'tax_organizers']) {
    seed(`${name}/current`, { userId: 'owner', taxYear: 2026, value: 5, spouseSSN: 'SECRET_CIPHERTEXT', nested: { taxpayer_pin: 'SECRET_NESTED_PIN', paidAmount: 0 } });
    seed(`${name}/prior`, { user_id: 'owner', taxYear: 2025, value: 3 });
  }
  seed('user_profiles/owner/assets/old', { placedInServiceDate: '2024-01-01', costBasis: 1000 });
  seed('user_profiles/owner/settings/homeOffice', { method: 'actual' });
  seed('user_profiles/owner/mileage_trips/trip', { date: '2026-01-01', miles: 30 });
  seed('user_profiles/owner/mileage_trips/oldtrip', { date: '2025-01-01', miles: 10 });
  seed('user_profiles/owner/quarterly_payments/Q1_2026', { paidAmount: 0, paidDate: '2026-04-15' });
  seed('user_profiles/owner/quarterly_payments/Q1_2025', { paidAmount: 10 });
});
describe('owner export source completeness and privacy', () => {
  it('includes current, legacy and owner-nested records without duplicate query results or foreign rows', async () => {
    const rows = await readOwnedTransactions('owner');
    expect(rows).toHaveLength(3); expect(rows.map(row => row.amount).sort((a, b) => Number(a) - Number(b))).toEqual([-1200, 20, 100]);
    expect(rows.every(row => String(row.exportReference).startsWith('transaction-'))).toBe(true);
    expect(rows.find(row => row.id === 'current')).toMatchObject({ business_purpose: 'Design work', pending: false });
  });
  it('walks an account only when its count() exceeds the owner-field rows the collection-group queries returned', async () => {
    // Seeded account has an owner-field-less "manual" row: the count differs, so this account is walked.
    state.reads.length = 0; state.counts.length = 0;
    await readOwnedTransactions('owner');
    expect(state.counts).toEqual(['user_profiles/owner/accounts/account/transactions']);
    expect(state.reads.filter(path => path === 'user_profiles/owner/accounts/account/transactions')).toHaveLength(1);
    // Once every nested row carries the owner field, the walk is skipped: A + N reads instead of A + 3N.
    const manual = state.rows.get('user_profiles/owner/accounts/account/transactions/manual')!;
    state.rows.set('user_profiles/owner/accounts/account/transactions/manual', { ...manual, userId: 'owner' });
    state.reads.length = 0; state.counts.length = 0;
    const rows = await readOwnedTransactions('owner');
    expect(rows).toHaveLength(3);
    expect(state.counts).toEqual(['user_profiles/owner/accounts/account/transactions']);
    expect(state.reads.filter(path => path === 'user_profiles/owner/accounts/account/transactions')).toHaveLength(0);
    state.rows.set('user_profiles/owner/accounts/account/transactions/manual', manual);
  });
  it('does not let a row returned by both owner queries stand in for an owner-field-less row', async () => {
    // One row carries both owner spellings (a legacy user_id row later updated with userId) and one carries
    // neither: count() is 2 and both queries return the first row. Counting it twice would skip the walk.
    state.rows.delete('user_profiles/owner/accounts/account/transactions/current');
    seed('user_profiles/owner/accounts/account/transactions/both', { userId: 'owner', user_id: 'owner', date: '2026-02-01', amount: 50, is_deductible: true });
    state.reads.length = 0; state.counts.length = 0;
    const rows = await readOwnedTransactions('owner');
    expect(rows.map(row => row.id).sort()).toEqual(['both', 'legacy', 'manual']);
    expect(state.reads.filter(path => path === 'user_profiles/owner/accounts/account/transactions')).toHaveLength(1);
  });
  it.each(['transactions', 'user_profiles/owner/accounts/account/transactions'])('fails closed when %s cannot be read', async path => {
    state.fail = path; await expect(readOwnedTransactions('owner')).rejects.toBeInstanceOf(ExportDataUnavailableError);
  });
  it.each([
    ['transactions/conflicting', { userId: 'owner', user_id: 'other' }],
    ['user_profiles/other/accounts/a/transactions/forged', { userId: 'owner' }],
    ['user_profiles/owner/accounts/account/transactions/foreign-nested', { userId: 'other' }],
  ] as const)('rejects conflicting ownership at %s', async (path, data) => {
    seed(path, { ...data, date: '2026-01-01', amount: 1 });
    await expect(readOwnedTransactions('owner')).rejects.toBeInstanceOf(ExportDataUnavailableError);
  });
  it('exports all saved tax datasets with counts and preserves false/zero, never credential or receipt bytes', async () => {
    const data = await generateUserDataExport('owner'); const pack = generateDataPackage(data);
    expect(data.transactions).toHaveLength(3); expect(data.taxRecords.w2_income).toHaveLength(2);
    expect(data.aiAnalysis).toEqual(expect.arrayContaining([expect.objectContaining({ parseStatus: 'invalid_saved_json', analysis: null })]));
    expect(data.transactions.find(tx => tx.amount === -1200)).toMatchObject({ is_deductible: false, deduction_score: 0 });
    expect(pack.summary.counts).toMatchObject({ transactions: 3, receipts: 1, accounts: 1, w2_income: 2, quarterly_payments: 2, mileage_trips: 2, assets: 1 });
    expect(pack.summary.receiptBinariesIncluded).toBe(false);
    expect(data.receipts[0]).toMatchObject({ filename: 'receipt.png', receiptUrl: '/api/receipts/receipt', linkRequiresSignIn: true });
    expect(JSON.stringify(pack)).not.toMatch(/SECRET_|PRIVATE_PROVIDER_ID|private\/provider-path|foreign/);
    expect(pack.readme).toContain('not an official tax return'); expect(pack.readme).toContain('receipt image/PDF binaries are NOT attached');
  });
  it('applies a selected year consistently and keeps prior-year assets as disclosed current snapshots', async () => {
    const data = await generateUserDataExport('owner', 2026);
    expect(data.transactions).toHaveLength(2); expect(data.receipts).toHaveLength(1);
    for (const name of ['gross_receipts', 'income_1099', 'w2_income', 'tax_deductions', 'tax_organizers', 'mileage_trips', 'quarterly_payments', 'assets']) expect(data.taxRecords[name], name).toHaveLength(1);
    expect(data.taxRecords.assets[0].placedInServiceDate).toBe('2024-01-01');
    expect(generateDataPackage(data).summary.dateRange).toEqual({ earliest: '2026-01-01', latest: '2026-12-31' });
  });
  it('fails the entire archive if an included tax dataset is unreadable', async () => {
    state.fail = 'income_1099'; await expect(generateUserDataExport('owner')).rejects.toBeInstanceOf(ExportDataUnavailableError);
  });
  it('requires review for undated transactions instead of silently omitting them from a selected year', async () => {
    seed('transactions/undated', { userId: 'owner', amount: 10 });
    await expect(generateUserDataExport('owner', 2026)).rejects.toBeInstanceOf(ExportReviewRequiredError);
    expect((await generateUserDataExport('owner')).transactions).toHaveLength(4);
  });
});

 it('reports private unresolved bank history metadata without adding staged amounts to exported transactions', async () => {
  seed('user_profiles/owner/bank_reconnects/review', { uid: 'owner', phase: 'active', mappingComplete: true, historyReady: true });
  seed('user_profiles/owner/bank_reconnects/review/import_records/private', { uid: 'owner', status: 'deferred', payload: { date: '2026-08-01', amount: 987654 } });
  const result = await generateUserDataExport('owner', 2026);
  expect(result.bankHistoryReview).toMatchObject({ ready: false, deferredRecords: 1 });
  expect(result.transactions.some(record => record.amount === 987654)).toBe(false);
  expect(JSON.stringify(result.bankHistoryReview)).not.toContain('987654');
 });
