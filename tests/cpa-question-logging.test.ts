/**
 * POST /api/cpa-question keeps the asker's email, the question and the
 * amounts out of server logs whether the team email is sent, fails or is not
 * configured; only the record ID and a status are logged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contractRequest, CONTRACT_OWNER, installApiRouteMocks } from './fixtures/api-route-harness';

const harness = installApiRouteMocks();
const route = () => import('../app/api/cpa-question/route');

const QUESTION = 'Is my MARKER-QUESTION-7f3a coworking membership deductible?';
const MERCHANT = 'MARKER-MERCHANT-7f3a';
const body = { userId: CONTRACT_OWNER.uid, transactionId: 'tx-1', merchantName: MERCHANT, amount: 412.5, date: '2025-03-01', category: 'Office', question: QUESTION };
const SECRETS = [CONTRACT_OWNER.email, QUESTION, MERCHANT, '412.5'];

const logged: string[] = [];
beforeEach(async () => {
  await harness.reset();
  harness.seedOwnerProfile();
  logged.length = 0;
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logged.push(args.map(arg => arg instanceof Error ? `${arg.message} ${arg.stack ?? ''}` : typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')); });
  }
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function submit() {
  const { POST } = await route();
  const response = await POST(contractRequest('/api/cpa-question', { method: 'POST', auth: 'owner', body }));
  return { status: response.status, json: await response.json() as Record<string, unknown> };
}

describe('POST /api/cpa-question logging', () => {
  it('stores the question and logs only its record ID when the team email is not configured', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const { status, json } = await submit();
    expect(status).toBe(200);
    const stored = [...harness.db.records.entries()].find(([path]) => path.startsWith('cpa_questions/'));
    expect(stored?.[1]).toMatchObject({ question: QUESTION, userEmail: CONTRACT_OWNER.email, userId: CONTRACT_OWNER.uid });
    expect(logged.some(line => line.includes(String(json.questionId)))).toBe(true);
    for (const secret of SECRETS) expect(logged.join('\n'), secret).not.toContain(secret);
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('logs only a status when the email provider fails, and still accepts the question', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_contract_not_live');
    harness.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: `rejected: ${QUESTION}` }), { status: 422 }));
    const { status } = await submit();
    expect(status).toBe(200);
    expect(harness.fetch).toHaveBeenCalledTimes(1);
    expect(logged.some(line => /HTTP 422/.test(line))).toBe(true);
    for (const secret of SECRETS) expect(logged.join('\n'), secret).not.toContain(secret);
  });

  it('logs nothing sensitive when the email provider is unreachable', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_contract_not_live');
    const { status } = await submit();
    expect(status).toBe(200);
    for (const secret of SECRETS) expect(logged.join('\n'), secret).not.toContain(secret);
  });
});
