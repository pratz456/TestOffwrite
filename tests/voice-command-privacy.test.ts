import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  configured: true,
  create: vi.fn(),
}));

vi.mock('@/lib/firebase/api-auth', () => ({
  getAuthenticatedUser: async () => ({ user: { uid: 'voice-owner' }, error: null }),
}));
vi.mock('@/lib/openai/client', () => ({
  hasOpenAIAPIKey: () => mocks.configured,
  getOpenAIModel: () => 'synthetic-voice-model',
  getOpenAIClientOrThrow: () => ({ chat: { completions: { create: mocks.create } } }),
}));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));

import { POST } from '@/app/api/ai/parse-voice-command/route';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

function request(text: string) {
  return new NextRequest('https://writeoffapp.com/api/ai/parse-voice-command', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://writeoffapp.com' },
    body: JSON.stringify({ text }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  resetRateLimitStore();
  mocks.configured = true;
  mocks.create.mockResolvedValue({
    choices: [{
      message: {
        content: JSON.stringify({
          type: 'question',
          data: { question: 'Question about SSN 123-45-6789 and EIN 12-3456789' },
          confidence: 0.9,
        }),
      },
    }],
  });
});

describe('voice command privacy boundary', () => {
  it('redacts identifiers before the provider call and from validated model output', async () => {
    const response = await POST(request('Question about SSN 123-45-6789 and EIN 12-3456789'));
    expect(response.status).toBe(200);
    const providerPayload = JSON.stringify(mocks.create.mock.calls[0][0]);
    expect(providerPayload).not.toMatch(/123-45-6789|12-3456789/);
    expect(providerPayload).toContain('[redacted-id]');
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(/123-45-6789|12-3456789/);
    expect(body.command.data.question).toContain('[redacted-id]');
  });

  it('returns a generic retryable message when voice AI is not configured', async () => {
    mocks.configured = false;
    const response = await POST(request('Add a $12 expense'));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('OPENAI_API_KEY');
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
