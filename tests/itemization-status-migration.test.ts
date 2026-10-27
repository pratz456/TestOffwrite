import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { createFakeFirestore, type FakeFirestore } from './fixtures/fake-firestore';
import {
  reviewedItemizationPlanConfirmation,
  runItemizationStatusMigration,
} from '../scripts/production-itemization-status-migration.mjs';

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;
const quiet = { log: () => {} };

function seed(fake: FakeFirestore, id: string, data: Record<string, unknown>) {
  fake.records.set(`user_profiles/${id}`, data);
}

describe('itemization status migration', () => {
  it('rewrites only the legacy spelling and leaves every other field in place', async () => {
    const db = createFakeFirestore();
    const original = {
      itemization_status: 'itemized',
      itemized: true,
      filing_status: 'single',
      email: 'owner@example.test',
      name: 'Owner',
      profession: 'Consultant',
      state: 'CA',
      income: '100000',
      w2_income: 100000,
      prior_year_tax: 9000,
      mailing_address: { city: 'Oakland', state: 'CA' },
      business_purpose: 'Design',
      health_insurance_premiums: 0,
    };
    seed(db, 'uid-fixture-a', original);
    const dry = await runItemizationStatusMigration({ db: asDb(db), ...quiet });
    expect(dry).toEqual({ mode: 'dry_run', matched: 1, writesPerformed: false });
    expect(db.records.get('user_profiles/uid-fixture-a')).toEqual(original);
    const applied = await runItemizationStatusMigration({
      db: asDb(db),
      apply: true,
      confirmation: reviewedItemizationPlanConfirmation(1),
      ...quiet,
    });
    expect(applied).toEqual({ mode: 'apply', matched: 1, updated: 1, skippedChanged: 0, failed: 0 });
    expect(db.records.get('user_profiles/uid-fixture-a')).toEqual({ ...original, itemization_status: 'itemize' });
    expect(db.records.get('user_profiles/uid-fixture-a')).not.toHaveProperty('updated_at');
    expect(db.records.get('user_profiles/uid-fixture-a')).not.toHaveProperty('updatedAt');
  });

  it('updates the legacy spelling once and leaves the other stored values byte for byte', async () => {
    const db = createFakeFirestore();
    const fixtures: Record<string, Record<string, unknown>> = {
      legacy: { itemization_status: 'itemized', itemized: true, name: 'Legacy' },
      current: { itemization_status: 'itemize', name: 'Current' },
      standard: { itemization_status: 'standard', itemized: true, name: 'Standard' },
      blank: { itemization_status: '', name: 'Blank' },
      missing: { name: 'Missing', itemized: false },
      capital: { itemization_status: 'Itemized', name: 'Capital' },
    };
    for (const [id, data] of Object.entries(fixtures)) seed(db, id, data);
    const before = structuredClone(Object.fromEntries(db.records));
    const first = await runItemizationStatusMigration({
      db: asDb(db),
      apply: true,
      confirmation: reviewedItemizationPlanConfirmation(1),
      ...quiet,
    });
    expect(first).toMatchObject({ mode: 'apply', matched: 1, updated: 1, skippedChanged: 0, failed: 0 });
    expect(db.records.get('user_profiles/legacy')).toEqual({ ...fixtures.legacy, itemization_status: 'itemize' });
    for (const id of ['current', 'standard', 'blank', 'missing', 'capital']) {
      expect(db.records.get(`user_profiles/${id}`)).toEqual(before[`user_profiles/${id}`]);
    }
    const second = await runItemizationStatusMigration({
      db: asDb(db),
      apply: true,
      confirmation: reviewedItemizationPlanConfirmation(0),
      ...quiet,
    });
    expect(second).toEqual({ mode: 'apply', matched: 0, updated: 0, skippedChanged: 0, failed: 0 });
  });

  it('defaults to a dry run, refuses an unconfirmed apply, batches under the transaction limit, and skips a changed document', async () => {
    const db = createFakeFirestore();
    seed(db, 'uid-fixture-a', { itemization_status: 'itemized', name: 'A' });
    seed(db, 'uid-fixture-b', { itemization_status: 'itemized', name: 'B' });
    seed(db, 'uid-fixture-c', { itemization_status: 'itemized', name: 'C' });
    const before = structuredClone(Object.fromEntries(db.records));
    const lines: string[] = [];
    const dry = await runItemizationStatusMigration({ db: asDb(db), log: line => lines.push(String(line)) });
    expect(dry).toEqual({ mode: 'dry_run', matched: 3, writesPerformed: false });
    expect(Object.keys(dry).sort()).toEqual(['matched', 'mode', 'writesPerformed']);
    expect(lines.join('\n')).not.toContain('uid-fixture-a');
    expect(Object.fromEntries(db.records)).toEqual(before);
    await expect(runItemizationStatusMigration({ db: asDb(db), apply: true, ...quiet })).rejects.toThrow(/confirm/);
    expect(Object.fromEntries(db.records)).toEqual(before);

    const collection = db.collection.bind(db);
    db.collection = ((name: string) => {
      const query = collection(name);
      const where = query.where.bind(query);
      query.where = (...args: unknown[]) => {
        const filtered = where(...args);
        const select = filtered.select.bind(filtered);
        filtered.select = (...selectArgs: unknown[]) => {
          const selected = select(...selectArgs);
          const get = selected.get.bind(selected);
          selected.get = async () => {
            const snap = await get();
            const path = 'user_profiles/uid-fixture-c';
            db.records.set(path, { ...db.records.get(path), itemization_status: 'standard' });
            return snap;
          };
          return selected;
        };
        return filtered;
      };
      return query;
    }) as FakeFirestore['collection'];
    let transactions = 0;
    const runTransaction = db.runTransaction.bind(db);
    db.runTransaction = (async (work: Parameters<FakeFirestore['runTransaction']>[0]) => {
      transactions += 1;
      return runTransaction(work);
    }) as FakeFirestore['runTransaction'];
    const applied = await runItemizationStatusMigration({
      db: asDb(db),
      apply: true,
      confirmation: reviewedItemizationPlanConfirmation(3),
      batchSize: 2,
      log: line => lines.push(String(line)),
    });
    expect(transactions).toBe(2);
    expect(applied).toEqual({ mode: 'apply', matched: 3, updated: 2, skippedChanged: 1, failed: 0 });
    expect(Object.keys(applied).sort()).toEqual(['failed', 'matched', 'mode', 'skippedChanged', 'updated']);
    expect(JSON.stringify(applied)).not.toContain('uid-fixture-a');
    expect(db.records.get('user_profiles/uid-fixture-a')!.itemization_status).toBe('itemize');
    expect(db.records.get('user_profiles/uid-fixture-b')!.itemization_status).toBe('itemize');
    expect(db.records.get('user_profiles/uid-fixture-c')!.itemization_status).toBe('standard');
  });

  it('recounts a legacy value written after the first apply and rewrites only that document', async () => {
    const db = createFakeFirestore();
    seed(db, 'uid-fixture-a', { itemization_status: 'itemized', name: 'A', itemized: true });
    seed(db, 'uid-fixture-b', { itemization_status: 'standard', name: 'B' });
    await runItemizationStatusMigration({
      db: asDb(db),
      apply: true,
      confirmation: reviewedItemizationPlanConfirmation(1),
      ...quiet,
    });
    expect(db.records.get('user_profiles/uid-fixture-a')!.itemization_status).toBe('itemize');
    db.records.set('user_profiles/uid-fixture-a', {
      ...db.records.get('user_profiles/uid-fixture-a'),
      itemization_status: 'itemized',
    });
    const lines: string[] = [];
    const recount = await runItemizationStatusMigration({ db: asDb(db), log: line => lines.push(String(line)) });
    expect(recount).toEqual({ mode: 'dry_run', matched: 1, writesPerformed: false });
    expect(lines.join('\n')).not.toContain('uid-fixture-a');
    expect(db.records.get('user_profiles/uid-fixture-a')!.itemization_status).toBe('itemized');
    const applied = await runItemizationStatusMigration({
      db: asDb(db),
      apply: true,
      confirmation: reviewedItemizationPlanConfirmation(1),
      ...quiet,
    });
    expect(applied).toMatchObject({ matched: 1, updated: 1, skippedChanged: 0, failed: 0 });
    expect(db.records.get('user_profiles/uid-fixture-a')!.itemization_status).toBe('itemize');
    const clear = await runItemizationStatusMigration({ db: asDb(db), ...quiet });
    expect(clear).toEqual({ mode: 'dry_run', matched: 0, writesPerformed: false });
  });

  it('refuses to connect when the file is executed directly', () => {
    const source = readFileSync('scripts/production-itemization-status-migration.mjs', 'utf8');
    expect(source).not.toMatch(/firebase-admin|applicationDefault|GOOGLE_APPLICATION_CREDENTIALS/);
    const result = spawnSync(process.execPath, ['scripts/production-itemization-status-migration.mjs'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('This migration does not connect to Firebase');
    expect(result.stdout).toBe('');
  });
});
