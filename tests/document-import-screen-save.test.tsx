/**
 * The import screen's Save action, driven through the real component into
 * POST /api/tax/import-document. Auth, Firestore, OCR and the model are synthetic.
 * Every name, amount and identifier below is synthetic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { NextRequest } from 'next/server';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const state = vi.hoisted(() => ({
  records: {} as Record<string, Record<string, unknown>[]>,
  profile: null as Record<string, unknown> | null,
}));
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  recognize: vi.fn(),
}));
const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
}));

vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'import-owner' }, error: null }) }));
vi.mock('@/lib/openai/client', () => ({ getOpenAIModel: () => 'gpt-4o', getOpenAIClientOrThrow: () => ({ chat: { completions: { create: mocks.create } } }) }));
vi.mock('@/lib/ocr/document-text', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ocr/document-text')>(),
  recognizeDocumentText: mocks.recognize,
}));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: (name: string) => {
  const filters: [string, unknown][] = [];
  return {
    where(field: string, _operator: string, value: unknown) { filters.push([field, value]); return this; },
    limit() { return this; },
    doc: (id: string) => ({ get: async () => ({ exists: state.profile !== null && name === 'user_profiles' && id === 'import-owner', data: () => state.profile ?? undefined }) }),
    add: async (data: Record<string, unknown>) => { (state.records[name] ??= []).push(data); return { id: `synthetic-${state.records[name].length}` }; },
    get: async () => {
      const records = (state.records[name] || []).filter(record => filters.every(([field, value]) => record[field] === value));
      return { empty: !records.length, docs: records.map((record, i) => ({ id: `synthetic-${i + 1}`, data: () => ({ ...record }), ref: { set: async (data: Record<string, unknown>) => { Object.assign(record, data); } } })) };
    },
  };
} } }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useState(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [harness.slots[index], (next: unknown) => { harness.slots[index] = typeof next === 'function' ? (next as (prev: unknown) => unknown)(harness.slots[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = { current: initial };
      return harness.slots[index];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = harness.cursor++;
      const previous = harness.slots[index] as { deps: unknown[]; callback: unknown } | undefined;
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) harness.slots[index] = { deps, callback };
      return (harness.slots[index] as { callback: unknown }).callback;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = harness.cursor++;
      const previous = harness.slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        const next: { deps: unknown[]; cleanup?: () => void } = { deps };
        harness.slots[index] = next;
        harness.effects.push(() => { previous?.cleanup?.(); const cleanup = effect(); if (typeof cleanup === 'function') next.cleanup = cleanup; });
      }
    },
  };
  return { ...actual, ...hooks, default: { ...(actual as { default?: object }).default, ...hooks } };
});

import { DocumentImportScreen } from '@/components/document-import-screen';
import { POST as importDocument } from '../app/api/tax/import-document/route';

/** Box 12 as the preview model returns it: a list, not a plain scalar. Code D is an elective deferral. */
const BOX_12 = [{ code: 'D', amount: 1500 }];
/** Box 12 from the save-time read. The screen cannot send this list, so the stored record keeps it. */
const SECOND_READ_BOX_12 = [{ code: 'D', amount: 1800 }];
const W2_EXTRACTED = {
  docType: 'w2',
  employerName: 'Synthetic Employer LLC',
  employerEIN: '98-7654321',
  box1Wages: 65000,
  box2FederalWithheld: 7250.1,
  box3SocialSecurityWages: 65000,
  box4SocialSecurityWithheld: 4030,
  box5MedicareWages: 65000,
  box6MedicareWithheld: 942.5,
  box12Codes: BOX_12,
  box16StateWages: 65000,
  box17StateWithheld: 1800,
  state: 'TX',
  taxYear: 2025,
  confidence: 0.96,
  fieldConfidence: { box1Wages: 0.97, box2FederalWithheld: 0.95, box3SocialSecurityWages: 0.96, box5MedicareWages: 0.96 },
  imageQualityIssues: [],
  verificationWarnings: [],
};
const OCR_TEXT = 'Form W-2 Wage and Tax Statement 2025 Box 1 Wages 65000.00 Box 2 Federal income tax withheld 7250.10';
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...Array.from({ length: 64 }, () => 1)]);

type Element = ReactElement<Record<string, unknown>>;
type CommitCapture = { status: number; body: Record<string, unknown>; overrideFields: string };

let previewExtraction: Record<string, unknown> = W2_EXTRACTED;
let saveExtraction: Record<string, unknown> = W2_EXTRACTED;
let lastCommit: CommitCapture | null = null;

/** Plain scalars the screen is allowed to send. Lists and objects stay off the override. */
function plainFields(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

vi.mock('@/lib/firebase/api-client', () => ({
  makeAuthenticatedRequest: async (url: string, init?: RequestInit) => {
    if (String(url).includes('/api/database/profiles')) return jsonResponse({ profile: { consents: null } });
    const form = init?.body;
    if (!(form instanceof FormData)) return jsonResponse({ error: 'expected a document upload' }, 500);
    if (form.get('commit') !== 'true') {
      return jsonResponse({
        success: true,
        docType: previewExtraction.docType,
        taxYear: previewExtraction.taxYear,
        summary: 'W-2 from Synthetic Employer LLC: $65,000 wages, $7,250.1 withheld',
        disclosure: 'text',
        identifiersRedacted: 0,
        verificationRequired: [],
        imageIssues: [],
        extracted: previewExtraction,
      });
    }
    const overrideFields = String(form.get('overrideFields') ?? '');
    const response = await importDocument(new NextRequest('http://localhost/api/tax/import-document', { method: 'POST', body: form }));
    const body = await response.json() as Record<string, unknown>;
    lastCommit = { status: response.status, body, overrideFields };
    return jsonResponse(body, response.status);
  },
}));

const walk = (node: unknown): Element[] => Array.isArray(node) ? node.flatMap(walk)
  : isValidElement(node) ? [node as Element, ...walk((node as Element).props.children)] : [];
const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join('')
  : isValidElement(node) ? text((node as Element).props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';

function render() {
  harness.cursor = 0;
  return DocumentImportScreen({ user: { id: 'import-owner' }, onBack() {} }) as Element;
}
function control(tree: Element, label: string) {
  const matches = walk(tree).filter(node => typeof node.props.onClick === 'function' && text(node).includes(label));
  matches.sort((a, b) => text(a).length - text(b).length);
  if (!matches[0]) throw new Error(`No control labeled "${label}"`);
  return matches[0];
}

async function extractPreview(typeLabel: string) {
  control(render(), typeLabel).props.onClick();
  const input = walk(render()).find(node => node.props.type === 'file');
  if (!input) throw new Error('file input missing');
  input.props.onChange({ target: { files: [new File([PNG], 'synthetic-document.png', { type: 'image/png' })] } });
  await control(render(), 'Extract with AI').props.onClick();
}

async function clickSave() {
  const save = control(render(), 'Save Verified Data to WriteOff');
  expect(save.props.disabled).toBeFalsy();
  await save.props.onClick();
  if (!lastCommit) throw new Error('Save did not reach POST /api/tax/import-document');
  return lastCommit;
}

async function reviewW2() {
  await extractPreview('W-2 Form');
  return clickSave();
}

const FORM_1099 = {
  docType: '1099', formVariant: 'NEC', payerName: 'Synthetic Payer', payerEIN: '12-3456789',
  box1Amount: 12000, box4FederalWithheld: 500, grossAmount: 12000, taxYear: 2025, confidence: 0.95,
};
const PLATFORM = {
  docType: 'platform_summary', platform: 'Synthetic Rides', taxYear: 2025, grossEarnings: 22000,
  platformFees: 4000, netEarnings: 18000, milesDriven: 1200, form1099KAmount: 22000,
  breakdown: { baseEarnings: 20000, tips: 2000 }, confidence: 0.94,
};

beforeEach(() => {
  harness.slots = []; harness.cursor = 0; harness.effects = [];
  state.records = {}; state.profile = null;
  lastCommit = null;
  previewExtraction = W2_EXTRACTED;
  saveExtraction = W2_EXTRACTED;
  resetRateLimitStore();
  mocks.create.mockReset(); mocks.recognize.mockReset();
  mocks.recognize.mockResolvedValue({ text: OCR_TEXT, confidence: 0.93 });
  mocks.create.mockImplementation(async () => ({ choices: [{ message: { content: JSON.stringify(saveExtraction) } }] }));
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:synthetic-w2' });
  }
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('document import screen save', () => {
  it('saves an unedited W-2 preview that includes box 12 entries and keeps the previewed wages', async () => {
    saveExtraction = { ...W2_EXTRACTED, box1Wages: 11111, box12Codes: SECOND_READ_BOX_12 };
    const commit = await reviewW2();
    const sentBox12 = commit.overrideFields.includes('"box12Codes"');
    expect(commit.status, `save response ${commit.status}: ${JSON.stringify(commit.body)} (override included box12 list: ${sentBox12})`).toBe(200);
    expect(JSON.parse(commit.overrideFields)).toEqual(plainFields(W2_EXTRACTED));
    expect(state.records.w2_income).toHaveLength(1);
    expect(state.records.w2_income[0].box1Wages).toBe(65000);
    expect(state.records.w2_income[0].wages).toBe(65000);
    // Known limits: Box 12 entries are saved from a second read of the document at save time, not from the preview. A follow-up will save the exact preview the user reviewed.
    expect(state.records.w2_income[0].box12Codes).toEqual(SECOND_READ_BOX_12);
    expect(text(render())).toContain('W-2 wages and withholding added to your return');
  });

  it('sends every plain preview field when box 1 is edited and saves that value with the model box 12 entries', async () => {
    await extractPreview('W-2 Form');
    const wages = walk(render()).find(node => node.props.def?.key === 'box1Wages');
    expect(wages).toBeTruthy();
    wages!.props.onEdit('box1Wages', '70000');
    const commit = await clickSave();
    expect(commit.status).toBe(200);
    expect(JSON.parse(commit.overrideFields)).toEqual({ ...plainFields(W2_EXTRACTED), box1Wages: 70000 });
    expect(state.records.w2_income[0]).toMatchObject({ box1Wages: 70000, wages: 70000, box12Codes: BOX_12 });
  });

  it('sends the previewed box 1 wages after an edit is typed back to the original', async () => {
    saveExtraction = { ...W2_EXTRACTED, box1Wages: 11111 };
    await extractPreview('W-2 Form');
    const wages = walk(render()).find(node => node.props.def?.key === 'box1Wages');
    expect(wages).toBeTruthy();
    wages!.props.onEdit('box1Wages', '70000');
    wages!.props.onEdit('box1Wages', '65000');
    const commit = await clickSave();
    expect(commit.status).toBe(200);
    const sent = JSON.parse(commit.overrideFields);
    expect(sent.box1Wages).toBe(65000);
    expect(sent).toEqual(plainFields(W2_EXTRACTED));
    expect(state.records.w2_income[0]).toMatchObject({ box1Wages: 65000, wages: 65000 });
  });

  it('still returns 400 when a crafted request overrides a field with a non-plain value', async () => {
    const form = new FormData();
    form.set('file', new Blob([PNG], { type: 'image/png' }), 'synthetic.png');
    form.set('docType', 'w2');
    form.set('taxYear', '2025');
    form.set('commit', 'true');
    form.set('overrideFields', JSON.stringify({ box12Codes: BOX_12 }));
    const response = await importDocument(new NextRequest('http://localhost/api/tax/import-document', { method: 'POST', body: form }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'overrideFields must be a small JSON object of edited values' });
    expect(state.records.w2_income).toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('saves a 1099 from the import screen', async () => {
    previewExtraction = FORM_1099;
    saveExtraction = FORM_1099;
    await extractPreview('1099 Form');
    const commit = await clickSave();
    expect(commit.status).toBe(200);
    expect(JSON.parse(commit.overrideFields)).toEqual(plainFields(FORM_1099));
    expect(state.records.income_1099).toHaveLength(1);
    expect(state.records.income_1099[0]).toMatchObject({ amount: 12000, box1Amount: 12000, source: 'document_import' });
    expect(text(render())).toContain('1099 income added to your return');
  });

  it('saves a platform summary from the import screen and keeps its breakdown', async () => {
    previewExtraction = PLATFORM;
    saveExtraction = PLATFORM;
    await extractPreview('Platform Summary');
    const commit = await clickSave();
    expect(commit.status).toBe(200);
    expect(JSON.parse(commit.overrideFields)).toEqual(plainFields(PLATFORM));
    expect(state.records.gross_receipts).toHaveLength(1);
    expect(state.records.gross_receipts[0]).toMatchObject({
      amount: 22000, platform: 'Synthetic Rides', breakdown: { baseEarnings: 20000, tips: 2000 }, source_detail: 'document_import',
    });
    expect(text(render())).toContain('Earnings added as self-employment income');
  });

  it('sends only the editable W-2 fields when the plain preview exceeds 64 entries', async () => {
    const crowded: Record<string, unknown> = { ...W2_EXTRACTED };
    for (let i = 0; i < 60; i += 1) crowded[`extraPlain${String(i).padStart(2, '0')}`] = `note-${i}`;
    previewExtraction = crowded;
    saveExtraction = { ...W2_EXTRACTED, box1Wages: 11111, box12Codes: SECOND_READ_BOX_12 };
    const commit = await reviewW2();
    expect(commit.status, `save response ${commit.status}: ${JSON.stringify(commit.body)}`).toBe(200);
    const sent = JSON.parse(commit.overrideFields) as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual([
      'employerName', 'employerEIN', 'box1Wages', 'box2FederalWithheld', 'box3SocialSecurityWages',
      'box4SocialSecurityWithheld', 'box5MedicareWages', 'box6MedicareWithheld', 'box16StateWages',
      'box17StateWithheld', 'state',
    ]);
    expect(sent.box1Wages).toBe(65000);
    expect(sent).not.toHaveProperty('extraPlain00');
    expect(sent).not.toHaveProperty('box12Codes');
    expect(state.records.w2_income[0]).toMatchObject({ box1Wages: 65000, wages: 65000, box12Codes: SECOND_READ_BOX_12 });
  });
});
