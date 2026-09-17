import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFPage } from 'pdf-lib';
import { profileWriteData } from '../lib/onboarding/profile';

// Real save and tax route handlers, shared in-memory Firestore transport.
// Authentication, persistence and subscriptions are mocked; no live records/providers.
const state = vi.hoisted(() => ({ filingStatus: 'single' as unknown, records: {} as Record<string, Record<string, unknown>[]>, transactions: [] as Record<string, unknown>[], computedInputs: [] as Record<string, unknown>[], computedResults: [] as Record<string, unknown>[] }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'w2-contract-user' }, error: null }) }));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: async () => ({ uid: 'w2-contract-user' }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/reports/export-records', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/reports/export-records')>(), readOwnedTransactions: async () => state.transactions }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async () => ({ data: state.transactions, error: null }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: { filing_status: state.filingStatus, w2_federal_withheld: 99999 }, error: null }) }));
vi.mock('@/lib/firebase/settings-server', () => ({ getAssetsSettings: async () => ({ data: [], error: null }) }));
vi.mock('@/lib/firebase/quarterly-payments-server', () => ({ getRecordedQuarterlyPayments: async () => [], totalRecordedPayments: () => 0 }));
vi.mock('@/lib/tax-rules/compute-1040', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/tax-rules/compute-1040')>();
  return { ...actual, compute1040: (input: Parameters<typeof actual.compute1040>[0], prior?: number) => {
    state.computedInputs.push(input as unknown as Record<string, unknown>);
    const result = actual.compute1040(input, prior);
    state.computedResults.push(result as unknown as Record<string, unknown>);
    return result;
  } };
});
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => {
  const filters: [string, unknown][] = [];
  return {
    where(field: string, _operator: string, value: unknown) { filters.push([field, value]); return this; },
    limit() { return this; },
    add: async (data: Record<string, unknown>) => {
      (state.records[name] ??= []).push(data);
      return { id: `synthetic-${state.records[name].length}` };
    },
    get: async () => {
      const matching = (state.records[name] || []).filter(record => filters.every(([field, value]) => record[field] === value));
      return { empty: matching.length === 0, docs: matching.map((data, index) => ({ id: `synthetic-${index + 1}`, data: () => data })) };
    },
  };
} } }));
vi.mock('@/lib/openai/client', () => ({ getOpenAIModel: () => 'gpt-4o', getOpenAIClientOrThrow: () => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({ docType: 'platform_summary', taxYear: 2026, platform: 'Synthetic platform', grossEarnings: 100000, form1099KAmount: 100000, confidence: 1 }) } }] }) } } }) }));

import { POST as saveW2 } from '../app/api/income/w2/route';
import { GET as compute1040 } from '../app/api/tax/compute-1040/route';
import { POST as export1040 } from '../app/api/tax/form-1040/route';
import { GET as scheduleSE } from '../app/api/tax/schedule-se/auto/route';
import { GET as reminders } from '../app/api/tax/quarterly-reminders/route';
import { POST as importDocument } from '../app/api/tax/import-document/route';
import { POST as quarterlyEstimate } from '../app/api/tax/quarterly-estimates/route';
import { summarizeW2Income } from '../lib/tax-rules/w2-income';

const organizerFixture = (overrides: Record<string, unknown> = {}) => reviewedPersonalDeductionOrganizer(2026, {}, { userId: 'w2-contract-user', ...overrides });
const fixture = { employer: 'Synthetic employer', taxYear: 2026, wages: 200000, federalWithheld: 35000, socialSecurityWages: 184500, medicareWages: 210000, stateWithheld: 5000 };
const request = (path: string) => new NextRequest(`http://localhost${path}?year=2026`);
beforeEach(() => {
  state.filingStatus = 'single';
  state.records = { tax_organizers: [organizerFixture()], gross_receipts: [{ userId: 'w2-contract-user', taxYear: 2026, amount: 100000 }] };
  state.computedInputs = [];
  state.computedResults = [];
  state.transactions = [];
});

describe('onboarding filing-status labels flow into tax calculations and PDF selection', () => {
  const labels = [
    ['Single', 'single', 16100],
    ['Married Filing Jointly', 'married_filing_jointly', 32200],
    ['Married Filing Separately', 'married_filing_separately', 16100],
    ['Head of Household', 'head_of_household', 24150],
  ] as const;
  const pdfRequest = () => new NextRequest('http://localhost/api/tax/form-1040', { method: 'POST', body: JSON.stringify({ year: 2026 }) });
  const quarterlyRequest = () => new NextRequest('http://localhost/api/tax/quarterly-estimates', { method: 'POST', body: JSON.stringify({ userProfile: { filing_status: state.filingStatus }, transactions: [] }) });

  it.each(labels)('accepts the actual onboarding save contract for %s and selects its PDF checkbox', async (label, canonical, deduction) => {
    const storedProfile = profileWriteData({ email: 'synthetic@example.test', name: 'Synthetic Taxpayer', profession: ['Consultant'], businessEntityType: 'Sole Proprietor', primaryWorkLocation: 'Home', workRelatedTravelPattern: '', income: '$100,000', state: 'TX', filingStatus: label }, true);
    state.filingStatus = storedProfile.filing_status;
    await save();
    const preview = await compute1040(request('/api/tax/compute-1040'));
    expect(preview.status).toBe(200);
    const body = await preview.json();
    expect(body.filingStatus).toBe(canonical);
    expect(body.form1040.standardDeduction).toBe(deduction);
    const drawText = vi.spyOn(PDFPage.prototype, 'drawText');
    try {
      expect((await export1040(pdfRequest())).status).toBe(200);
      expect(state.computedInputs[0].filingStatus).toBe(canonical);
      expect(state.computedInputs[1]).toEqual(state.computedInputs[0]);
      expect(state.computedResults[1]).toEqual(state.computedResults[0]);
      const statusIndex = labels.findIndex(([, key]) => key === canonical);
      const selectedCheckbox = drawText.mock.calls.filter(([text, options]) => text === 'X' && options?.size === 5.5);
      expect(selectedCheckbox).toHaveLength(1);
      expect(selectedCheckbox[0][1]?.x).toBe(127.5 + statusIndex * 120);
      expect(drawText.mock.calls.some(([text]) => text.startsWith('At any time in 2026,'))).toBe(true);
      expect(drawText.mock.calls.some(([text]) => text.startsWith('At any time in 2025,'))).toBe(false);
    } finally { drawText.mockRestore(); }
    const se = await scheduleSE(request('/api/tax/schedule-se/auto'));
    expect(se.status).toBe(200);
    expect((await se.json()).calculation.additionalMedicareTax).toBe(canonical === 'married_filing_jointly' ? 471.15 : 831.15);
    const reminderResponse = await reminders(request('/api/tax/quarterly-reminders'));
    expect(reminderResponse.status).toBe(200);
    expect((await reminderResponse.json()).filingStatus).toBe(canonical);
    expect((await quarterlyEstimate(quarterlyRequest())).status).toBe(200);
  });

  it.each(['Qualifying Widower', 'unrecognized status', 42])('returns actionable validation for %s in every tax route, before calculating', async status => {
    state.filingStatus = status;
    for (const response of [
      await compute1040(request('/api/tax/compute-1040')), await export1040(pdfRequest()),
      await scheduleSE(request('/api/tax/schedule-se/auto')), await reminders(request('/api/tax/quarterly-reminders')),
      await quarterlyEstimate(quarterlyRequest()),
    ]) {
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.code).toBe('FILING_STATUS_REVIEW_REQUIRED');
      expect(body.error).toContain('filing status in Profile');
      expect(body.error).toContain('No tax total has been calculated');
    }
    expect(state.computedInputs).toHaveLength(0);
  });
});

describe('shared income snapshot across JSON and PDF', () => {
  const transaction = { id: 'income-1', account_id: 'manual', amount: -100000, category: 'income', type: 'income', date: '2026-03-01', pending: false };
  const pdfRequest = () => new NextRequest('http://localhost/api/tax/form-1040', { method: 'POST', body: JSON.stringify({ year: 2026 }) });

  it('counts transaction-only business income and uses identical federal inputs/results in JSON and PDF', async () => {
    state.records = { tax_organizers: [organizerFixture({ amount1099INT: '1200', dependents: '0' })] };
    state.transactions = [transaction];
    const json = await (await compute1040(request('/api/tax/compute-1040'))).json();
    expect(json.income.grossReceipts).toBe(100000);
    expect(json.form1040.totalIncome).toBe(101200);
    expect(json.form1040.childTaxCredit).toBe(0);
    expect((await export1040(pdfRequest())).status).toBe(200);
    expect(state.computedInputs[1]).toEqual(state.computedInputs[0]);
    expect(state.computedResults[1]).toEqual(state.computedResults[0]);
    expect(state.computedResults[1]).toMatchObject(json.form1040);
  });

  it('preserves the generic-dependent review gate in both JSON and PDF', async () => {
    state.records.tax_organizers = [organizerFixture({ dependents: '1' })];
    for (const response of [await compute1040(request('/api/tax/compute-1040')), await export1040(pdfRequest())]) {
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.code).toBe('DEPENDENT_CREDIT_REVIEW_REQUIRED');
      expect(body).not.toHaveProperty('form1040');
    }
    expect(state.computedInputs).toHaveLength(0);
  });

  it('links the actual platform importer’s paired 1099 and receipt and counts that income once', async () => {
    state.records = { tax_organizers: [organizerFixture()] };
    const form = new FormData();
    form.set('file', new Blob(['synthetic-image'], { type: 'image/png' }), 'synthetic.png');
    form.set('docType', 'platform_summary'); form.set('taxYear', '2026'); form.set('commit', 'true');
    expect((await importDocument(new NextRequest('http://localhost/api/tax/import-document', { method: 'POST', body: form }))).status).toBe(200);
    expect(state.records.income_1099[0].grossReceiptId).toBe('synthetic-1');
    const json = await (await compute1040(request('/api/tax/compute-1040'))).json();
    expect(json.income.grossReceipts).toBe(100000);
    expect(json.incomeReconciliation.linkedDocumentCount).toBe(1);
    expect((await export1040(pdfRequest())).status).toBe(200);
    expect(state.computedResults[1]).toEqual(state.computedResults[0]);
  });

  it('returns the same actionable422 for unlinked receipt/1099 overlap instead of guessing a total', async () => {
    state.records.income_1099 = [{ userId: 'w2-contract-user', taxYear: 2026, formType: '1099-K', payer: 'Synthetic platform', amount: 100000 }];
    const json = await compute1040(request('/api/tax/compute-1040'));
    const pdf = await export1040(pdfRequest());
    expect(json.status).toBe(422); expect(pdf.status).toBe(422);
    const body = await json.json();
    expect(body.code).toBe('INCOME_RECONCILIATION_REQUIRED');
    expect(body.error).toContain('Review income sources');
    expect(await pdf.json()).toEqual(body);
    expect(state.computedInputs).toHaveLength(0);
  });

  it.each([scheduleSE, reminders])('uses transaction-only business receipts in the ancillary tax route', async route => {
    state.records = { tax_organizers: [organizerFixture()] }; state.transactions = [transaction];
    const response = await route(request('/api/tax/fixture'));
    expect(response.status).toBe(200);
    expect((await response.json()).grossReceipts).toBe(100000);
  });
});
async function save(fields = {}) {
  const response = await saveW2(new NextRequest('http://localhost/api/income/w2', { method: 'POST', body: JSON.stringify({ ...fixture, ...fields }) }));
  expect(response.status).toBe(201);
  expect(state.records.w2_income[0]).toMatchObject({ userId: 'w2-contract-user', wages: 200000 });
  expect(state.records.w2_income[0]).not.toHaveProperty('box3SocialSecurityWages');
}

describe('saved manual W-2 flows into real tax calculations', () => {
  // IRS Pub 505 (2026), Worksheet 2-3: $184,500 SS base minus $184,500 W-2 SS
  // wages leaves $0. $100,000 profit * .9235 * .029 = $2,678.15 regular SE tax.
  // Form 8959: ($210,000 Medicare wages + $92,350 net SE - $200,000) * .009.
  it('POST W-2 → 1040 honors Boxes 3 and 5, including wages that differ from Box 1', async () => {
    await save();
    const response = await compute1040(request('/api/tax/compute-1040'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.seCalc).toMatchObject({ socialSecurityTax: 0, medicareTax: 2678.15, totalSETax: 2678.15, halfSEDeduction: 1339.08 });
    expect(data.form1040.additionalMedicareTax).toBe(921.15);
    expect(data.w2).toMatchObject({ wages: 200000, withheld: 35000 });
    expect(data.form1040.calculationWarnings.some((warning: string) => warning.includes('Box 5'))).toBe(false);
  });

  it.each([['Schedule SE', scheduleSE, 'calculation'], ['quarterly reminders', reminders, 'seCalc']] as const)('POST W-2 → %s uses the same saved wage amounts', async (_label, route, key) => {
    await save();
    const response = await route(request('/api/tax/fixture'));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data[key]).toMatchObject({ socialSecurityTax: 0, totalSETax: 2678.15, additionalMedicareTax: 92350 * .009 });
    expect(data.w2Wages).toBe(200000);
    expect(data.w2Withheld).toBe(35000);
  });

  it('POST W-2 → actual Form1040 PDF calculation receives the same normalized amounts once', async () => {
    await save();
    const response = await export1040(new NextRequest('http://localhost/api/tax/form-1040', { method: 'POST', body: JSON.stringify({ year: 2026 }) }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(state.computedInputs.at(-1)).toMatchObject({ w2Wages: 200000, w2MedicareWages: 210000, w2FederalWithheld: 35000, selfEmploymentTax: 2678.15, halfSEDeduction: 1339.08 });
  });

  it('keeps explicit zero SS/Medicare wages instead of replacing them with Box 1', async () => {
    await save({ socialSecurityWages: 0, medicareWages: 0 });
    const data = await (await compute1040(request('/api/tax/compute-1040'))).json();
    expect(data.seCalc.socialSecurityTax).toBe(11451.4);
    expect(data.form1040.additionalMedicareTax).toBe(0);
  });

  it('retains imported box-prefixed W-2 compatibility and tax-year ownership filtering', async () => {
    state.records.w2_income = [
      { userId: 'w2-contract-user', taxYear: 2026, box1Wages: 200000, box2FederalWithheld: 35000, box3SocialSecurityWages: 184500, box5MedicareWages: 210000 },
      { userId: 'other-owner', taxYear: 2026, wages: 900000 },
      { userId: 'w2-contract-user', taxYear: 2025, wages: 800000 },
    ];
    const data = await (await compute1040(request('/api/tax/compute-1040'))).json();
    expect(data.seCalc.totalSETax).toBe(2678.15);
    expect(data.w2).toMatchObject({ wages: 200000, withheld: 35000, count: 1 });
  });
});

describe('W-2 legacy normalization', () => {
  it('preserves explicit imported zero and flags missing legacy Medicare information', () => {
    expect(summarizeW2Income([{ box1Wages: 0, wages: 10000, box3SocialSecurityWages: 0 }])).toMatchObject({ wages: 0, socialSecurityWages: 0, medicareWages: undefined });
    expect(summarizeW2Income([{ wages: 10000 }])).toMatchObject({ socialSecurityWages: 10000, medicareWages: undefined, medicareWagesForSE: 10000 });
  });
  it.each([NaN, Infinity, -1, '10000'])('does not silently calculate from a malformed persisted wage %s', wages => {
    expect(() => summarizeW2Income([{ wages }])).toThrow(RangeError);
  });
});
