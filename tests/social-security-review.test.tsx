import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import type { ReactElement } from 'react';

// Real organizer persistence handler, federal snapshot, calculation and PDF
// route. Only auth, entitlement and Firestore transport are synthetic.
const state = vi.hoisted(() => ({
  records: {} as Record<string, Record<string, unknown>[]>,
  profile: { filing_status: 'single' } as Record<string, unknown>,
  calculations: [] as Record<string, unknown>[],
}));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'benefits-owner' } }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionsServer: async () => ({ data: [], error: null }) }));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: state.profile, error: null }) }));
vi.mock('@/lib/firebase/settings-server', () => ({ getAssetsSettings: async () => ({ data: [], error: null }) }));
vi.mock('@/lib/firebase/quarterly-payments-server', () => ({ getRecordedQuarterlyPayments: async () => [], totalRecordedPayments: () => 0 }));
vi.mock('@/lib/tax-rules/compute-1040', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/tax-rules/compute-1040')>();
  return { ...actual, compute1040: (...args: Parameters<typeof actual.compute1040>) => {
    const result = actual.compute1040(...args);
    state.calculations.push(result as unknown as Record<string, unknown>);
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
      const records = (state.records[name] || []).filter(record => filters.every(([field, value]) => record[field] === value));
      return { empty: !records.length, docs: records.map((record, i) => ({
        id: `synthetic-${i + 1}`, data: () => ({ ...record }),
        ref: { set: async (data: Record<string, unknown>) => { Object.assign(record, data); } },
      })) };
    },
  };
} } }));

import { POST as saveOrganizer, GET as getOrganizer } from '../app/api/tax/organizer/route';
import { GET as getEstimate } from '../app/api/tax/compute-1040/route';
import { POST as exportPdf } from '../app/api/tax/form-1040/route';
import { assertSocialSecurityBenefitsSupported, SocialSecurityReviewRequiredError } from '../lib/tax-rules/social-security';
import { KpiGrid } from '../components/dashboard/KpiGrid';

const jsonRequest = (year = 2026) => new NextRequest(`http://localhost/api/tax/compute-1040?year=${year}`);
const pdfRequest = (year = 2026) => new NextRequest('http://localhost/api/tax/form-1040', { method: 'POST', body: JSON.stringify({ year }) });
async function save(answers: Record<string, string>, taxYear = 2026) {
  const response = await saveOrganizer(new NextRequest('http://localhost/api/tax/organizer', { method: 'POST', body: JSON.stringify({ ...answers, taxYear }) }));
  expect(response.status).toBe(201);
}
beforeEach(() => { vi.restoreAllMocks(); state.records = {}; state.profile = { filing_status: 'single' }; state.calculations = []; });

describe('Social Security requires the missing IRS facts', () => {
  it.each([2024, 2025, 2026])('withholds JSON and PDF for a saved $20,000-only benefits organizer in %s', async year => {
    // With complete ordinary-case facts and no other income, $20,000 of net
    // benefits would be below the IRS single base amount. Legacy Box 3 alone
    // cannot establish those facts, and must never be converted to $17,000.
    await save({ hasSocialSecurity: 'yes', amountSocialSecurity: '20000' }, year);
    const before = JSON.stringify(state.records);
    const createPdf = vi.spyOn(PDFDocument, 'create');
    const json = await getEstimate(jsonRequest(year));
    const pdf = await exportPdf(pdfRequest(year));
    expect(json.status).toBe(422); expect(pdf.status).toBe(422);
    const body = await json.json();
    expect(body).toEqual({ code: 'SOCIAL_SECURITY_REVIEW_REQUIRED', error: expect.stringContaining('Tax Organizer') });
    expect(body.error).toContain('Publication 915');
    expect(await pdf.json()).toEqual(body);
    expect(pdf.headers.get('content-type')).toContain('application/json');
    expect(state.calculations).toHaveLength(0);
    expect(createPdf).not.toHaveBeenCalled();
    expect(JSON.stringify(state.records)).toBe(before);
    const saved = await (await getOrganizer(new NextRequest(`http://localhost/api/tax/organizer?year=${year}`))).json();
    expect(saved.organizer).toMatchObject({ hasSocialSecurity: 'yes', amountSocialSecurity: '20000' });
  });

  it.each([
    { hasSocialSecurity: 'yes', amountSocialSecurity: '' },
    { hasSocialSecurity: 'yes', amountSocialSecurity: '0' },
    { amountSocialSecurity: '20000' },
    { hasSocialSecurity: 'no', amountSocialSecurity: '20000' },
    { hasSocialSecurity: 'no', amountSocialSecurity: '-1500' },
    { amountSocialSecurity: 'unknown' },
  ])('does not silently assume zero or 85%% for incomplete/legacy benefits %j', async answers => {
    await save(answers as Record<string, string>);
    for (const response of [await getEstimate(jsonRequest()), await exportPdf(pdfRequest())]) {
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.code).toBe('SOCIAL_SECURITY_REVIEW_REQUIRED');
      expect(body).not.toHaveProperty('form1040');
      expect(body).not.toHaveProperty('income');
    }
    expect(state.calculations).toHaveLength(0);
  });

  it.each(['single', 'married_filing_jointly', 'married_filing_separately', 'head_of_household'])('does not infer missing benefit facts from filing status %s or high wages', async filingStatus => {
    state.profile.filing_status = filingStatus;
    state.records.w2_income = [{ userId: 'benefits-owner', taxYear: 2026, wages: 100000 }];
    await save({ hasSocialSecurity: 'yes', amountSocialSecurity: '20000' });
    expect((await getEstimate(jsonRequest())).status).toBe(422);
    expect((await exportPdf(pdfRequest())).status).toBe(422);
    expect(state.calculations).toHaveLength(0);
  });

  it.each([{}, { hasSocialSecurity: 'no', amountSocialSecurity: '0.00' }, { hasSocialSecurity: '', amountSocialSecurity: '' }])('keeps the real no-benefits JSON/PDF calculation unchanged for %j', async answers => {
    await save(answers as Record<string, string>);
    state.records.w2_income = [{ userId: 'benefits-owner', taxYear: 2026, wages: 100000 }];
    const response = await getEstimate(jsonRequest()); expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.income.socialSecurity).toBe(0);
    expect(body.form1040).toMatchObject({ totalIncome: 100000, incomeTax: 13170 });
    const pdf = await exportPdf(pdfRequest());
    expect(pdf.status).toBe(200); expect(pdf.headers.get('content-type')).toContain('application/pdf');
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    expect(state.calculations).toHaveLength(2);
    expect(state.calculations[0]).toEqual(state.calculations[1]);
  });

  it('does not block the current owner/year for someone else’s or prior-year benefits', async () => {
    state.records.tax_organizers = [
      { userId: 'other-owner', taxYear: 2026, hasSocialSecurity: 'yes', amountSocialSecurity: '20000' },
      { userId: 'benefits-owner', taxYear: 2025, hasSocialSecurity: 'yes', amountSocialSecurity: '20000' },
    ];
    expect((await getEstimate(jsonRequest())).status).toBe(200);
    expect((await exportPdf(pdfRequest())).status).toBe(200);
  });

  it.each([{ amountSocialSecurity: NaN }, { amountSocialSecurity: Infinity }, { amountSocialSecurity: false }, { amountSocialSecurity: [] }, { amountSocialSecurity: '0x0' }, { hasSocialSecurity: 'unknown' }])('review-blocks malformed stored benefit facts %j', organizer => {
    expect(() => assertSocialSecurityBenefitsSupported(organizer)).toThrow(SocialSecurityReviewRequiredError);
  });

  it('offers the organizer review action without displaying a fabricated dashboard amount', () => {
    const onReview = vi.fn();
    const tree = KpiGrid({ taxYear: 2026, state: { status: 'review', code: 'SOCIAL_SECURITY_REVIEW_REQUIRED', message: new SocialSecurityReviewRequiredError().message }, onReview, onRetry() {} });
    type ReviewElement = ReactElement<{ children?: unknown; value?: unknown; onClick?: () => void }>;
    const walk = (node: unknown): ReviewElement[] => Array.isArray(node) ? node.flatMap(walk)
      : node && typeof node === 'object' && 'props' in node ? [node as ReviewElement, ...walk((node as ReviewElement).props.children)] : [];
    const nodes = walk(tree);
    expect(nodes.some(node => typeof node.props.value === 'string' && node.props.value.startsWith('$'))).toBe(false);
    nodes.find(node => node.type === 'button' && node.props.children === 'Review Social Security records')!.props.onClick!();
    expect(onReview).toHaveBeenCalledWith('tax-organizer');
  });
});
