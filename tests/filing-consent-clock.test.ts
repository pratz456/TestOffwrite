import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/admin', async () => {
  const { createFakeFirestore } = await import('./fixtures/fake-firestore');
  return { adminDb: createFakeFirestore() };
});

import { adminDb } from '@/lib/firebase/admin';
import type { FakeFirestore } from './fixtures/fake-firestore';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CURRENT_CONSENT_TEXT_VERSION,
  DRAFT_DISCLOSURE_CONSENT_TEXT,
  FILING_CONSENT_TEXT_COLLECTION,
  PARTNER_RECIPIENT_LEGAL_NAMES,
} from '@/lib/filing-consent';
import { resetFilingConsentClock, setFilingConsentClock } from '@/lib/filing-consent/clock';
import { saveDisclosureConsent, type SaveDisclosureConsentInput } from '@/lib/filing-consent/store';

const db = adminDb as unknown as FakeFirestore;
const PARTNER = PARTNER_RECIPIENT_LEGAL_NAMES[0];

const fetchSpy = vi.spyOn(globalThis, 'fetch');

function saveInput(): SaveDisclosureConsentInput {
  return {
    uid: 'user-1',
    taxYear: 2026,
    taxpayerName: 'Test Taxpayer',
    purpose: 'DRAFT: to prepare and e-file your 2026 federal return and your home state return',
    returnsCovered: [{ code: 'federal', taxYear: 2026 }],
    recipients: [PARTNER],
    scope: { kind: 'whole_return' },
    signatureMethod: 'typed_name',
    signatureValue: 'Test Taxpayer',
    userTypedNotPrefilled: true,
    kind: 'disclosure',
  };
}

beforeEach(async () => {
  resetFilingConsentClock();
  db.records.clear();
  fetchSpy.mockClear();
  await db.collection(FILING_CONSENT_TEXT_COLLECTION).doc(CURRENT_CONSENT_TEXT_VERSION).set({
    version: CURRENT_CONSENT_TEXT_VERSION,
    text: DRAFT_DISCLOSURE_CONSENT_TEXT,
  });
});

afterEach(() => {
  resetFilingConsentClock();
  expect(fetchSpy).not.toHaveBeenCalled();
});

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const clockSetters = ['setFilingConsentClock', 'resetFilingConsentClock'];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) found.push(full);
  }
  return found;
}

describe('filing consent clock seam', () => {
  it('stores the signing time from the clock module', async () => {
    setFilingConsentClock(() => new Date('2026-06-01T15:00:00.000Z'));
    const saved = await saveDisclosureConsent(saveInput());
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error('expected a stored disclosure consent');
    expect(saved.record.signedAt).toBe('2026-06-01T15:00:00.000Z');
    expect(saved.record.expiresAt).toBe('2027-06-01T15:00:00.000Z');
  });

  it('keeps the clock setters out of non test files except the clock module', () => {
    const allowed = path.join('lib', 'filing-consent', 'clock.ts');
    const hits = sourceFiles(repoRoot)
      .map(file => path.relative(repoRoot, file))
      .filter(rel => !rel.startsWith(`tests${path.sep}`) && rel !== allowed)
      .filter(rel => clockSetters.some(name => readFileSync(path.join(repoRoot, rel), 'utf8').includes(name)));
    expect(hits).toEqual([]);
  });

  it('imports the clock setters only from the clock module', () => {
    const bad: string[] = [];
    for (const file of sourceFiles(path.join(repoRoot, 'tests'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
        if (!clockSetters.some(name => match[1].includes(name))) continue;
        if (!match[2].endsWith('/clock') && !match[2].endsWith('/clock.ts')) bad.push(`${path.relative(repoRoot, file)} from ${match[2]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
