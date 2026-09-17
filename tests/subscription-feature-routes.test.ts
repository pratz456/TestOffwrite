import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFDocument } from 'pdf-lib';
const mock = vi.hoisted(() => ({ authenticated: true, profile: {} as Record<string, unknown>, lookupFails: false,
  lookup: vi.fn(), collection: vi.fn(), transactions: vi.fn(), taxpayer: vi.fn() }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => mock.authenticated
  ? { user: { uid: 'u1' }, error: null } : { user: null, error: 'Unauthorized' } }));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: async () => { if (!mock.authenticated) throw Error('Unauthorized'); return { uid: 'u1' }; } }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {
  doc: (path: string) => ({ get: async () => { mock.lookup(path); if (mock.lookupFails) throw Error('databaseprivatefailure'); return { exists: true, data: () => mock.profile }; } }),
  collection: mock.collection,
} }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: mock.transactions }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reports/export-records')>(),
  readOwnedTransactions: async () => { const result = await mock.transactions(); if (result.error) throw new Error('Data unavailable'); return result.data; } }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: mock.taxpayer }));
import { POST as exportForms } from '@/app/api/reports/export/route';
import { POST as reportPDF } from '@/app/api/reports/generate-pdf/route';
import { GET as profitLossPDF, POST as profitLoss } from '@/app/api/reports/profit-loss/route';
import { GET as auditSupportPDF } from '@/app/api/reports/audit-support/route';
import { GET as transactionsCSV } from '@/app/api/transactions/export-csv/route';
import { POST as scheduleC } from '@/app/api/tax/schedule-c/export/route';
import { POST as form1040 } from '@/app/api/tax/form-1040/route';
import { POST as quarterlyVouchers } from '@/app/api/tax/generate-1040es/route';
const now = new Date('2026-09-15T12:00:00Z');
const past = new Date('2026-09-01T12:00:00Z');
const future = new Date('2026-10-01T12:00:00Z');
const premium = { subscriptionStatus: 'active', subscriptionPlan: 'premium', stripeSubscriptionStatus: 'active', stripeSubscriptionId: 'sub_fixture', subscriptionEnd: future };
const routes = [
  { name: 'reports/export', handler: exportForms, method: 'POST', allowedStatus: 400 },
  { name: 'reports/generate-pdf', handler: reportPDF, method: 'POST', allowedStatus: 400 },
  { name: 'reports/profit-loss', handler: profitLoss, method: 'POST', allowedStatus: 200, feature: 'reports' },
  { name: 'reports/profit-loss?format=pdf&year=2026', handler: profitLossPDF, method: 'GET', allowedStatus: 200 },
  { name: 'reports/audit-support?format=pdf&year=2026', handler: auditSupportPDF, method: 'GET', allowedStatus: 200, feature: 'reports' },
  { name: 'transactions/export-csv?year=2026', handler: transactionsCSV, method: 'GET', allowedStatus: 200 },
  { name: 'tax/schedule-c/export', handler: scheduleC, method: 'POST', allowedStatus: 400 },
  { name: 'tax/form-1040', handler: form1040, method: 'POST', allowedStatus: 400 },
  { name: 'tax/generate-1040es', handler: quarterlyVouchers, method: 'POST', allowedStatus: 400 },
] as const;
function request(route: typeof routes[number], body: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/${route.name}`, { method: route.method,
    ...(route.method === 'POST' ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(PDFDocument, 'create');
  mock.authenticated = true; mock.lookupFails = false;
  mock.profile = { subscriptionStatus: 'expired', trialStart: past, trialEnd: past };
  mock.transactions.mockResolvedValue({ data: [], error: null }); mock.taxpayer.mockResolvedValue({ data: { income: '0', filing_status: 'single' }, error: null });
  mock.collection.mockImplementation(() => { const query = { where: () => query, limit: () => query, get: async () => ({ empty: true, docs: [] }) }; return query; });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe.each(routes)('$method /api/$name feature boundary', (route) => {
  it('rejects unauthenticated requests before loading the profile or tax data', async () => {
    mock.authenticated = false;
    expect((await route.handler(request(route))).status).toBe(401);
    expect(mock.lookup).not.toHaveBeenCalled(); expect(mock.collection).not.toHaveBeenCalled();
    expect(mock.transactions).not.toHaveBeenCalled(); expect(PDFDocument.create).not.toHaveBeenCalled();
  });
  it.each(['free', 'basic', 'expired-trial', 'past-due', 'canceled'])('rejects %s before consuming export data or generating files', async (state) => {
    mock.profile = state === 'free' ? {} : state === 'basic' ? { ...premium, subscriptionPlan: 'basic' } : state === 'expired-trial'
      ? { subscriptionStatus: 'trial', trialStart: past, trialEnd: now }
      : { ...premium, stripeSubscriptionStatus: state === 'past-due' ? 'past_due' : 'canceled' };
    const response = await route.handler(request(route, { subscriptionStatus: 'active', userId: 'another-user', hasHistoricalAccess: true }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'SUBSCRIPTION_REQUIRED', feature: 'feature' in route ? route.feature : 'exports' });
    expect(mock.lookup).toHaveBeenCalledWith('user_profiles/u1');
    expect(mock.collection).not.toHaveBeenCalled(); expect(mock.transactions).not.toHaveBeenCalled();
    expect(mock.taxpayer).not.toHaveBeenCalled(); expect(PDFDocument.create).not.toHaveBeenCalled();
  });
  it('returns a retryable error when plan verification is unavailable', async () => {
    mock.lookupFails = true;
    const response = await route.handler(request(route));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('databaseprivatefailure');
    expect(mock.collection).not.toHaveBeenCalled(); expect(mock.transactions).not.toHaveBeenCalled();
  });
  it.each(['premium', 'trial'])('allows %s through to the feature or its request validation', async (plan) => {
    mock.profile = plan === 'premium' ? premium : { subscriptionStatus: 'trial', trialStart: past, trialEnd: future };
    const response = await route.handler(request(route));
    expect(response.status).toBe(route.allowedStatus);
    expect(mock.lookup).toHaveBeenCalledWith('user_profiles/u1');
    if (response.status === 400) expect(await response.text()).not.toContain('SUBSCRIPTION_REQUIRED');
    if (route.handler === transactionsCSV) expect(response.headers.get('content-type')).toContain('text/csv');
    if (route.handler === profitLossPDF || route.handler === auditSupportPDF) expect(response.headers.get('content-type')).toContain('application/pdf');
  });
});
