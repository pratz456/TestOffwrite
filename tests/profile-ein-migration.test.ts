import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const model = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>,
  afterRead: null as null | (() => Promise<void>),
  get: vi.fn(), update: vi.fn(), transaction: vi.fn(), transactionUpdate: vi.fn(), transactionSet: vi.fn(),
}));
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: { doc: () => ({ get: model.get, update: model.update }), runTransaction: model.transaction },
  FieldValue: { delete: () => '__delete__', serverTimestamp: () => '__server_time__' },
}));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'owner', emailVerified: true } }) }));
vi.mock('@/lib/plaid/connections', () => ({ migrateLegacyPlaidConnection: async () => undefined }));
import { GET, POST } from '../app/api/database/profiles/route';
import { decryptSensitive, encryptSensitive } from '../lib/security/utils';

const request = (body?: unknown) => new NextRequest('https://writeoff.test/api/database/profiles', body === undefined
  ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const snapshot = () => { const data = { ...model.stored }; return { exists: true, data: () => data }; };
const apply = (fields: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(fields)) {
    if (value === '__delete__') delete model.stored[key];
    else model.stored[key] = value;
  }
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('WRITEOFF_LOCAL_ACCOUNT_PREVIEW', 'false');
  vi.stubEnv('WRITEOFF_ENV', 'production');
  vi.stubEnv('SSN_ENCRYPTION_KEY', '11'.repeat(32));
  model.stored = { name: 'Owner' }; model.afterRead = null;
  model.get.mockImplementation(async () => {
    const result = snapshot();
    const afterRead = model.afterRead; model.afterRead = null;
    if (afterRead) await afterRead();
    return result;
  });
  model.update.mockImplementation(async fields => apply(fields));
  model.transactionUpdate.mockImplementation((_ref, fields) => apply(fields));
  model.transactionSet.mockImplementation((_ref, fields) => apply(fields));
  model.transaction.mockImplementation(async callback => callback({
    get: async () => snapshot(), update: model.transactionUpdate, set: model.transactionSet,
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe('legacy profile EIN migration', () => {
  it.each(['', '   ', null, false, 123, { invalid: true }])('clears legacy %j so owner profile reads are no longer denied by the EIN field guard', async legacy => {
    model.stored.ein = legacy;
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, profile: { id: 'owner', name: 'Owner' } });
    expect(model.stored).toEqual({ name: 'Owner' });
    expect(model.transactionUpdate).toHaveBeenCalledExactlyOnceWith(expect.anything(), { ein: '__delete__' });
    expect(model.update).not.toHaveBeenCalled();
  });

  it('normalizes a valid legacy identifier and encrypts it before exposing only its mask', async () => {
    model.stored.ein = '12-3456789';
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(model.stored).not.toHaveProperty('ein');
    expect(decryptSensitive(model.stored.ein_encrypted as string)).toBe('123456789');
    expect(await response.json()).toEqual({ success: true, profile: { id: 'owner', name: 'Owner', ein: '**-***6789' } });
    expect(model.update).not.toHaveBeenCalled();
  });

  it('preserves meaningful nonstandard legacy text encrypted instead of discarding it', async () => {
    model.stored.ein = '  pending assignment  ';
    expect((await GET(request())).status).toBe(200);
    expect(model.stored).not.toHaveProperty('ein');
    expect(decryptSensitive(model.stored.ein_encrypted as string)).toBe('pending assignment');
  });

  it.each(['12-3456789', '', null])('clears stale legacy %j while preserving an already encrypted identifier', async legacy => {
    const encrypted = encryptSensitive('987654321');
    model.stored = { name: 'Owner', ein: legacy, ein_encrypted: encrypted, ein_last4: '4321' };
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(model.stored).toEqual({ name: 'Owner', ein_encrypted: encrypted, ein_last4: '4321' });
    expect(model.transactionUpdate).toHaveBeenCalledExactlyOnceWith(expect.anything(), { ein: '__delete__' });
    expect((await response.json()).profile.ein).toBe('**-***4321');
  });

  it('does not overwrite an EIN saved after the initial migration read', async () => {
    model.stored.ein = '12-3456789';
    model.afterRead = async () => {
      expect((await POST(request({ ein: '98-7654321' }))).status).toBe(200);
    };
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(decryptSensitive(model.stored.ein_encrypted as string)).toBe('987654321');
    expect((await response.json()).profile.ein).toBe('**-***4321');
    expect(model.transactionSet).toHaveBeenCalledOnce();
    expect(model.transactionUpdate).not.toHaveBeenCalled();
    expect(model.update).not.toHaveBeenCalled();
  });

  it('does not restore an EIN cleared after the initial migration read', async () => {
    model.stored.ein = '12-3456789';
    model.afterRead = async () => { expect((await POST(request({ ein: '' }))).status).toBe(200); };
    expect((await GET(request())).status).toBe(200);
    expect(model.stored).not.toHaveProperty('ein');
    expect(model.stored).not.toHaveProperty('ein_encrypted');
    expect(model.transactionUpdate).not.toHaveBeenCalled();
    expect(model.update).not.toHaveBeenCalled();
  });

  it('keeps the original value intact when encryption is unavailable', async () => {
    vi.stubEnv('SSN_ENCRYPTION_KEY', 'invalid');
    model.stored.ein = '12-3456789';
    expect((await GET(request())).status).toBe(503);
    expect(model.stored).toEqual({ name: 'Owner', ein: '12-3456789' });
    expect(model.transactionUpdate).not.toHaveBeenCalled();
    expect(model.update).not.toHaveBeenCalled();
  });
});
