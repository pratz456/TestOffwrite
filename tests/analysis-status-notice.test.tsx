import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Static markup only: there is no DOM test environment. The retry transport is exercised directly below.
const harness = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));

import { AnalysisStatusNotice, requestAnalysisRetry } from '@/components/analysis-status-notice';
import { ANALYSIS_ERROR_CODES, PROFILE_SETTINGS_HREF, analysisOutcomeView } from '@/lib/ai/analysis-state';

/** Claims policy: none of the status copy may promise outcomes or describe filing. */
const FORBIDDEN_CLAIMS = /maximi[sz]e|guarantee|audit protection|file your taxes|fully deductible|100% deductible/i;
const rendered: string[] = [];
function html(element: React.ReactElement): string {
  const markup = renderToStaticMarkup(element);
  rendered.push(markup);
  return markup;
}
const decode = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\u2019').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const buttons = (markup: string) => (markup.match(/<button[^>]*>/g) ?? []).length;
const noop = () => {};
const notice = (code: string, props: Partial<React.ComponentProps<typeof AnalysisStatusNotice>> = {}) =>
  html(<AnalysisStatusNotice outcome={analysisOutcomeView(code)} accountIds={['acct-1']} onReview={noop} {...props} />);

beforeEach(() => { harness.request.mockReset(); });

describe('AnalysisStatusNotice: one explanation and one way forward per code', () => {
  it('renders nothing when there is nothing to explain', () => {
    expect(html(<AnalysisStatusNotice />)).toBe('');
    expect(html(<AnalysisStatusNotice waiting={0} outcome={null} />)).toBe('');
    expect(html(<AnalysisStatusNotice outcome={analysisOutcomeView('ALREADY_ANALYZED')} />)).toBe('');
  });
  it('states the backlog count with the first-import expectation and no action', () => {
    const markup = html(<AnalysisStatusNotice waiting={1500} />);
    expect(decode(markup)).toContain('1500 transactions waiting for AI analysis. A first import can take a while');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('animate-spin');
    expect(buttons(markup)).toBe(0);
    expect(decode(html(<AnalysisStatusNotice waiting={1} />))).toContain('1 transaction waiting for AI analysis.');
  });
  it('AI_UNAVAILABLE: temporary, records saved, manual review; no retry button and no link', () => {
    const markup = notice('AI_UNAVAILABLE');
    expect(decode(markup)).toContain('AI analysis is temporarily unavailable');
    expect(decode(markup)).toContain('Your records are saved; you can review transactions manually.');
    expect(markup).not.toContain('Retry analysis');
    expect(markup).not.toContain('<a ');
    expect(buttons(markup)).toBe(0);
  });
  it('PROFILE_REQUIRED: names the missing fields and links to the profile settings tab, with a retry for afterwards', () => {
    const markup = notice('PROFILE_REQUIRED');
    expect(decode(markup)).toContain('Add your profession and state to your profile to enable analysis');
    expect(markup).toContain(`href="${PROFILE_SETTINGS_HREF}"`);
    expect(markup).toContain('Add profession and state');
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*>(?:(?!<\/button>).)*Retry analysis/);
    expect(buttons(markup)).toBe(1);
  });
  it.each(['TRANSACTION_REVIEW_REQUIRED', 'CURRENCY_REVIEW_REQUIRED'])('%s: one sentence about the record and a manual review action, no retry', code => {
    const markup = notice(code);
    expect(decode(markup)).toContain('Analysis paused for this record');
    expect(decode(markup)).toMatch(code === 'CURRENCY_REVIEW_REQUIRED' ? /not in U\.S\. dollars/ : /valid date, amount and merchant/);
    expect(markup).toContain('Review record');
    expect(markup).not.toContain('Retry analysis');
    expect(buttons(markup)).toBe(1);
    // Without a review handler the sentence still points to manual review and nothing else is offered.
    expect(buttons(notice(code, { onReview: undefined }))).toBe(0);
  });
  it.each(['AI_RETRY_LIMIT', 'AI_FAILED', 'AI_INPUT_CHANGED'])('%s: "Analysis could not complete" with a Retry analysis action', code => {
    const markup = notice(code);
    expect(decode(markup)).toContain('Analysis could not complete');
    expect(markup).toContain('Retry analysis');
    expect(markup).toContain('text-destructive');
    expect(markup).not.toContain('<a ');
    expect(buttons(markup)).toBe(1);
    expect(markup).not.toMatch(/<button[^>]*disabled=""/);
  });
  it('TRANSACTION_UNAVAILABLE: explains the skipped record and offers nothing to do', () => {
    const markup = notice('TRANSACTION_UNAVAILABLE');
    expect(decode(markup)).toContain('Not eligible for AI analysis');
    expect(buttons(markup)).toBe(0);
  });
  it('covers every code the worker writes with a title, a sentence and one action path', () => {
    for (const code of ANALYSIS_ERROR_CODES) {
      if (code === 'ALREADY_ANALYZED') continue;
      const markup = notice(code);
      const view = analysisOutcomeView(code)!;
      expect(decode(markup), code).toContain(view.title);
      expect(decode(markup), code).toContain(view.message);
      expect(markup, code).toContain('aria-label="AI analysis status"');
      // Every action is tap-sized and no text can overflow a 360 px column.
      expect((markup.match(/min-h-11/g) ?? []).length, code).toBe(buttons(markup) + (view.link ? 1 : 0));
      expect(markup, code).toContain('break-words');
    }
  });
  it('maps the on-demand route codes to the same explanations', () => {
    expect(notice('AI_PROFILE_REQUIRED')).toContain(`href="${PROFILE_SETTINGS_HREF}"`);
    expect(decode(notice('AI_INPUT_REVIEW'))).toContain('Confirm a valid date, amount and U.S. dollar currency');
    expect(decode(notice('AI_PENDING_TRANSACTION'))).toContain('still pending');
    expect(decode(notice('AI_RATE_LIMITED'))).toContain('Analysis could not complete');
  });
  it('titles and phrases a grouped outcome by count, and hides the retry without an account or while disabled', () => {
    const grouped = notice('AI_RETRY_LIMIT', { count: 12, accountIds: ['a', 'b'] });
    expect(decode(grouped)).toContain('Analysis could not complete for 12 transactions');
    const records = notice('TRANSACTION_REVIEW_REQUIRED', { count: 3 });
    expect(decode(records)).toContain('These records need a valid date, amount and merchant');
    expect(records).toContain('Review records');
    expect(decode(notice('PROFILE_REQUIRED', { count: 40 }))).toContain('Analysis paused for 40 transactions');
    expect(notice('AI_FAILED', { accountIds: [] })).not.toContain('Retry analysis');
    expect(notice('AI_FAILED', { disabled: true })).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Retry analysis/);
  });
  it('combines the backlog line with an outcome, and drops the card border in compact mode', () => {
    const markup = html(<AnalysisStatusNotice waiting={20} outcome={analysisOutcomeView('AI_FAILED')} count={2} accountIds={['acct-1']} compact />);
    expect(decode(markup)).toContain('20 transactions waiting for AI analysis');
    expect(decode(markup)).toContain('Analysis could not complete for 2 transactions');
    expect(markup).not.toContain('rounded-xl border');
    expect(html(<AnalysisStatusNotice waiting={1} />)).toContain('rounded-xl border');
  });
  it('keeps every rendered status string free of outcome promises and filing claims', () => {
    expect(rendered.length).toBeGreaterThan(15);
    for (const markup of rendered) expect(decode(markup)).not.toMatch(FORBIDDEN_CLAIMS);
  });
});

describe('requestAnalysisRetry: one durable catch-up request per account', () => {
  it('posts each account to the catch-up route and reports the verified queued total', async () => {
    harness.request.mockImplementation(async (_url: string, init: { body: string }) =>
      Response.json({ jobId: `owner_${JSON.parse(init.body).accountId}`, queued: JSON.parse(init.body).accountId === 'a' ? 3 : 0, status: JSON.parse(init.body).accountId === 'a' ? 'queued' : 'idle' }));
    const result = await requestAnalysisRetry(['a', 'b']);
    expect(harness.request.mock.calls.map(([url, init]) => [url, init.method, JSON.parse(init.body)])).toEqual([
      ['/api/plaid/auto-analyze', 'POST', { accountId: 'a' }], ['/api/plaid/auto-analyze', 'POST', { accountId: 'b' }]]);
    expect(result).toMatchObject({ ok: true, queued: 3 });
    expect(result.message).toContain('3 transactions queued again');
    expect(result.message).toContain('nothing is confirmed without your review');
  });
  it('says honestly when nothing new was queued, and keeps a partial count when a later account is rate limited', async () => {
    harness.request.mockResolvedValue(Response.json({ jobId: 'owner_a', queued: 0, status: 'idle' }));
    expect((await requestAnalysisRetry(['a'])).message).toContain('Nothing new was queued');
    harness.request.mockResolvedValueOnce(Response.json({ jobId: 'owner_a', queued: 4, status: 'queued' })).mockResolvedValueOnce(Response.json({ error: 'later' }, { status: 429 }));
    const partial = await requestAnalysisRetry(['a', 'b']);
    expect(partial).toMatchObject({ ok: false, queued: 4 });
    expect(partial.message).toBe('4 transactions queued again before this stopped. Analysis was retried recently. Wait a few minutes before retrying again.');
  });
  it.each([
    [429, { error: 'slow down' }, 'retried recently'],
    [401, { error: 'Unauthorized' }, 'Sign in again'],
    [503, { code: 'AI_UNAVAILABLE' }, 'temporarily unavailable'],
    [503, { code: 'ANALYSIS_QUEUE_UNAVAILABLE' }, 'could not be retried'],
  ])('explains a %s response without echoing the server text', async (status, body, expected) => {
    harness.request.mockResolvedValue(Response.json(body, { status }));
    const result = await requestAnalysisRetry(['a', 'b']);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(expected);
    expect(result.message).not.toContain('slow down');
    expect(harness.request).toHaveBeenCalledTimes(1);
  });
  it('does not claim a retry it cannot verify, and reports a network failure as such', async () => {
    harness.request.mockResolvedValueOnce(Response.json({ ok: true }));
    expect((await requestAnalysisRetry(['a'])).message).toContain('could not be verified');
    harness.request.mockRejectedValueOnce(new Error('offline'));
    const offline = await requestAnalysisRetry(['a']);
    expect(offline).toMatchObject({ ok: false, queued: 0 });
    expect(offline.message).toContain('Check your connection');
    expect(offline.message).not.toContain('offline');
  });
  it('never promises outcomes in retry feedback', async () => {
    harness.request.mockResolvedValue(Response.json({ jobId: 'owner_a', queued: 2, status: 'queued' }));
    expect((await requestAnalysisRetry(['a'])).message).not.toMatch(FORBIDDEN_CLAIMS);
  });
});
