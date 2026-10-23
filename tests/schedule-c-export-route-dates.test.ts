import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ transactions: [] as Record<string, unknown>[] }));

vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'export-owner' }, error: null }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/security/rate-limit', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/security/rate-limit')>();
  return { ...actual, enforceRateLimit: async () => ({ allowed: true }) };
});
vi.mock('@/lib/firebase/profiles-server', () => ({
  getUserProfileServer: async () => ({ data: { name: 'Synthetic Taxpayer', profession: 'Consultant' }, error: null }),
}));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: () => ({
  where() { return this; },
  limit() { return this; },
  get: async () => ({ empty: true, docs: [] }),
}) } }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/reports/export-records')>(),
  readOwnedTransactions: async () => state.transactions,
}));
vi.mock('@/lib/firebase/income-reconciliations-server', () => ({ readIncomeReconciliationDecisions: async () => [] }));

import { POST } from '@/app/api/tax/schedule-c/export/route';
import * as scheduleCCsv from '@/lib/reports/schedule-c-csv';
import * as scheduleCPdf from '@/lib/reports/schedule-c-pdf';

const request = (format: 'csv' | 'pdf') => new NextRequest('http://localhost/api/tax/schedule-c/export', {
  method: 'POST',
  body: JSON.stringify({ year: 2026, format }),
});

function meal(date: string) {
  return {
    id: 'meal-20-01',
    amount: 20.01,
    date,
    category: 'FOOD_AND_DRINK_RESTAURANT',
    merchant_name: 'Meal',
    is_deductible: true,
    pending: false,
    iso_currency_code: 'USD',
  };
}

async function exportMeal(date: string, format: 'csv' | 'pdf') {
  state.transactions = [meal(date)];
  const csv = vi.spyOn(scheduleCCsv, 'generateScheduleCCSV');
  const pdf = vi.spyOn(scheduleCPdf, 'generateScheduleCPlanningPDF');
  const response = await POST(request(format));
  return { response, csv, pdf };
}

describe('Schedule C export route date review', () => {
  beforeEach(() => { state.transactions = []; vi.restoreAllMocks(); });

  it.each(['csv', 'pdf'] as const)('(a) requires review for date 01/15/2026 and does not generate %s', async format => {
    const { response, csv, pdf } = await exportMeal('01/15/2026', format);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'EXPORT_REVIEW_REQUIRED' });
    expect(csv).not.toHaveBeenCalled();
    expect(pdf).not.toHaveBeenCalled();
  });

  it.each(['csv', 'pdf'] as const)('(b) requires review for date 2026-02-30 and does not generate %s', async format => {
    const { response, csv, pdf } = await exportMeal('2026-02-30', format);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'EXPORT_REVIEW_REQUIRED' });
    expect(csv).not.toHaveBeenCalled();
    expect(pdf).not.toHaveBeenCalled();
  });

  it.each(['csv', 'pdf'] as const)('(c) exports date 2026-01-15 as %s', async format => {
    const { response, csv, pdf } = await exportMeal('2026-01-15', format);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(format === 'csv' ? 'text/csv' : 'application/pdf');
    expect(csv).toHaveBeenCalledTimes(format === 'csv' ? 1 : 0);
    expect(pdf).toHaveBeenCalledTimes(format === 'pdf' ? 1 : 0);
  });
});
