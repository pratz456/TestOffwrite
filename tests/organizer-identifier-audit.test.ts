import { describe, expect, it } from 'vitest';
import { encryptSensitive } from '../lib/security/utils';
import { auditOrganizerIdentifiers, classifyOrganizer, looksEncrypted, runOrganizerIdentifierAudit } from '../scripts/organizer-identifier-audit.mjs';

function fakeDb(rows: Record<string, unknown>[]) {
  const reads: string[] = [];
  const db = { collection: (name: string) => {
    reads.push(name);
    let offset = 0, size = rows.length;
    const query = {
      orderBy() { return query; },
      limit(count: number) { size = count; return query; },
      startAfter(last: { index: number }) { offset = last.index + 1; return query; },
      async get() {
        const docs = rows.slice(offset, offset + size).map((data, i) => ({ index: offset + i, data: () => data }));
        return { empty: !docs.length, docs };
      },
      set() { throw new Error('audit must never write'); }, add() { throw new Error('audit must never write'); },
    };
    return query;
  } };
  return { db, reads };
}

describe('organizer identifier audit (read-only)', () => {
  it('classifies ciphertext, legacy plaintext and identifier digits in dependent notes without exposing values', () => {
    expect(looksEncrypted(encryptSensitive('900000001'))).toBe(true);
    expect(looksEncrypted('900000001')).toBe(false);
    expect(classifyOrganizer({ taxpayerSSN: encryptSensitive('900000001'), ipPin: '123456', bankRouting: '', dependentSSN: '900000003', taxpayerSeniorSSN: 'yes',
      dependentDetails: 'Emma Shah, 900-00-0003, Daughter', filingStatus: 'single' }))
      .toEqual({ plaintextFields: ['ipPin', 'dependentSSN'], redactableTextFields: ['dependentDetails'] });
    expect(classifyOrganizer({ dependentDetails: 'Support paid $123,456,789 in 2026' })).toEqual({ plaintextFields: [], redactableTextFields: [] });
  });
  it('counts across pages and prints counts only', async () => {
    const rows = [
      { userId: 'a', taxpayerSSN: encryptSensitive('900000001'), ipPin: '123456' },
      { userId: 'b', taxpayerSSN: '900000002', bankAccount: encryptSensitive('000123456789'), dependentDetails: 'Kid, 900-00-0003' },
      { userId: 'c', filingStatus: 'single' },
    ];
    const { db } = fakeDb(rows);
    const report = await auditOrganizerIdentifiers(db as never, { pageSize: 2 });
    expect(report).toEqual({ documents: 3, documentsWithPlaintextIdentifiers: 2, documentsWithIdentifierTextToRedact: 1,
      plaintextFieldCounts: { ipPin: 1, taxpayerSSN: 1 }, encryptedFieldCounts: { taxpayerSSN: 1, bankAccount: 1 } });
    expect(JSON.stringify(report)).not.toMatch(/900000001|900000002|123456|900-00-0003|userId/);
  });
  it('requires --report and refuses an emulator unless explicitly allowed with a demo project', async () => {
    const { db } = fakeDb([]);
    const connectDb = async () => ({ db, close: async () => undefined });
    await expect(runOrganizerIdentifierAudit({ project: 'writeoff-prod', report: false, connectDb, inheritedEnv: {} })).rejects.toThrow('--report');
    await expect(runOrganizerIdentifierAudit({ project: 'writeoff-prod', report: true, connectDb, inheritedEnv: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } })).rejects.toThrow('refuses a Firestore emulator');
    await expect(runOrganizerIdentifierAudit({ project: 'writeoff-prod', report: true, allowEmulator: true, connectDb, inheritedEnv: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } })).rejects.toThrow('demo-');
    await expect(runOrganizerIdentifierAudit({ project: 'demo-writeoff', report: true, allowEmulator: true, connectDb, inheritedEnv: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } }))
      .resolves.toMatchObject({ readOnly: true, documents: 0 });
  });
});
