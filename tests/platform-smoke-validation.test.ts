import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  uid: 'smoke-owner' as string | null,
  write: vi.fn(), add: vi.fn(), mileageCreate: vi.fn(), mileageRead: vi.fn(),
  homeOffice: vi.fn(), analyze: vi.fn(),
}));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: state.uid ? { uid: state.uid } : null, error: state.uid ? null : 'Unauthorized' }) }));
vi.mock('@/lib/firebase/admin', () => {
  const document: Record<string, unknown> = {};
  Object.assign(document, { collection: () => document, doc: () => document, get: async () => ({ exists: true }), set: state.write, add: state.add });
  return { adminDb: { collection: () => document } };
});
vi.mock('@/lib/firebase/mileage-server', () => ({ getMileageTrips: state.mileageRead, createMileageTrip: state.mileageCreate }));
vi.mock('@/lib/firebase/settings-server', () => ({ getHomeOfficeSettings: state.homeOffice, saveHomeOfficeSettings: vi.fn(), getTaxSummarySettings: state.homeOffice, saveTaxSummarySettings: vi.fn() }));
vi.mock('@/lib/ai/analyzeTransaction', () => ({ analyzeTransactionWithRetry: state.analyze, convertToEnhancedContext: vi.fn() }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: vi.fn() }));
import { POST as manual } from '../app/api/transactions/manual/route';
import { POST as w2, GET as readW2 } from '../app/api/income/w2/route';
import { POST as mileage, GET as readMileage } from '../app/api/mileage/route';
import { GET as homeOffice } from '../app/api/settings/home-office/route';
import { GET as taxSummary } from '../app/api/settings/tax-summary/route';

function request(body: unknown, route = '/api/smoke') {
  return new NextRequest(`http://localhost${route}`, { method: 'POST', body: JSON.stringify(body) });
}
const manualBase = { merchant_name: 'Synthetic payer', amount: 125.25, date: '2026-09-15', type: 'income' };
const mileageBase = { userId: 'smoke-owner', startLocation: 'Office', endLocation: 'Client', date: '2026-09-15', miles: 12.5 };
beforeEach(() => { vi.clearAllMocks(); state.uid = 'smoke-owner'; state.add.mockResolvedValue({ id: 'w2-fixture' }); state.mileageCreate.mockResolvedValue({ data: { id: 'trip-fixture' }, error: null }); });

describe('platform input smoke regressions', () => {
  it.each(['Infinity', '-Infinity', 'NaN', '', null, true, [], -1, 0])('manual amounts reject %s before writing or starting AI', async amount => {
    expect((await manual(request({ ...manualBase, amount }))).status).toBe(400);
    expect(state.write).not.toHaveBeenCalled(); expect(state.analyze).not.toHaveBeenCalled();
  });
  it.each(['2026-02-30', '2026-13-01', 'September 15', '2026-09-15T00:00:00Z'])('manual invalid date %s is rejected', async date => {
    expect((await manual(request({ ...manualBase, date }))).status).toBe(400); expect(state.write).not.toHaveBeenCalled();
  });
  it('manual income writes the normalized amount with the verified owner and does not start AI', async () => {
    expect((await manual(request({ ...manualBase, amount: '125.25', userId: 'attacker-owner' }))).status).toBe(201);
    expect(state.write).toHaveBeenCalledWith(expect.objectContaining({ amount: -125.25, userId: 'smoke-owner', type: 'income' }));
    expect(state.analyze).not.toHaveBeenCalled();
  });
  it('manual expenses persist review choices and provenance without starting post-response model work', async () => {
    expect((await manual(request({ ...manualBase, type: 'expense', is_deductible: true, iso_currency_code: 'USD' }))).status).toBe(201);
    expect(state.write).toHaveBeenCalledWith(expect.objectContaining({ amount: 125.25, userId: 'smoke-owner', type: 'expense',
      source: 'manual', is_deductible: true, analyzed: false, analysis_status: 'pending' }));
    expect(state.analyze).not.toHaveBeenCalled();
  });
  it('persists explicitly declared USD for new manual records and rejects another currency', async () => {
    expect((await manual(request({ ...manualBase, iso_currency_code: 'USD' }))).status).toBe(201);
    expect(state.write).toHaveBeenCalledWith(expect.objectContaining({ iso_currency_code: 'USD' }));
    state.write.mockClear();
    expect((await manual(request({ ...manualBase, iso_currency_code: 'EUR' }))).status).toBe(400);
    expect(state.write).not.toHaveBeenCalled();
  });
  it('does not backfill unknown currency from an older manual client', async () => {
    expect((await manual(request(manualBase))).status).toBe(201);
    expect(state.write.mock.calls[0][0]).not.toHaveProperty('iso_currency_code');
  });
  it.each([{ wages: 'Infinity' }, { federalWithheld: 'NaN' }, { stateWithheld: -1 }, { medicareWages: true }, { wages: null }, { taxYear: '2026abc' }, { employer: 42 }])('W-2 invalid input %s is rejected before a write', async fields => {
    expect((await w2(request({ employer: 'Synthetic employer', wages: 1000, taxYear: 2026, ...fields }))).status).toBe(400);
    expect(state.add).not.toHaveBeenCalled();
  });
  it('a zero wage W-2 with withholding is retained and explicit state zeros are not discarded', async () => {
    expect((await w2(request({ employer: 'Synthetic employer', wages: 0, federalWithheld: 50, stateWages: 0, stateWithheld: 0, taxYear: 2026 }))).status).toBe(201);
    expect(state.add).toHaveBeenCalledWith(expect.objectContaining({ userId: 'smoke-owner', wages: 0, federalWithheld: 50, stateWages: 0, stateWithheld: 0 }));
  });
  it.each([{ miles: -1 }, { miles: 'Infinity' }, { miles: null }, { miles: true }, { date: '2026-02-30' }, { roundTrip: 'false' }, { startLocation: [] }])('mileage invalid input %s is rejected before a write', async fields => {
    expect((await mileage(request({ ...mileageBase, ...fields }))).status).toBe(400); expect(state.mileageCreate).not.toHaveBeenCalled();
  });
  it('mileage cannot be written for another user', async () => {
    expect((await mileage(request({ ...mileageBase, userId: 'somebody-else' }))).status).toBe(403); expect(state.mileageCreate).not.toHaveBeenCalled();
  });
  it('mileage accepts valid decimal strings without turning false into true', async () => {
    expect((await mileage(request({ ...mileageBase, miles: '12.5', roundTrip: false }))).status).toBe(200);
    expect(state.mileageCreate).toHaveBeenCalledWith(expect.objectContaining({ miles: 12.5, roundTrip: false, userId: 'smoke-owner' }));
  });
  it.each([manual, w2, mileage])('malformed JSON returns a usable 400', async handler => {
    expect((await handler(new NextRequest('http://localhost/api/smoke', { method: 'POST', body: '{invalid' }))).status).toBe(400);
  });
  it.each([readW2, readMileage])('malformed query tax year returns 400', async handler => {
    expect((await handler(new NextRequest('http://localhost/api/smoke?year=2026abc'))).status).toBe(400);
  });
  it.each([homeOffice, taxSummary])('first-time settings is an empty state, while actual backend failures remain errors', async handler => {
    state.homeOffice.mockResolvedValueOnce({ data: null, error: { code: 'NOT_FOUND', message: 'Not configured' } });
    const missing = await handler(new NextRequest('http://localhost/api/settings/home-office'));
    expect(missing.status).toBe(200); expect(await missing.json()).toEqual({ success: true, data: null });
    state.homeOffice.mockResolvedValueOnce({ data: null, error: { code: 'unavailable', message: 'Retry' } });
    expect((await handler(new NextRequest('http://localhost/api/settings/home-office'))).status).toBe(500);
  });
  it.each([manual, w2, mileage])('unauthenticated callers cannot write even valid input', async handler => {
    state.uid = null;
    expect((await handler(request({ ...manualBase, ...mileageBase, employer: 'Synthetic', wages: 1000 }))).status).toBe(401);
    expect(state.write).not.toHaveBeenCalled(); expect(state.add).not.toHaveBeenCalled(); expect(state.mileageCreate).not.toHaveBeenCalled();
  });
});
