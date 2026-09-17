import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildProductionMigrationInventory,
  writePrivateMigrationInventory,
} from '../scripts/production-migration-inventory.mjs';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const transaction = (id: string, overrides = {}) => ({
  id,
  data: {
    date: '2026-04-15',
    amount: 4321.98,
    merchant_name: 'Sensitive Merchant Name',
    iso_currency_code: 'USD',
    ...overrides,
  },
});

describe('read-only production migration inventory', () => {
  it('reports exact cross-account overlap candidates without exposing source facts or deciding a winner', () => {
    const report = buildProductionMigrationInventory({
      sourceCommit: 'a'.repeat(40),
      generatedAt: '2026-09-17T00:00:00Z',
      connections: [{ uid: 'legacy-user', status: 'relink_required', encryptedAccessToken: 'never-export-this' }],
      profiles: [{
        uid: 'legacy-user',
        data: {
          plaid_token: 'old-provider-secret',
          plaid_item_id: 'old-provider-item',
          plaid_credentials_migrated: false,
        },
        accounts: [
          {
            id: 'old-account',
            data: { source: 'plaid', plaid_item_id: 'old-provider-item', access_token: 'account-secret' },
            transactions: [transaction('old-confirmed', { review_status: 'confirmed', is_deductible: true })],
          },
          {
            id: 'replacement-account',
            data: { source: 'plaid', plaid_item_id: 'new-provider-item' },
            transactions: [transaction('new-import')],
          },
          {
            id: 'manual',
            data: { source: 'manual' },
            transactions: [transaction('manual-match')],
          },
        ],
      }],
    });

    expect(report.guarantees).toEqual({
      writesPerformed: false,
      automatedReconciliationDecisions: 0,
      customerConfirmationsChanged: 0,
    });
    expect(report.totals).toMatchObject({
      profiles: 1,
      legacyProfiles: 1,
      accountDocuments: 3,
      transactionDocuments: 3,
      confirmedTransactions: 1,
      savedTaxDecisions: 1,
      privateConnections: 1,
      potentialHistoricalOverlapGroups: 1,
    });
    expect(report.profiles[0]).toMatchObject({
      uid: 'legacy-user',
      legacyProfileCredentialPresent: true,
      accountLegacyCredentialPresent: true,
      credentialMigrationMarked: false,
      privateConnectionStates: ['relink_required'],
    });
    expect(report.profiles[0].accounts).toHaveLength(3);
    expect(report.profiles[0].potentialHistoricalOverlaps[0]).toMatchObject({
      resolution: 'human_review_required',
      records: [
        {
          reference: 'user_profiles/legacy-user/accounts/old-account/transactions/old-confirmed',
          confirmed: true,
          savedTaxDecision: true,
        },
        {
          reference: 'user_profiles/legacy-user/accounts/replacement-account/transactions/new-import',
          confirmed: false,
          savedTaxDecision: false,
        },
      ],
    });
    const serialized = JSON.stringify(report);
    for (const value of [
      'old-provider-secret',
      'account-secret',
      'old-provider-item',
      'new-provider-item',
      'never-export-this',
      'Sensitive Merchant Name',
      '4321.98',
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it('flags account sets that cannot use the transactional lazy migration', () => {
    const accounts = Array.from({ length: 401 }, (_, index) => ({
      id: `account-${index}`,
      data: { source: 'plaid' },
      transactions: [],
    }));
    const report = buildProductionMigrationInventory({
      profiles: [{ uid: 'large-user', data: { plaid_token: 'private' }, accounts }],
      sourceCommit: 'b'.repeat(40),
    });
    expect(report.totals.profilesRequiringPaginatedMigration).toBe(1);
    expect(report.profiles[0].requiresPaginatedMigration).toBe(true);
    expect(report.profiles[0].accountCount).toBe(401);
  });

  it('writes a new private report only outside the checkout', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'writeoff-inventory-test-'));
    directories.push(root);
    const checkout = path.join(root, 'checkout');
    fs.mkdirSync(checkout);
    const output = path.join(root, 'migration-inventory.json');
    const report = buildProductionMigrationInventory({ profiles: [], sourceCommit: 'c'.repeat(40) });
    expect(writePrivateMigrationInventory(output, report, checkout)).toMatch(/^[a-f\d]{64}$/);
    expect(fs.statSync(output).mode & 0o077).toBe(0);
    expect(() => writePrivateMigrationInventory(output, report, checkout)).toThrow();
    expect(() => writePrivateMigrationInventory(path.join(checkout, 'report.json'), report, checkout)).toThrow('outside');
  });
});
