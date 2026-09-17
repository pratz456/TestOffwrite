import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  record: {} as Record<string, unknown>,
  doc: vi.fn(),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
  setDoc: vi.fn(),
  waitForAuth: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: firestore.doc,
  getDoc: firestore.getDoc,
  updateDoc: firestore.updateDoc,
  setDoc: firestore.setDoc,
  serverTimestamp: () => 'synthetic-server-timestamp',
}));
vi.mock('@/lib/firebase/client', () => ({ db: 'synthetic-database' }));
vi.mock('@/lib/firebase/auth', () => ({ waitForAuth: firestore.waitForAuth }));

import { getUserProfile, getUserProfileSafe, upsertUserProfile } from '../lib/firebase/profiles';

const taxFacts = {
  home_office_sqft: 120,
  total_home_sqft: 1500,
  vehicle_business_use_percentage: 60,
  w2_income: 50000,
  w2_federal_withheld: 0,
  business_income: 23000,
  health_insurance_premiums: 2400,
  sep_ira_contribution: 3000,
  solo_401k_contribution: 6000,
  hsa_contribution: 0,
  simple_ira_contribution: 1500,
  tax_bracket: 22,
  prior_year_tax: 7400,
};
const mailingAddress = { street: '123 Test Street', city: 'Los Angeles', state: 'CA', zip: '90001' };
const profile = {
  email: 'synthetic@example.test', name: 'Synthetic User', profession: 'Consultant',
  filing_status: 'Single', state: 'California', income: 'Synthetic range',
  ...taxFacts, mailing_address: mailingAddress,
};
const readers = [
  { label: 'explicit-owner reader', read: () => getUserProfile('profile-owner') },
  { label: 'authenticated reader', read: () => getUserProfileSafe() },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  firestore.record = structuredClone(profile);
  firestore.doc.mockImplementation((_db, collection, id) => ({ collection, id }));
  firestore.waitForAuth.mockResolvedValue('profile-owner');
  firestore.getDoc.mockImplementation(async () => {
    const snapshot = structuredClone(firestore.record);
    return { id: 'profile-owner', exists: () => true, data: () => snapshot };
  });
  firestore.updateDoc.mockImplementation(async (_reference, values) => {
    firestore.record = { ...firestore.record, ...structuredClone(values) };
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe.each(readers)('profile settings persistence through $label', ({ read }) => {
  it('retains every saved tax amount and mailing address when another profile field changes', async () => {
    const loaded = await read();
    expect(loaded.error).toBeNull();
    expect(loaded.data).toMatchObject({ ...taxFacts, mailing_address: mailingAddress });

    const saved = await upsertUserProfile('profile-owner', { ...loaded.data!, name: 'Updated Name' });
    expect(saved.error).toBeNull();
    expect(saved.data).toMatchObject({ ...taxFacts, mailing_address: mailingAddress, name: 'Updated Name' });
    expect(firestore.record).toMatchObject({ ...taxFacts, mailing_address: mailingAddress, name: 'Updated Name' });
    expect(firestore.updateDoc).toHaveBeenCalledWith({ collection: 'user_profiles', id: 'profile-owner' }, expect.objectContaining(taxFacts));
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('persists explicit numeric clears as null while retaining zero and unrelated stored fields', async () => {
    firestore.record.legacy_tax_note = 'Keep this separate field';
    const saved = await upsertUserProfile('profile-owner', {
      w2_federal_withheld: null,
      health_insurance_premiums: null,
      sep_ira_contribution: null,
      solo_401k_contribution: null,
      hsa_contribution: null,
      simple_ira_contribution: null,
      prior_year_tax: null,
      business_income: 0,
    });
    const cleared = {
      w2_federal_withheld: null, health_insurance_premiums: null,
      sep_ira_contribution: null, solo_401k_contribution: null,
      hsa_contribution: null, simple_ira_contribution: null,
      prior_year_tax: null, business_income: 0,
    };
    expect(saved.error).toBeNull();
    expect(saved.data).toMatchObject(cleared);
    expect((await read()).data).toMatchObject({ ...cleared, mailing_address: mailingAddress, w2_income: 50000 });
    expect(firestore.record).toMatchObject({ ...cleared, legacy_tax_note: 'Keep this separate field' });
  });

  it('keeps absent fields undefined instead of inventing amounts or clearing persisted values on partial updates', async () => {
    firestore.record = { name: 'Minimal profile', email: 'synthetic@example.test' };
    const loaded = await read();
    for (const field of Object.keys(taxFacts) as (keyof typeof taxFacts)[]) {
      expect(loaded.data?.[field]).toBeUndefined();
    }
    expect(loaded.data?.mailing_address).toBeUndefined();

    firestore.record.w2_federal_withheld = 900;
    await upsertUserProfile('profile-owner', { name: 'Changed name', w2_federal_withheld: undefined });
    expect(firestore.updateDoc.mock.calls[0][1]).not.toHaveProperty('w2_federal_withheld');
    expect((await read()).data?.w2_federal_withheld).toBe(900);
  });
});
