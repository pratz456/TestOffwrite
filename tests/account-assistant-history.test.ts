import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ saved: null as Record<string, any> | null, deleted: false, writes: [] as any[] }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {
  doc: (path: string) => ({ path }),
  runTransaction: async (fn: any) => fn({ get: async ({ path }: { path: string }) => path.startsWith('account_deletions/')
    ? { data: () => ({ deletionRequested: h.deleted }) } : { exists: !!h.saved, data: () => h.saved },
    set: (ref: any, data: any) => h.writes.push({ path: ref.path, data }),
  }),
} }));
import { saveTaxPosition } from '@/lib/tax-assistant/account-history';
const current = { version: 1 as const, userId: 'owner', taxYear: 2026, checkedAt: '2026-09-23T00:00:00Z', totalTax: 12000, balanceDue: 0, refund: 100, income: 60000, deductions: 4000 };
beforeEach(() => { h.saved = null; h.deleted = false; h.writes = []; });
describe('private tax estimate baselines', () => {
  it('creates a baseline under the authenticated owner/year and returns the previous value', async () => {
    expect(await saveTaxPosition(current)).toBeNull();
    expect(h.writes).toEqual([{ path: 'user_profiles/owner/assistant_tax_snapshots/2026', data: current }]);
    h.saved = { ...current, checkedAt: '2026-09-22T00:00:00Z' };
    expect(await saveTaxPosition(current)).toEqual(h.saved);
  });
  it('does not overwrite a newer concurrent calculation with an older response', async () => {
    h.saved = { ...current, checkedAt: '2026-09-24T00:00:00Z' };
    await saveTaxPosition(current); expect(h.writes).toHaveLength(0);
  });
  it('does not resurrect private records after account deletion begins', async () => {
    h.deleted = true; await expect(saveTaxPosition(current)).rejects.toThrow('deletion'); expect(h.writes).toHaveLength(0);
  });
});
