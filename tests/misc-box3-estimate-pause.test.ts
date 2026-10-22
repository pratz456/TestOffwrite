import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';

// Real import, compute-1040, 1099 DELETE, and data export. Auth, Firestore, OCR,
// and the model are synthetic. Tax math is not mocked.
const state = vi.hoisted(() => {
  type Stored = { id: string; path: string; data: Record<string, unknown> };
  const docs: Stored[] = [];
  let seq = 0;
  const snapshot = (doc: Stored) => ({
    id: doc.id,
    exists: true,
    ref: { path: doc.path },
    data: () => ({ ...doc.data }),
  });
  function collection(path: string) {
    const filters: [string, unknown][] = [];
    const api = {
      where(field: string, _op: string, value: unknown) {
        filters.push([field, value]);
        return api;
      },
      limit() { return api; },
      doc(id: string) {
        const docPath = `${path}/${id}`;
        return {
          id,
          get: async () => {
            const found = docs.find(doc => doc.path === docPath);
            return found ? snapshot(found) : { id, exists: false, ref: { path: docPath }, data: () => undefined };
          },
          delete: async () => {
            const index = docs.findIndex(doc => doc.path === docPath);
            if (index >= 0) docs.splice(index, 1);
          },
          set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
            const found = docs.find(doc => doc.path === docPath);
            if (found && options?.merge) Object.assign(found.data, data);
            else if (found) found.data = { ...data };
            else docs.push({ id, path: docPath, data: { ...data } });
          },
          collection: (child: string) => collection(`${docPath}/${child}`),
        };
      },
      add: async (data: Record<string, unknown>) => {
        const id = `synthetic-${++seq}`;
        docs.push({ id, path: `${path}/${id}`, data: { ...data } });
        return { id };
      },
      async get() {
        const depth = path.split('/').length + 1;
        const matching = docs.filter(doc => doc.path.split('/').length === depth && doc.path.startsWith(`${path}/`) && filters.every(([field, value]) => doc.data[field] === value));
        const mapped = matching.map(snapshot);
        return { empty: mapped.length === 0, docs: mapped, forEach: (fn: (doc: ReturnType<typeof snapshot>) => void) => mapped.forEach(fn) };
      },
      count() {
        return { get: async () => ({ data: () => ({ count: docs.filter(doc => doc.path.startsWith(`${path}/`) && doc.path.split('/').length === path.split('/').length + 1).length }) }) };
      },
    };
    return api;
  }
  function collectionGroup(name: string) {
    return {
      where(field: string, _op: string, value: unknown) {
        return {
          get: async () => ({
            docs: docs.filter(doc => {
              const parts = doc.path.split('/');
              return parts[parts.length - 2] === name && doc.data[field] === value;
            }).map(snapshot),
          }),
        };
      },
    };
  }
  return {
    docs,
    reset() { docs.length = 0; seq = 0; },
    seed(path: string, data: Record<string, unknown>) {
      docs.push({ id: path.split('/').pop()!, path, data });
    },
    adminDb: { collection, collectionGroup },
  };
});

const mocks = vi.hoisted(() => ({ create: vi.fn(), recognize: vi.fn() }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'import-owner' }, error: null }) }));
vi.mock('@/lib/openai/client', () => ({ getOpenAIModel: () => 'gpt-4o', getOpenAIClientOrThrow: () => ({ chat: { completions: { create: mocks.create } } }) }));
vi.mock('@/lib/ocr/document-text', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/ocr/document-text')>(), recognizeDocumentText: mocks.recognize }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: state.adminDb }));

import { resetRateLimitStore } from './fixtures/rate-limit-store';
import { POST as importDocument } from '../app/api/tax/import-document/route';
import { GET as compute1040 } from '../app/api/tax/compute-1040/route';
import { DELETE as delete1099 } from '../app/api/income/1099/route';
import { generateUserDataExport } from '../lib/reports/data-export';
import { encryptSensitive } from '../lib/security/utils';
import { CONSENT_TERMS_VERSION } from '../lib/onboarding/consents';

const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...Array.from({ length: 64 }, () => 1)]);
const OCR = "PAYER'S TIN 98-7654321\n1099-MISC\nPaid for services rendered this year\n1 Wages, tips, other compensation 1500.00";

beforeEach(() => {
  resetRateLimitStore();
  state.reset();
  mocks.create.mockReset();
  mocks.recognize.mockReset();
  state.seed('user_profiles/import-owner', {
    name: 'Jordan Demo',
    filing_status: 'single',
    consents: { version: CONSENT_TERMS_VERSION, source: 'sign-up', accepted_at: '2026-09-17T12:00:00.000Z', terms: true, bank_data: true, ai_review: true, communications: false, document_import: false },
  });
  state.seed('tax_organizers/organizer-2025', {
    ...reviewedPersonalDeductionOrganizer(2025),
    userId: 'import-owner',
    taxYear: 2025,
    taxpayerSSN: encryptSensitive('123456789'),
  });
  state.seed('income_1099/other-owner-misc', { userId: 'other-owner', taxYear: 2025, amount: 1500, box3OtherIncome: 1500, formType: '1099-MISC', payer: 'Someone else' });
  mocks.recognize.mockResolvedValue({ text: OCR, confidence: 0.95 });
  mocks.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
    docType: 'w2', employerName: 'Synthetic Payer', employerEIN: null, box1Wages: 1500, box2FederalWithheld: 80,
    box3SocialSecurityWages: 1500, box4SocialSecurityWithheld: 74, box5MedicareWages: 1500, box6MedicareWithheld: 17,
    taxYear: 2025, confidence: 0.95, verificationWarnings: [],
  }) } }] });
});

describe('a confirmed 1099-MISC box 3 pauses the estimate until that record is removed', () => {
  it('saves box 3, blocks compute-1040, refuses another owner, then allows the estimate after delete', async () => {
    const form = new FormData();
    form.set('file', new Blob([IMAGE_BYTES], { type: 'image/png' }), 'synthetic.png');
    form.set('docType', 'w2');
    form.set('taxYear', '2025');
    form.set('commit', 'true');
    form.set('confirmedDocType', '1099');
    form.set('confirmedMiscBox', '3');
    const imported = await importDocument(new NextRequest('http://localhost/api/tax/import-document', { method: 'POST', body: form }));
    expect(imported.status).toBe(200);
    const saved = await imported.json();
    const savedId = saved.saveResult.id as string;
    const stored = state.docs.find(doc => doc.path === `income_1099/${savedId}`)?.data;
    expect(stored).toMatchObject({ amount: 1500, box3OtherIncome: 1500, box4FederalWithheld: 80, formType: '1099-MISC', userId: 'import-owner' });
    expect(stored).not.toHaveProperty('box1Amount');

    const exported = await generateUserDataExport('import-owner', 2025);
    const row = exported.taxRecords.income_1099.find(record => record.id === savedId);
    expect(row).toMatchObject({ amount: 1500, box3OtherIncome: 1500, box4FederalWithheld: 80 });
    expect(row?.amount).not.toBe(3000);

    const blocked = await compute1040(new NextRequest('http://localhost/api/tax/compute-1040?year=2025'));
    expect(blocked.status).toBe(422);
    expect(await blocked.json()).toMatchObject({ code: 'INCOME_RECONCILIATION_REQUIRED' });

    const refused = await delete1099(new NextRequest('http://localhost/api/income/1099?id=other-owner-misc', { method: 'DELETE' }));
    expect(refused.status).toBe(403);
    expect(state.docs.some(doc => doc.path === 'income_1099/other-owner-misc')).toBe(true);

    const removed = await delete1099(new NextRequest(`http://localhost/api/income/1099?id=${savedId}`, { method: 'DELETE' }));
    expect(removed.status).toBe(200);
    expect(state.docs.some(doc => doc.path === `income_1099/${savedId}`)).toBe(false);
    expect(state.docs.some(doc => doc.path === 'income_1099/other-owner-misc')).toBe(true);

    const open = await compute1040(new NextRequest('http://localhost/api/tax/compute-1040?year=2025'));
    expect(open.status).toBe(200);
    const body = await open.json();
    expect(body.income.grossReceipts).toBe(0);
    expect(body.form1040.totalIncome).toBe(0);
  });
});
