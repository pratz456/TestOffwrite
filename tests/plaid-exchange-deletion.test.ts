import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), exchange: vi.fn(), accounts: vi.fn(), remove: vi.fn(), save: vi.fn(), sync: vi.fn(),
  begin: vi.fn(), retain: vi.fn(), finish: vi.fn(), unresolved: vi.fn(), owner: vi.fn(), quarantine: vi.fn() }));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: m.auth }));
vi.mock('@/lib/plaid/client', () => ({ plaidClient: { itemPublicTokenExchange: m.exchange, accountsGet: m.accounts, itemRemove: m.remove } }));
vi.mock('@/lib/plaid/connections', () => ({ assertPlaidTokenEncryptionConfigured() {}, savePlaidConnection: m.save }));
vi.mock('@/lib/plaid/sync-helper', () => ({ syncUserTransactionsIncremental: m.sync }));
vi.mock('@/lib/plaid/link-operations', () => ({ ACCOUNT_DELETION_IN_PROGRESS: 'ACCOUNT_DELETION_IN_PROGRESS', beginPlaidLinkOperation: m.begin,
  retainPlaidLinkRecovery: m.retain, finishPlaidLinkOperation: m.finish, markPlaidLinkOperationUnresolved: m.unresolved,
  existingPlaidLinkOwner: m.owner, quarantinePlaidLinkRecovery: m.quarantine }));
import { POST } from '@/app/api/plaid/exchange-public-token/route';
const req = () => new Request('https://writeoff.test/api/plaid/exchange-public-token', { method: 'POST', body: JSON.stringify({ public_token: 'public-sandbox-test' }) });
beforeEach(() => {
  vi.resetAllMocks(); m.auth.mockResolvedValue({ uid: 'owner' }); m.begin.mockResolvedValue('operation');
  m.exchange.mockResolvedValue({ data: { access_token: 'access-sandbox-test', item_id: 'created-item' } });
  m.accounts.mockResolvedValue({ data: { item: { item_id: 'created-item', institution_id: 'institution' }, accounts: [{ account_id: 'account' }] } });
  m.save.mockResolvedValue(undefined); m.sync.mockResolvedValue({ success: true, transactionsSaved: 0 });
  m.owner.mockResolvedValue('none');
});
describe('bank exchange excludes account deletion and preserves compensation', () => {
  it('denies deletion-marked users before any provider exchange', async () => {
    m.begin.mockRejectedValue(new Error('ACCOUNT_DELETION_IN_PROGRESS'));
    expect((await POST(req())).status).toBe(409); expect(m.exchange).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled();
  });
  it('records recovery immediately after exchange, persists the bank, then releases the operation', async () => {
    expect((await POST(req())).status).toBe(200);
    expect(m.begin.mock.invocationCallOrder[0]).toBeLessThan(m.exchange.mock.invocationCallOrder[0]);
    expect(m.retain.mock.invocationCallOrder[0]).toBeLessThan(m.accounts.mock.invocationCallOrder[0]);
    expect(m.save.mock.invocationCallOrder[0]).toBeLessThan(m.finish.mock.invocationCallOrder[0]);
    expect(m.remove).not.toHaveBeenCalled();
  });
  it('revokes a newly exchanged Item if deletion begins before the atomic bank save', async () => {
    m.save.mockRejectedValue(new Error('ACCOUNT_DELETION_IN_PROGRESS'));
    expect((await POST(req())).status).toBe(409);
    expect(m.remove).toHaveBeenCalledExactlyOnceWith({ access_token: 'access-sandbox-test' });
    expect(m.finish).toHaveBeenCalledWith('owner', 'operation'); expect(m.sync).not.toHaveBeenCalled();
  });
  it('retains private recovery and an unresolved operation when compensation fails', async () => {
    m.save.mockRejectedValue(new Error('ACCOUNT_DELETION_IN_PROGRESS')); m.remove.mockRejectedValue(new Error('unavailable'));
    expect((await POST(req())).status).toBe(409);
    expect(m.retain).toHaveBeenCalledWith('owner', 'operation', 'created-item', 'access-sandbox-test');
    expect(m.unresolved).toHaveBeenCalledWith('owner', 'operation', true); expect(m.finish).not.toHaveBeenCalled();
  });
  it.each(['conflict', 'none'])('never revokes a BANK_ALREADY_CONNECTED conflict (%s), retaining it for ownership review', async owner => {
    m.save.mockRejectedValue(new Error('BANK_ALREADY_CONNECTED')); m.owner.mockResolvedValue(owner);
    expect((await POST(req())).status).toBe(409); expect(m.remove).not.toHaveBeenCalled();
    expect(m.quarantine).toHaveBeenCalledWith('owner', 'operation'); expect(m.finish).not.toHaveBeenCalled();
  });
  it('does not revoke an Item already durably saved for this owner', async () => {
    m.save.mockRejectedValue(new Error('BANK_ALREADY_CONNECTED')); m.owner.mockResolvedValue('owner');
    expect((await POST(req())).status).toBe(409); expect(m.remove).not.toHaveBeenCalled(); expect(m.finish).toHaveBeenCalledOnce();
  });
  it('retains an ambiguous exchange timeout with no automatic expiry', async () => {
    m.exchange.mockRejectedValue(new Error('timeout'));
    expect((await POST(req())).status).toBe(502); expect(m.unresolved).toHaveBeenCalledWith('owner', 'operation', false);
    expect(m.finish).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled();
  });
  it('compensates an empty account response instead of leaking the exchanged Item', async () => {
    m.accounts.mockResolvedValue({ data: { item: { item_id: 'created-item' }, accounts: [] } });
    expect((await POST(req())).status).toBe(502); expect(m.remove).toHaveBeenCalledOnce(); expect(m.finish).toHaveBeenCalledOnce();
  });
});
