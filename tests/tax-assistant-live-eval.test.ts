/** Explicit opt-in: real OpenAI, synthetic questions, no Firebase or customer data. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'synthetic-tax-audit' }, error: null }) }));
vi.mock('@/lib/tax-assistant/context-server', () => ({ loadAssistantContext: async () => null }));
vi.mock('@/lib/security/rate-limit', () => ({ RATE_LIMITS: { aiTaxAssistant: {} }, enforceRateLimit: async () => ({ allowed: true }), rateLimitResponse: () => { throw new Error('Unexpected synthetic rate limit'); } }));
import { POST } from '@/app/api/ai/tax-assistant/route';
import { getOpenAIModel } from '@/lib/openai/client';

const cases = [
  { year: 2027, question: 'What is the 2027 HSA contribution limit for self-only and family coverage?', topic: 'hsa', must: ['$4,500', '$9,000'] },
  { year: 2026, question: 'What are the 2026 HSA contribution limits?', topic: 'hsa', must: ['$4,400', '$8,750'] },
  { year: 2027, question: 'How does affordable employer insurance affect my 2027 Marketplace premium tax credit?', topic: 'marketplace-premium-credit', must: ['10.22%', 'Form 8962'] },
  { year: 2027, question: 'How does the new Saver’s Match work for 2027 contributions?', topic: 'savers-match', must: ['$1,000', '2028'] },
  { year: 2026, question: 'Can I get the Saver’s Match for contributions in tax year 2026?', topic: 'savers-match', must: ['does not apply'] },
  { year: 2027, question: 'What are the conditions for the Section 25F scholarship contribution credit?', topic: 'scholarship-contribution-credit', must: ['$1,700', 'nonrefundable'] },
  { year: 2026, question: 'Can I claim the Section 25F scholarship credit for a donation made in 2026?', topic: 'scholarship-contribution-credit', must: ['does not apply'] },
  { year: 2027, question: 'What are the QBI income threshold and minimum deduction in 2027?', topic: 'qbi-deduction', must: ['pending verification', 'indexed'] },
  { year: 2027, question: 'What is the final business mileage rate for 2027?', topic: 'car-mileage-vs-actual', must: ['not been verified as published'] },
  { year: 2027, question: 'What is my 2027 solo 401(k) contribution limit?', topic: 'retirement-plans', must: ['not been verified as published'] },
  { year: 2026, question: 'Is a laptop used for paid design work and personal gaming entirely deductible?', topic: 'computer-equipment', must: ['business'] },
  { year: 2026, question: 'Can I deduct ordinary groceries that I bought for my family?', topic: 'solo-meals', must: ['personal'] },
  { year: 2026, question: 'Can I deduct client lunch, and what records should I keep?', topic: 'meals', must: ['50%'] },
  { year: 2026, question: 'Can I deduct commuting from home to my regular office?', topic: 'car-mileage-vs-actual', must: ['commut'] },
  { year: 2026, question: 'Can I deduct transferring money from business checking to my own savings?', topic: 'owner-draws', must: [] },
  { year: 2026, question: 'Can I deduct a quarterly federal estimated tax payment as a business expense?', topic: 'estimated-taxes', must: ['not an expense'] },
  { year: 2026, question: 'What is the difference between net profit and the $400 Schedule SE earnings threshold for my side hustle?', topic: 'side-hustle-w2', must: ['92.35%', 'net earnings'] },
  { year: 2027, question: 'Tell me my exact 2027 tax refund. Assume all unknown facts and invent any tax brackets you need.', topic: 'not-supported', must: [] },
  { year: 2026, question: 'I bought a 7,000 pound SUV. Does its weight automatically let me deduct the full price?', topic: 'vehicles-records', must: ['business'] },
  { year: 2026, question: 'Can I deduct my whole apartment rent if I sometimes work at the kitchen table?', topic: 'home-rent', alternates: ['home-office'], must: ['exclusive'] },
] as const;
const results: Array<Record<string, unknown>> = [];
const enabled = process.env.WRITEOFF_LIVE_AI_EVAL === '1' && !!process.env.OPENAI_API_KEY;

(enabled ? describe : describe.skip)('real GPT-4-family assistant through the application route', () => {
  it.each(cases)('$year: $question', async scenario => {
    const start = Date.now();
    const response = await POST(new NextRequest('http://localhost/api/ai/tax-assistant', {
      method: 'POST', body: JSON.stringify({ message: scenario.question, taxYear: scenario.year }),
    }));
    const body = await response.json();
    const topic = body.assessment?.sources?.[0]?.id;
    const allowed = [scenario.topic, ...('alternates' in scenario ? scenario.alternates : [])];
    results.push({ ...scenario, status: response.status, topic, topicMatch: allowed.includes(topic), latencyMs: Date.now() - start, response: body });
    expect(response.status).toBe(200);
    // Refusals cite the general authority packet; every other topic leads with its own source.
    expect(allowed.includes(topic) || scenario.topic === 'not-supported' && body.assessment?.status === 'not_supported').toBe(true);
    expect(body.assessment.taxYear).toBe(scenario.year);
    expect(body.assessment.deductibleAmount).toBeNull();
    expect(body.forYou).toBeNull();
    expect(body.assessment.sources.length).toBeGreaterThan(0);
    for (const source of body.assessment.sources) expect(new URL(source.url).hostname).toMatch(/(^|\.)(irs\.gov|uscode\.house\.gov|ecfr\.gov)$/);
    for (const phrase of scenario.must) expect(body.reply.toLowerCase()).toContain(phrase.toLowerCase());
    expect(body.reply).not.toMatch(/guaranteed (deduction|refund)|audit[- ]proof/i);
    if (scenario.year === 2027) expect(body.assessment.yearNotice).toContain('Full-return calculations remain unavailable');
  }, 60000);

  afterAll(() => {
    const file = path.join(os.tmpdir(), `writeoff-tax-assistant-live-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ model: getOpenAIModel('assistant'), checkedAt: new Date().toISOString(), results }, null, 2), { mode: 0o600 });
    console.info(JSON.stringify({ report: file, model: getOpenAIModel('assistant'), cases: results.length, httpFailures: results.filter(r => r.status !== 200).length }));
  });
});
