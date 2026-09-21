import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OVERLAP_SERVER_ONLY_FIELDS } from '@/lib/transactions/historical-overlap';

// Static contract for the deployed rules text. The emulator suite
// (tests/security-rules.emulator.test.ts) exercises the same statements live.
describe('transaction rules keep server-reviewed deductions server-owned', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const statements = [
    rules.slice(rules.indexOf('match /{path=**}/transactions/{txId}'), rules.indexOf('match /analysis_jobs/{jobId}')),
    rules.slice(rules.indexOf('match /transactions/{txId}')),
  ].map(block => block.match(/allow update:([^;]+);/)?.[1]);

  it.each([['collection-group fallback', 0], ['owner account subcollection', 1]])('%s update statement', (_label, index) => {
    const statement = statements[index];
    expect(statement).toBeDefined();
    // Existing client flow: the owner may still edit is_deductible on unreviewed records.
    expect(statement).toMatch(/hasOnly\(\[[\s\S]*'is_deductible'/);
    expect(statement).toMatch(/affectedKeys\(\)\.hasAny\(\['is_deductible'\]\)[\s\S]*\|\|[\s\S]*!resource\.data\.keys\(\)\.hasAny\(\['review_status'\]\)/);
    // review_status itself remains outside the editable allowlist.
    expect(statement!.match(/hasOnly\(\[([\s\S]*?)\]\)/)![1]).not.toContain('review_status');
  });

  it.each([['collection-group fallback', 0], ['owner account subcollection', 1]])('%s keeps historical-overlap fields Admin SDK only', (_label, index) => {
    const statement = statements[index]!;
    // The allow-list is evaluated over affectedKeys(), so a client can neither add, change nor remove these fields.
    expect(statement).toMatch(/request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\[/);
    const allowed = statement.match(/hasOnly\(\[([\s\S]*?)\]\)/)![1].match(/'([^']+)'/g)!.map(field => field.slice(1, -1));
    expect(allowed.length).toBeGreaterThan(0);
    for (const field of OVERLAP_SERVER_ONLY_FIELDS) expect(allowed).not.toContain(field);
    expect(statement).not.toMatch(/superseded|overlap_reviewed/);
  });

  it('never lets clients create or delete transaction records', () => {
    expect(rules.match(/allow create, delete: if false;/g)).toHaveLength(2);
  });
});
