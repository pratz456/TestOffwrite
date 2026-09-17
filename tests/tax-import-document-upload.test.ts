/**
 * POST /api/tax/import-document accepts only a bounded multipart image whose
 * bytes match the declared type, validates the form fields, and reports a
 * provider failure without internal detail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { CONTRACT_OWNER, installApiRouteMocks, OWNER_ID_TOKEN, SITE_URL } from './fixtures/api-route-harness';
import { exhaustRateLimit } from './fixtures/rate-limit-store';

// The merged route runs local OCR before any model call; give it usable text so the provider is reached with redacted text.
vi.mock('@/lib/ocr/document-text', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ocr/document-text')>(),
  recognizeDocumentText: async () => ({ text: 'Form W-2 Wage and Tax Statement 2025 Employer Acme Corp EIN 12-3456789 Employee SSN 123-45-6789 Box 1 Wages 54000.00 Box 2 Federal income tax withheld 6200.00', confidence: 0.93 }),
}));

const harness = installApiRouteMocks();
const route = () => import('../app/api/tax/import-document/route');

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

async function upload(fields: Record<string, string>, file?: { name: string; type: string; bytes: Buffer }, headers: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.append('file', new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const encoded = new Request(`${SITE_URL}/api/tax/import-document`, { method: 'POST', body: form });
  const body = Buffer.from(await encoded.arrayBuffer());
  const request = new NextRequest(`${SITE_URL}/api/tax/import-document`, {
    method: 'POST', body,
    headers: { 'content-type': encoded.headers.get('content-type')!, 'content-length': String(body.length), authorization: `Bearer ${OWNER_ID_TOKEN}`, ...headers },
  });
  const { POST } = await route();
  const response = await POST(request);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

beforeEach(async () => {
  await harness.reset();
  harness.seedOwnerProfile();
  for (const level of ['log', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('POST /api/tax/import-document', () => {
  it('requires a multipart body', async () => {
    const { POST } = await route();
    const response = await POST(new NextRequest(`${SITE_URL}/api/tax/import-document`, {
      method: 'POST', body: '{"file":"x"}', headers: { 'content-type': 'application/json', authorization: `Bearer ${OWNER_ID_TOKEN}` },
    }));
    expect(response.status).toBe(400);
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('refuses an upload above the 10 MB limit before reading it', async () => {
    const { status } = await upload({}, { name: 'w2.png', type: 'image/png', bytes: PNG }, { 'content-length': String(11 * 1024 * 1024) });
    expect(status).toBe(413);
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('refuses a PDF or an unknown type', async () => {
    for (const type of ['application/pdf', 'text/html', '']) {
      const { status } = await upload({}, { name: 'w2.bin', type, bytes: PNG });
      expect(status, type).toBe(415);
    }
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('refuses bytes that do not match the declared image type', async () => {
    const { status, body } = await upload({}, { name: 'w2.jpg', type: 'image/jpeg', bytes: PNG });
    expect(status).toBe(415);
    expect(body.error).toMatch(/do not match/);
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('validates docType, taxYear and overrideFields before contacting the model', async () => {
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ docType: 'passport' }, /docType/],
      [{ taxYear: '99999' }, /taxYear/],
      [{ overrideFields: '{' }, /overrideFields/],
      [{ overrideFields: '[1]' }, /overrideFields/],
      [{ overrideFields: JSON.stringify({ nested: { deep: true } }) }, /overrideFields/],
    ];
    for (const [fields, pattern] of cases) {
      const { status, body } = await upload(fields, { name: 'w2.png', type: 'image/png', bytes: PNG });
      expect(status, JSON.stringify(fields)).toBe(400);
      expect(String(body.error)).toMatch(pattern);
    }
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('requires a file', async () => {
    const { status } = await upload({ docType: 'w2' });
    expect(status).toBe(400);
  });

  it('sends redacted OCR text (never the photo) to the model and reports a provider failure generically', async () => {
    const { status, body } = await upload({ docType: 'w2', taxYear: '2025', overrideFields: JSON.stringify({ employerName: 'Acme' }) }, { name: 'w2.jpg', type: 'image/jpeg', bytes: JPEG });
    expect(harness.fetch).toHaveBeenCalled();
    const sent = JSON.stringify(harness.fetch.mock.calls.map(call => call[1]?.body ?? ''));
    expect(sent).not.toContain('image_url');
    expect(sent).not.toContain('123-45-6789');
    expect(status).toBe(500);
    expect(body).toEqual({ error: 'Document processing failed' });
  });

  it('throttles repeated scans per owner before reading the upload', async () => {
    // Imported after the harness mocks so the limiter binds to the in-memory store.
    const { RATE_LIMITS } = await import('@/lib/security/rate-limit');
    await exhaustRateLimit(RATE_LIMITS.taxDocumentImport, CONTRACT_OWNER.uid);
    const { status, body } = await upload({ docType: 'w2' }, { name: 'w2.jpg', type: 'image/jpeg', bytes: JPEG });
    expect(status).toBe(429);
    expect(body.code).toBe('RATE_LIMITED');
    expect(harness.fetch).not.toHaveBeenCalled();
  });
});
