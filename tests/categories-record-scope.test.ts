import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getTransactionsServer: vi.fn(),
}));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: mocks.getTransactionsServer }));

import { GET } from '@/app/api/categories/route';

describe('category totals use active posted bank records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({ user: { uid: 'category-owner' }, error: null });
  });

  it('omits withdrawn, superseded and pending rows without labeling a category deductible', async () => {
    const expense = { category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', amount: 25, review_status: 'confirmed', is_deductible: true };
    mocks.getTransactionsServer.mockResolvedValue({
      data: [
        expense,
        { ...expense, amount: 10, review_status: 'needs_review' },
        { ...expense, amount: 100, bank_removed: true, pending: false },
        { ...expense, amount: 200, superseded_by: 'previous-record' },
        { ...expense, amount: 300, pending: true },
      ],
      error: null,
    });

    const response = await GET(new NextRequest('http://localhost/api/categories'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.getTransactionsServer).toHaveBeenCalledWith('category-owner', expect.any(Object));
    expect(body.categories.find((category: { id: string }) => category.id === 'supplies_small_tools')).toMatchObject({
      transaction_count: 2,
      deductible_count: 1,
      total_amount: 35,
      is_deductible: null,
    });
  });
});
