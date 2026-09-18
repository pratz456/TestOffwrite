import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), create: vi.fn(), constructor: vi.fn(), collection: vi.fn() }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: mocks.authenticate }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: { collection: mocks.collection } }));
vi.mock('openai', () => ({ default: function MockOpenAI(options: unknown) {
  mocks.constructor(options); return { chat: { completions: { create: mocks.create } } };
} }));
// The document import reads the upload with local OCR before the model call; synthetic text keeps this a wiring test.
vi.mock('@/lib/ocr/document-text', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/ocr/document-text')>(),
  recognizeDocumentText: async () => ({ text: 'Form W-2 Wage and Tax Statement 2026. 1 Wages, tips, other compensation 20,000.00', confidence: 0.9 }) }));
import { POST as assistant } from '../app/api/ai/tax-assistant/route';
import { POST as voice } from '../app/api/ai/parse-voice-command/route';
import { POST as document } from '../app/api/tax/import-document/route';
import { POST as bank } from '../app/api/tax/import-bank-statement/route';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
function json(body: unknown) { return new NextRequest('http://localhost/api/test', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }); }
function upload(fields: Record<string, string>) {
  const form = new FormData();
  form.set('file', new Blob([PNG], { type: 'image/png' }), 'synthetic.png');
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new NextRequest('http://localhost/api/test', { method: 'POST', body: form });
}
const routes = [
  { name: 'assistant', handler: assistant, request: () => json({ message: 'Can this synthetic vehicle be deducted?', taxYear: 2026 }), model: 'gpt-4o', content: { topic: 'vehicles-records', missingFactIds: ['vehicles-records:1'], photoCategories: ['vehicle'] } },
  { name: 'voice', handler: voice, request: () => json({ text: 'Add 12 dollars for synthetic stationery' }), model: 'gpt-4o-mini', content: { type: 'add_expense', data: { amount: 12, merchant: 'Synthetic stationery' }, confidence: 0.9 } },
  { name: 'document', handler: document, request: () => upload({ docType: 'w2', commit: 'false' }), model: 'gpt-4o', content: { docType: 'w2', employerName: 'Synthetic employer', taxYear: 2026, box1Wages: 20000, confidence: 1 } },
  { name: 'bank autodetection', handler: bank, request: () => upload({ docType: 'auto', year: '2026' }), model: 'gpt-4o', content: { detectedType: 'w2', confidence: 'high' } },
];
beforeEach(() => {
  vi.clearAllMocks(); resetRateLimitStore();
  vi.stubEnv('OPENAI_API_KEY', '  synthetic-shared-server-key  ');
  vi.stubEnv('OPENAI_MODEL', '');
  mocks.authenticate.mockResolvedValue({ user: { uid: 'synthetic-route-user' }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('one server OpenAI configuration across model routes', () => {
  it.each(routes)('$name uses the shared trimmed key, task model, and nonstored requests', async route => {
    mocks.create.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(route.content) } }] });
    const response = await route.handler(route.request());
    expect(response.status).toBe(200);
    expect(mocks.constructor).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'synthetic-shared-server-key', baseURL: 'https://api.openai.com/v1' }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ model: route.model, store: false }));
    // The document text path reads only the owner's own profile, to learn which name to redact before the text leaves the server.
    if (route.name === 'document') expect(mocks.collection.mock.calls).toEqual([['user_profiles']]);
    else expect(mocks.collection).not.toHaveBeenCalled();
  });
  it.each(routes)('$name honors the same server model override', async route => {
    vi.stubEnv('OPENAI_MODEL', '  gpt-4o-mini  ');
    mocks.create.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(route.content) } }] });
    expect((await route.handler(route.request())).status).toBe(200);
    expect(mocks.create.mock.calls[0][0].model).toBe('gpt-4o-mini');
  });
  it.each(routes)('$name rejects unauthorized requests before sending model input', async route => {
    mocks.authenticate.mockResolvedValue({ user: null, error: 'Unauthorized' });
    expect((await route.handler(route.request())).status).toBe(401);
    expect(mocks.constructor).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(routes)('$name fails without falling back to another key', async route => {
    vi.stubEnv('OPENAI_API_KEY', '  ');
    vi.stubEnv('NEXT_PUBLIC_OPENAI_API_KEY', 'synthetic-browser-key-must-not-be-used');
    const response = await route.handler(route.request());
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(routes)('$name does not echo provider credentials or private input on failure', async route => {
    mocks.create.mockRejectedValue(new Error('SECRET-provider-credential-private-image-bytes'));
    const response = await route.handler(route.request());
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await response.text()).not.toContain('SECRET');
  });
  it('preserves bounded assistant retries and timeout', async () => {
    mocks.create.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(routes[0].content) } }] });
    await assistant(routes[0].request());
    expect(mocks.constructor).toHaveBeenCalledWith(expect.objectContaining({ timeout: 45000, maxRetries: 0 }));
  });
});
