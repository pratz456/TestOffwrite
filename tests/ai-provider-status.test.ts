import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const auth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: auth }));
import { GET } from '@/app/api/ai/status/route';
import { getAIProviderStatus } from '@/lib/ai/provider-status';

beforeEach(() => {
  auth.mockResolvedValue({ user: { uid: 'status-owner' }, error: null });
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-server-key');
  vi.stubEnv('OPENAI_MODEL', undefined);
  vi.stubEnv('AI_ANALYSIS_ENABLED', undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('authenticated AI configuration status', () => {
  it('reports configuration without exposing the key or claiming a successful provider request', async () => {
    const response = await GET(new NextRequest('http://localhost/api/ai/status'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ configured: true, provider: 'openai', model: 'gpt-4o-mini', reason: null });
  });
  it.each([undefined, '', ' \n '])('keeps absent or blank credentials unavailable (%j)', key => {
    vi.stubEnv('OPENAI_API_KEY', key);
    expect(getAIProviderStatus()).toMatchObject({ configured: false, reason: 'not_configured' });
  });
  it('respects an explicit operator pause even with a configured key', () => {
    vi.stubEnv('AI_ANALYSIS_ENABLED', 'false');
    expect(getAIProviderStatus()).toMatchObject({ configured: false, reason: 'disabled' });
  });
  it('uses the configured model', () => {
    vi.stubEnv('OPENAI_MODEL', ' custom-supported-model ');
    expect(getAIProviderStatus().model).toBe('custom-supported-model');
  });
  it('requires authentication before disclosing configuration', async () => {
    auth.mockResolvedValue({ user: null, error: 'invalid' });
    const response = await GET(new NextRequest('http://localhost/api/ai/status'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
