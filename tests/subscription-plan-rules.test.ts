import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EDITABLE_PROFILE_FIELDS } from '@/lib/firebase/profile-fields';

// Source guard complements the opt-in Firestore emulator create/update/delete checks.
describe('verified subscription tier is server-managed', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const profileRules = rules.slice(rules.indexOf('match /user_profiles/{uid}'));
  it('blocks every direct client profile create, update and delete', () => {
    expect(profileRules).toMatch(/allow create, update, delete: if false;/);
  });
  it('does not allow the profile API to accept the paid tier as an ordinary editable field', () => {
    expect(EDITABLE_PROFILE_FIELDS.has('subscriptionPlan')).toBe(false);
  });
});
