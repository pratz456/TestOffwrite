import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const docs = new Map<string, Record<string, any>>();
  const snap = (path: string) => ({
    id: path.split('/').at(-1)!,
    ref: ref(path),
    exists: docs.has(path),
    data: () => docs.has(path) ? structuredClone(docs.get(path)) : undefined,
  });
  function ref(path: string): any {
    return {
      path,
      id: path.split('/').at(-1),
      get: async () => snap(path),
      collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    };
  }
  return {
    docs,
    adminDb: {
      doc: ref,
      runTransaction: async (fn: (tx: any) => Promise<any>) => {
        const writes: Array<() => void> = [];
        const result = await fn({
          get: async (target: any) => snap(target.path),
          update: (target: any, data: any) => writes.push(() => docs.set(target.path, { ...docs.get(target.path), ...structuredClone(data) })),
        });
        writes.forEach(write => write());
        return result;
      },
    },
  };
});

vi.mock('@/lib/firebase/admin', () => ({ adminDb: fake.adminDb }));

import { reviewTransaction, TransactionReviewError } from '@/lib/transactions/review';

const uid = 'owner';
const accountId = 'checking';
const transactionPath = `user_profiles/${uid}/accounts/${accountId}/transactions/fuel`;

function seed(date: unknown) {
  fake.docs.set(`user_profiles/${uid}`, { vehicle_deduction_method: 'standard_mileage' });
  fake.docs.set(`user_profiles/${uid}/accounts/${accountId}`, { userId: uid });
  const row: Record<string, unknown> = {
    userId: uid, account_id: accountId, amount: 64, iso_currency_code: 'USD', pending: false,
    merchant_name: 'Shell', created_at: '2026-06-15T18:00:00.000Z', updated_at: '2026-06-15T18:00:00.000Z',
  };
  if (date !== undefined) row.date = date;
  fake.docs.set(transactionPath, row);
}

async function confirmVehicle() {
  return reviewTransaction(uid, 'fuel', {
    action: 'correct', accountId, category: 'vehicle_expense', transactionKind: 'expense', isDeductible: true,
    reason: 'Fuel for a client visit',
  });
}

beforeEach(() => fake.docs.clear());

describe('undated vehicle confirmation', () => {
  it.each([
    ['an undated vehicle expense', undefined],
    ['a vehicle expense dated 01/05/2025', '01/05/2025'],
  ])('saves %s with no deduction and Needs more information', async (_label, date) => {
    seed(date);
    let thrown: unknown;
    let reviewed: Awaited<ReturnType<typeof confirmVehicle>> | undefined;
    try {
      reviewed = await confirmVehicle();
    } catch (error) {
      thrown = error;
    }
    const rejection = thrown instanceof TransactionReviewError ? { code: thrown.code, status: thrown.status } : { code: null, status: null };
    expect(rejection, 'confirm must not answer with HTTP 422 DEDUCTION_REVIEW_REQUIRED').not.toEqual({ code: 'DEDUCTION_REVIEW_REQUIRED', status: 422 });
    expect(thrown).not.toBeInstanceOf(TransactionReviewError);
    expect(reviewed).toMatchObject({ is_deductible: null, deductionStatus: 'Needs more information', category: 'VEHICLE_REVIEW_REQUIRED' });
    expect(fake.docs.get(transactionPath)).toMatchObject({
      is_deductible: null, deductionStatus: 'Needs more information', category: 'VEHICLE_REVIEW_REQUIRED', review_status: 'confirmed',
    });
  });
});
