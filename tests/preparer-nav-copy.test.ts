import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filingNavName, PREPARER_NAV_RENAME } from '../lib/copy/preparer-copy';
import {
  ACCOUNT_NAVIGATION,
  PRIMARY_NAVIGATION,
  RECORD_NAVIGATION,
  TAX_TOOL_NAVIGATION,
  type AppNavigationItem,
} from '../lib/navigation/app-navigation';

const NAVIGATION = [
  ...PRIMARY_NAVIGATION,
  ...RECORD_NAVIGATION,
  ...TAX_TOOL_NAVIGATION,
  ...ACCOUNT_NAVIGATION,
];

const FILING_HREF = '/protected?screen=tax-filing-hub';
const FILING_EXPORTS_DESCRIPTION = 'Get your records ready and export them for your tax preparer';
const RETIRED_FILING_DESCRIPTION = 'Prepare and export for filing';
const NAV_SOURCE = resolve(process.cwd(), 'lib/navigation/app-navigation.ts');

/** Conjunctions and prepositions that continue the verb instead of naming what is prepared. */
const PREPARE_CONTINUATIONS = new Set(['and', 'or', 'then', 'to', 'for', 'before', 'after', 'by', 'with']);

function prepareWithoutObject(description: string): boolean {
  const match = description.match(/\bPrepare\b([^.]*)/);
  if (!match) return false;
  const remainder = match[1].trim();
  if (remainder === '') return true;
  const next = remainder.split(/\s+/)[0].replace(/[^A-Za-z]/g, '').toLowerCase();
  return PREPARE_CONTINUATIONS.has(next);
}

function filingItem(records: readonly AppNavigationItem[]): AppNavigationItem {
  const item = records.find(entry => entry.href === FILING_HREF);
  expect(item).toBeDefined();
  return item as AppNavigationItem;
}

async function loadFilingItem(rename: boolean): Promise<AppNavigationItem> {
  vi.resetModules();
  vi.doMock('../lib/copy/preparer-copy', async () => {
    const actual = await vi.importActual<typeof import('../lib/copy/preparer-copy')>('../lib/copy/preparer-copy');
    return { ...actual, PREPARER_NAV_RENAME: rename };
  });
  try {
    const navigation = await import('../lib/navigation/app-navigation');
    return filingItem(navigation.RECORD_NAVIGATION);
  } finally {
    vi.doUnmock('../lib/copy/preparer-copy');
    vi.resetModules();
  }
}

describe('filing and exports navigation copy', () => {
  afterEach(() => {
    vi.doUnmock('../lib/copy/preparer-copy');
    vi.resetModules();
  });

  it('pins the Filing & exports description', () => {
    const item = filingItem(RECORD_NAVIGATION);
    expect(PREPARER_NAV_RENAME).toBe(false);
    expect(item.name).toBe('Filing & exports');
    expect(item.name).toBe(filingNavName(false));
    expect(item.description).toBe(FILING_EXPORTS_DESCRIPTION);
  });

  it('uses the rename switch for the nav name', async () => {
    const off = await loadFilingItem(false);
    const on = await loadFilingItem(true);
    expect(off.name).toBe('Filing & exports');
    expect(on.name).toBe('Preparer exports');
    expect(off.description).toBe(FILING_EXPORTS_DESCRIPTION);
    expect(on.description).toBe(FILING_EXPORTS_DESCRIPTION);
  });

  it('fails when the nav item hardcodes its name', () => {
    const source = readFileSync(NAV_SOURCE, 'utf8');
    expect(source).toContain('name: filingNavName(PREPARER_NAV_RENAME)');
    expect(source).not.toContain("name: 'Filing & exports'");
    expect(source).not.toContain('name: "Filing & exports"');
    expect(source).not.toContain("name: 'Preparer exports'");
    expect(source).not.toContain('name: "Preparer exports"');
  });

  it('rejects a nav description that uses Prepare without an object', () => {
    const descriptions = NAVIGATION.map(entry => entry.description);
    const prepareWithoutObjectHits = descriptions.filter(prepareWithoutObject);
    expect({
      retiredDescriptionPresent: descriptions.includes(RETIRED_FILING_DESCRIPTION),
      prepareWithoutObject: prepareWithoutObjectHits,
    }).toEqual({
      retiredDescriptionPresent: false,
      prepareWithoutObject: [],
    });
  });
});
