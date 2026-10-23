import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_NAVIGATION,
  PRIMARY_NAVIGATION,
  RECORD_NAVIGATION,
  TAX_TOOL_NAVIGATION,
} from '../lib/navigation/app-navigation';

const NAVIGATION = [
  ...PRIMARY_NAVIGATION,
  ...RECORD_NAVIGATION,
  ...TAX_TOOL_NAVIGATION,
  ...ACCOUNT_NAVIGATION,
];

const FILING_EXPORTS_DESCRIPTION = 'Get your records ready and export them for your tax preparer';
const RETIRED_FILING_DESCRIPTION = 'Prepare and export for filing';

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

describe('filing and exports navigation copy', () => {
  it('pins the Filing & exports description', () => {
    const item = RECORD_NAVIGATION.find(entry => entry.name === 'Filing & exports');
    expect(item?.name).toBe('Filing & exports');
    expect(item?.description).toBe(FILING_EXPORTS_DESCRIPTION);
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
