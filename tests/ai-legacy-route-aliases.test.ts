import { describe, expect, it, vi } from 'vitest';
const post = vi.hoisted(() => vi.fn());
vi.mock('@/app/api/ai/analyze-transaction/route', () => ({ POST: post }));
import { POST as legacyPost } from '@/app/api/openai/analyze-transaction/route';
import { POST as singlePost } from '@/app/api/openai/analyze-single-transaction/route';

describe('legacy AI URLs', () => {
  it('use the same owned-record handler without self-fetching or bypassing request limits', () => {
    expect(legacyPost).toBe(post);
    expect(singlePost).toBe(post);
  });
});
