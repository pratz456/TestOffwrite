import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const store = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>() }));
const pathFor = (id = 'owner') => `user_profiles/${id}`;

vi.mock('@/lib/firebase/admin', () => {
  const apply = (target: string, fields: Record<string, unknown>, merge: boolean) => {
    const next: Record<string, unknown> = merge ? { ...store.docs.get(target) } : {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === '__delete__') delete next[key];
      else next[key] = value;
    }
    store.docs.set(target, next);
  };
  const snapshot = (target: string) => ({
    id: target.split('/').at(-1),
    exists: store.docs.has(target),
    data: () => (store.docs.has(target) ? { ...store.docs.get(target) } : undefined),
  });
  const document = (target: string) => ({
    id: target.split('/').at(-1),
    get: async () => snapshot(target),
    update: async (fields: Record<string, unknown>) => apply(target, fields, true),
    set: async (fields: Record<string, unknown>, options?: { merge?: boolean }) => apply(target, fields, options?.merge === true),
  });
  return {
    adminDb: {
      doc: (target: string) => document(target),
      collection: (name: string) => ({ doc: (id: string) => document(`${name}/${id}`) }),
      runTransaction: async (callback: (transaction: {
        get: (ref: { get: () => Promise<unknown> }) => Promise<unknown>;
        set: (ref: { id?: string }, fields: Record<string, unknown>, options?: { merge?: boolean }) => void;
        update: (ref: unknown, fields: Record<string, unknown>) => void;
      }) => Promise<void>) => callback({
        get: async ref => ref.get(),
        set: (_ref, fields, options) => apply(pathFor(), fields, options?.merge !== false),
        update: (_ref, fields) => apply(pathFor(), fields, true),
      }),
    },
    FieldValue: { delete: () => '__delete__', serverTimestamp: () => '__server_time__' },
  };
});
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'owner', emailVerified: true } }) }));
vi.mock('@/lib/plaid/connections', () => ({ migrateLegacyPlaidConnection: async () => undefined }));
vi.mock('firebase/firestore', () => ({
  doc: () => ({ path: pathFor() }),
  getDoc: async () => ({
    id: 'owner',
    exists: () => store.docs.has(pathFor()),
    data: () => ({ ...store.docs.get(pathFor()) }),
  }),
  serverTimestamp: () => 'synthetic-server-timestamp',
}));
vi.mock('@/lib/firebase/client', () => ({ db: 'synthetic-database' }));
vi.mock('@/lib/firebase/auth', () => ({ waitForAuth: async () => 'owner' }));
vi.mock('@/lib/firebase/api-client', () => ({
  makeAuthenticatedRequest: async () => Response.json({ success: true }),
}));

import { POST } from '../app/api/database/profiles/route';
import { getUserProfile, getUserProfileSafe } from '../lib/firebase/profiles';
import { getUserProfileServer } from '../lib/firebase/profiles-server';

const request = (body: unknown) => new NextRequest('https://writeoff.test/api/database/profiles', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const oldSettingsPayload = {
  email: 'owner@example.test',
  name: 'Cached Name',
  profession: 'Consultant',
  business_entity_type: 'sole_prop',
  state: 'CA',
  filing_status: 'single',
  income: '100000',
  mailing_address: { street: '1 Main', city: 'Oakland', state: 'CA', zip: '94607' },
  business_purpose: 'Design',
  business_start_date: '2020-01-01',
  ein: '',
  w2_income: 100000,
  business_income: 0,
  naics_code: '541430',
  home_office_sqft: 120,
  total_home_sqft: 1000,
  home_office_method: 'simplified',
  vehicle_business_use_percentage: 0,
  vehicle_deduction_method: 'standard_mileage',
  itemization_status: 'itemized',
  health_insurance_premiums: 0,
  sep_ira_contribution: 0,
  solo_401k_contribution: 0,
  hsa_contribution: 0,
  simple_ira_contribution: 0,
  w2_federal_withheld: 8000,
  audit_history: 'none',
  tax_professional: 'no',
  documentation_habits: 'receipts',
  business_seasonality: 'year_round',
  multiple_locations: false,
  international_business: false,
  tax_bracket: 22,
  prior_year_tax: 9000,
  professional_licenses: [] as string[],
  prior_year_deductions: [] as string[],
};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  store.docs.clear();
  store.docs.set(pathFor(), { name: 'Owner', itemization_status: 'standard', itemized: true, prior_year_tax: 1000 });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('profile route deduction choice guard', () => {
  it('stores the current spelling for both accepted choices and keeps standard and blank', async () => {
    expect((await POST(request({ itemization_status: 'itemized' }))).status).toBe(200);
    expect(store.docs.get(pathFor())!.itemization_status).toBe('itemize');
    expect((await POST(request({ itemization_status: 'itemize' }))).status).toBe(200);
    expect(store.docs.get(pathFor())!.itemization_status).toBe('itemize');
    expect((await POST(request({ itemization_status: 'standard' }))).status).toBe(200);
    expect(store.docs.get(pathFor())!.itemization_status).toBe('standard');
    expect((await POST(request({ itemization_status: '' }))).status).toBe(200);
    expect(store.docs.get(pathFor())!.itemization_status).toBe('');
  });

  it('saves the rest of the profile when the choice is not a known spelling', async () => {
    const response = await POST(request({ name: 'New', itemization_status: 'Itemized' }));
    expect(response.status).toBe(200);
    expect(store.docs.get(pathFor())!.name).toBe('New');
    expect(store.docs.get(pathFor())!.itemization_status).toBe('standard');
  });

  it('stores the current spelling when an old settings payload sends the legacy spelling', async () => {
    store.docs.set(pathFor(), {
      name: 'Owner',
      itemization_status: 'itemize',
      itemized: true,
      prior_year_tax: 9000,
    });
    expect(Object.keys(oldSettingsPayload)).toHaveLength(36);
    const response = await POST(request(oldSettingsPayload));
    expect(response.status).toBe(200);
    const stored = store.docs.get(pathFor())!;
    expect(stored.itemization_status).toBe('itemize');
    expect(stored.itemized).toBe(true);
    expect(stored.name).toBe('Cached Name');
    expect(stored.w2_income).toBe(100000);
    expect(stored.prior_year_tax).toBe(9000);
    expect((await getUserProfileServer('owner')).data?.itemization_status).toBe('itemize');
    expect((await getUserProfile('owner')).data?.itemization_status).toBe('itemize');
    expect((await getUserProfileSafe()).data?.itemization_status).toBe('itemize');
  });
});
