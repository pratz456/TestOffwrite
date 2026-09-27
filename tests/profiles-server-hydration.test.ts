import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ profile: {} as Record<string, unknown> }));
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: (id: string) => ({
        id,
        get: async () => ({ id, exists: true, data: () => ({ ...state.profile }) }),
      }),
    }),
  },
}));

import { getUserProfileServer } from '@/lib/firebase/profiles-server';

beforeEach(() => {
  state.profile = {
    email: 'owner@example.test',
    name: 'Owner',
    profession: 'Consultant',
    income: 75_000,
    state: 'CA',
    filing_status: 'single',
    w2_income: 50_000,
    w2_social_security_wages: 48_000,
    w2_medicare_wages: 52_000,
    w2_federal_withheld: 8_000,
    health_insurance_premiums: 2_000,
    sep_ira_contribution: 3_000,
    solo_401k_contribution: 4_000,
    hsa_contribution: 1_000,
    simple_ira_contribution: 500,
    prior_year_tax: 9_000,
    ein_encrypted: 'private-ciphertext',
    ein_last4: '6789',
  };
});

describe('server profile hydration', () => {
  it('returns every tax input used by rate/snapshot consumers while masking the EIN', async () => {
    const result = await getUserProfileServer('owner');
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      income: 75_000,
      w2_income: 50_000,
      w2_social_security_wages: 48_000,
      w2_medicare_wages: 52_000,
      w2_federal_withheld: 8_000,
      health_insurance_premiums: 2_000,
      sep_ira_contribution: 3_000,
      solo_401k_contribution: 4_000,
      hsa_contribution: 1_000,
      simple_ira_contribution: 500,
      prior_year_tax: 9_000,
      ein: '**-***6789',
    });
    expect(JSON.stringify(result.data)).not.toContain('private-ciphertext');
  });
});
