import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_COLLECTION } from '@/lib/security/rate-limit';
import { SUPPORT_AUDIT_COLLECTION } from '@/lib/support/access';

// Source guard complementing the opt-in emulator suite (tests/security-rules.emulator.test.ts):
// server-only collections must be denied to every client, following the plaid_connections pattern.
describe('firestore.rules keeps server-only collections closed to clients', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const block = (collection: string) => {
    const match = rules.match(new RegExp(`match /${collection}/\\{[A-Za-z]+\\}\\s*\\{([\\s\\S]*?)\\n    \\}`));
    expect(match, `${collection} rules block`).toBeDefined();
    return match![1];
  };
  it.each(['plaid_connections', 'profile_analysis_refresh', RATE_LIMIT_COLLECTION, SUPPORT_AUDIT_COLLECTION])('denies every client read and write of %s', collection => {
    const body = block(collection);
    expect(body).toMatch(/allow read, write: if false;/);
    expect(body.match(/allow /g)).toHaveLength(1);
    expect(body).not.toMatch(/if true|request\.auth/);
  });
  it('declares each server-only collection exactly once, as a top-level match', () => {
    for (const collection of ['profile_analysis_refresh', RATE_LIMIT_COLLECTION, SUPPORT_AUDIT_COLLECTION]) {
      expect(rules.match(new RegExp(`match /${collection}/`, 'g'))).toHaveLength(1);
      expect(rules).toMatch(new RegExp(`\\n    match /${collection}/\\{[A-Za-z]+\\} \\{`));
    }
  });
});
