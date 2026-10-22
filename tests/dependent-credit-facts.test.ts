import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { organizerTaxInputResponse, organizerTaxInputValues } from '../lib/tax-rules/organizer-tax-inputs';

const screenSource = readFileSync('components/tax-organizer-screen.tsx', 'utf8');
const routeSource = readFileSync('app/api/tax/organizer/route.ts', 'utf8');

/** Dependent properties named by the organizer type, its JSON shape, and the save path. */
function dependentProperties(screen: string, route: string): string[] {
  const found = new Set<string>();
  const shape = screen.match(/dependentDetails[^\n]*JSON:\s*\[\{([^{}\n]+)\}\]/);
  if (!shape) throw new Error('Organizer type is missing the dependent JSON shape');
  for (const name of shape[1].split(',')) {
    const trimmed = name.trim();
    if (trimmed) found.add(trimmed);
  }
  const iface = screen.match(/interface OrgAnswers[^{]*\{([\s\S]*?)\n\}/);
  if (!iface) throw new Error('OrgAnswers is missing');
  for (const match of iface[1].matchAll(/(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/g)) {
    if (/dependent/i.test(match[1])) found.add(match[1]);
  }
  const save = screen.match(/function organizerSaveBody[\s\S]*?\n\}/);
  if (!save) throw new Error('organizerSaveBody is missing');
  const skipped = new Set<string>();
  for (const match of save[0].matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)) skipped.add(match[1]);
  for (const name of [...found]) {
    if (skipped.has(name)) found.delete(name);
  }
  if (!route.includes('...answers')) throw new Error('Organizer save route no longer keeps answer fields');
  return [...found].sort();
}

describe('dependent credit facts', () => {
  it('drops a non-object dependent array item from the key and the tax-input read', () => {
    const input = '["Emma 123-45-6789"]';
    const key = organizerTaxInputValues({ dependents: input });
    const read = organizerTaxInputResponse({ dependents: input });
    const packed = JSON.stringify({ key: key.dependents, read: read.dependents });
    expect(packed).not.toContain(input);
    expect(packed).not.toContain('Emma');
    expect(packed).not.toMatch(/\d/);
    expect(key.dependents).toBe('[]');
    expect(read.dependents).toEqual([]);
    const mixed = organizerTaxInputResponse({
      dependents: [{ relationship: 'daughter', dateOfBirth: '2018-03-15' }, 'Emma 123-45-6789'],
    });
    const mixedPacked = JSON.stringify(mixed.dependents);
    expect(mixedPacked).not.toContain('Emma');
    expect(mixedPacked).not.toMatch(/123-45-6789/);
    expect(mixedPacked).toContain('"dateOfBirth":"2018-03-15"');
  });

  it('changes the key when grandchild becomes other_relative, and a relationship with digits becomes unknown', () => {
    const grandchild = organizerTaxInputValues({ dependents: [{ relationship: 'grandchild', dateOfBirth: '2018-03-15' }] });
    const other = organizerTaxInputValues({ dependents: [{ relationship: 'other_relative', dateOfBirth: '2018-03-15' }] });
    expect(String(grandchild.dependents)).toContain('"relationship":"descendant_of_child_or_sibling"');
    expect(String(other.dependents)).toContain('"relationship":"other_relative"');
    expect(grandchild.dependents).not.toBe(other.dependents);
    for (const [raw, mapped] of [
      ['son', 'child'],
      ['daughter', 'child'],
      ['half-brother', 'sibling'],
      ['stepsister', 'sibling'],
      ['niece', 'descendant_of_child_or_sibling'],
      ['nephew', 'descendant_of_child_or_sibling'],
    ] as const) {
      expect(String(organizerTaxInputValues({ dependents: [{ relationship: raw }] }).dependents), raw).toContain(`"relationship":"${mapped}"`);
    }
    const digits = organizerTaxInputValues({ dependents: [{ relationship: '123-45-6789' }] });
    const read = organizerTaxInputResponse({ dependents: [{ relationship: 'niece 123-45-6789' }] });
    expect(String(digits.dependents)).toContain('"relationship":"unknown"');
    expect(JSON.stringify(read.dependents)).toContain('"relationship":"unknown"');
    const packed = JSON.stringify({ key: digits.dependents, read: read.dependents });
    expect(packed).not.toMatch(/\d/);
    expect(packed).not.toContain('123-45-6789');
  });

  it('keeps a date of birth only when it is a valid ISO date', () => {
    expect(JSON.stringify(organizerTaxInputResponse({ dependents: [{ dateOfBirth: '2018-03-15' }] }).dependents)).toContain('"dateOfBirth":"2018-03-15"');
    expect(String(organizerTaxInputValues({ dependents: [{ dateOfBirth: '2016-02-29' }] }).dependents)).toContain('"dateOfBirth":"2016-02-29"');
    for (const bad of ['2018-02-31', '2018-02-29', '03/15/2018', '2018-3-5', '2018-03-15T00:00:00Z']) {
      const key = organizerTaxInputValues({ dependents: [{ dateOfBirth: bad }] });
      const read = organizerTaxInputResponse({ dependents: [{ dateOfBirth: bad }] });
      expect(String(key.dependents), bad).toContain('"dateOfBirth":null');
      expect(JSON.stringify(read.dependents), bad).toContain('"dateOfBirth":null');
      expect(`${key.dependents}${JSON.stringify(read.dependents)}`, bad).not.toContain(bad);
    }
  });

  it('keeps the same dependent fields the federal snapshot reads', async () => {
    const inputs = await import('../lib/tax-rules/organizer-tax-inputs');
    const scope = await import('../lib/tax-rules/credit-scope');
    expect(Array.isArray(inputs.DEPENDENT_CREDIT_FIELDS)).toBe(true);
    expect(Array.isArray(scope.SNAPSHOT_DEPENDENT_FIELDS)).toBe(true);
    expect(inputs.DEPENDENT_CREDIT_FIELDS).toBe(scope.SNAPSHOT_DEPENDENT_FIELDS);
    expect([...(inputs.DEPENDENT_CREDIT_FIELDS ?? [])]).not.toContain('fullTimeStudent');
    expect([...(inputs.DEPENDENT_CREDIT_FIELDS ?? [])]).not.toContain('permanentlyAndTotallyDisabled');
    expect(typeof scope.readSnapshotDependentFacts).toBe('function');
    const seen = new Set<string>();
    const row = new Proxy({} as Record<string, unknown>, {
      get(target, prop, receiver) {
        if (typeof prop === 'string') seen.add(prop);
        return Reflect.get(target, prop, receiver);
      },
    });
    scope.readSnapshotDependentFacts([row]);
    expect([...seen].sort()).toEqual([...(scope.SNAPSHOT_DEPENDENT_FIELDS ?? [])].sort());
    const snapshotSource = readFileSync('lib/tax-rules/federal-tax-snapshot.ts', 'utf8');
    expect(snapshotSource).toContain('readSnapshotDependentFacts(');
  });

  it('classifies every dependent property the organizer can write', async () => {
    const inputs = await import('../lib/tax-rules/organizer-tax-inputs');
    const properties = dependentProperties(screenSource, routeSource);
    expect(properties.length).toBeGreaterThan(0);
    const credit = new Set<string>(inputs.DEPENDENT_CREDIT_FIELDS ?? []);
    const ignored = inputs.DEPENDENT_IGNORED_FIELDS ?? {};
    const missing = properties.filter(name => !credit.has(name) && !Object.prototype.hasOwnProperty.call(ignored, name));
    expect(missing, properties.join(', ')).toEqual([]);
    for (const name of properties) {
      if (!Object.prototype.hasOwnProperty.call(ignored, name)) continue;
      const reason = ignored[name];
      expect(typeof reason, name).toBe('string');
      expect(reason, name).toMatch(/\S/);
      expect(reason, name).not.toMatch(/\n/);
    }
  });

  it('does not list a dependent field as both a credit fact and ignored', async () => {
    const inputs = await import('../lib/tax-rules/organizer-tax-inputs');
    expect(inputs.DEPENDENT_IGNORED_FIELDS, 'ignored list').toBeDefined();
    const ignored = inputs.DEPENDENT_IGNORED_FIELDS ?? {};
    const names = Object.keys(ignored);
    expect(names.length).toBeGreaterThan(0);
    const credit = new Set<string>(inputs.DEPENDENT_CREDIT_FIELDS ?? []);
    expect(names.filter(name => credit.has(name))).toEqual([]);
    for (const name of names) {
      expect(ignored[name], name).toMatch(/^\S(?:(?!\n).)*\S$|^\S$/);
    }
  });
});
