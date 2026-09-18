/**
 * The analysis outcome codes written by lib/ai/analysis-jobs.ts (and the on-demand
 * route) each map to plain copy and exactly one way forward. The mapping is pure,
 * so every surface shows the same words.
 */
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@/lib/firebase/transactions';
import { ANALYSIS_ERROR_CODES, PROFILE_SETTINGS_HREF, analysisBacklogMessage, analysisOutcomeLabel, analysisOutcomeMessage, analysisOutcomeTitle,
  analysisOutcomeView, analysisRecordState, summarizeAnalysisBacklog } from '@/lib/ai/analysis-state';
import { reviewPresentation } from '@/lib/transactions/review-presentation';

const FORBIDDEN_CLAIMS = /maximi[sz]e|guarantee|audit protection|file your taxes|fully deductible|100% deductible/i;
const record = (changes: Partial<Transaction> = {}): Transaction => ({ id: 't', trans_id: 't', account_id: 'acct-a', merchant_name: 'Merchant', amount: 12, category: 'GENERAL_MERCHANDISE', date: '2026-09-01', ...changes });
const failed = (analysisErrorCode: string | null, changes: Partial<Transaction> = {}) => record({ analysisStatus: 'failed', analysis_status: 'failed', analysisErrorCode, ...changes });

describe('analysisOutcomeView: code to copy and action', () => {
  it('covers every code the worker writes', () => {
    for (const code of ANALYSIS_ERROR_CODES) {
      const view = analysisOutcomeView(code);
      if (code === 'ALREADY_ANALYZED') { expect(view).toBeNull(); continue; }
      expect(view, code).toMatchObject({ code });
      expect(view!.title.length, code).toBeGreaterThan(0);
      expect(view!.message.length, code).toBeGreaterThan(0);
      expect(view!.plural.length, code).toBeGreaterThan(0);
      expect(`${view!.title} ${view!.message} ${view!.plural}`).not.toMatch(FORBIDDEN_CLAIMS);
      // Exactly one way forward per code: fix the cause, retry the queue, review the record, or wait.
      expect([!!view!.link, view!.manualReview].filter(Boolean).length, code).toBeLessThanOrEqual(1);
    }
  });
  it('AI_UNAVAILABLE pauses with manual review and no retry', () => {
    expect(analysisOutcomeView('AI_UNAVAILABLE')).toMatchObject({ kind: 'paused', retry: false, link: null, manualReview: false,
      title: 'AI analysis is temporarily unavailable', message: 'Your records are saved; you can review transactions manually.' });
  });
  it('PROFILE_REQUIRED explains the missing fields, links to the profile settings tab and allows a retry afterwards', () => {
    const view = analysisOutcomeView('PROFILE_REQUIRED')!;
    expect(view).toMatchObject({ kind: 'paused', retry: true, link: { href: PROFILE_SETTINGS_HREF } });
    expect(view.message).toContain('Add your profession and state to your profile to enable analysis');
    expect(PROFILE_SETTINGS_HREF).toBe('/protected/settings?tab=profile');
  });
  it('record problems point to manual review without a retry', () => {
    expect(analysisOutcomeView('TRANSACTION_REVIEW_REQUIRED')).toMatchObject({ kind: 'paused', retry: false, manualReview: true });
    expect(analysisOutcomeView('TRANSACTION_REVIEW_REQUIRED')!.message).toMatch(/valid date, amount and merchant/);
    expect(analysisOutcomeView('CURRENCY_REVIEW_REQUIRED')).toMatchObject({ kind: 'paused', retry: false, manualReview: true });
    expect(analysisOutcomeView('CURRENCY_REVIEW_REQUIRED')!.message).toMatch(/not in U\.S\. dollars/);
  });
  it.each(['AI_RETRY_LIMIT', 'AI_FAILED', 'AI_INPUT_CHANGED'])('%s is a completed failure with a retry', code => {
    expect(analysisOutcomeView(code)).toMatchObject({ kind: 'failed', title: 'Analysis could not complete', retry: true, link: null, manualReview: false });
  });
  it('TRANSACTION_UNAVAILABLE is skipped work with nothing to do', () => {
    expect(analysisOutcomeView('TRANSACTION_UNAVAILABLE')).toMatchObject({ kind: 'skipped', retry: false, link: null, manualReview: false });
  });
  it('maps the on-demand route codes onto the same outcomes and treats unknown codes as a retryable failure', () => {
    expect(analysisOutcomeView('AI_PROFILE_REQUIRED')).toMatchObject({ kind: 'paused', link: { href: PROFILE_SETTINGS_HREF } });
    expect(analysisOutcomeView('AI_RECORD_CHANGED')).toMatchObject({ kind: 'failed', retry: true });
    expect(analysisOutcomeView('AI_INPUT_REVIEW')).toMatchObject({ kind: 'paused', manualReview: true });
    expect(analysisOutcomeView('AI_PENDING_TRANSACTION')).toMatchObject({ kind: 'skipped', retry: false });
    expect(analysisOutcomeView('AI_RATE_LIMITED')).toMatchObject({ kind: 'failed', retry: true });
    expect(analysisOutcomeView('SOMETHING_NEW')).toMatchObject({ code: 'SOMETHING_NEW', kind: 'failed', retry: true });
  });
  it('explains nothing for empty values or a record that already has a suggestion', () => {
    for (const value of [null, undefined, '', '  ', 42, 'ALREADY_ANALYZED']) expect(analysisOutcomeView(value)).toBeNull();
  });
});

describe('analysisRecordState: one record', () => {
  it('orders live work, saved suggestions, failures, queued tasks and nothing', () => {
    expect(analysisRecordState(record({ pending: true, analysisStatus: 'failed', analysisErrorCode: 'AI_FAILED' })).state).toBe('bank_pending');
    expect(analysisRecordState(record({ analysisStatus: 'running', ai_suggestion: { id: 's' } as Transaction['ai_suggestion'] })).state).toBe('running');
    expect(analysisRecordState(failed('AI_FAILED', { ai_suggestion: { id: 's' } as Transaction['ai_suggestion'] })).state).toBe('completed');
    expect(analysisRecordState(failed('PROFILE_REQUIRED'))).toMatchObject({ state: 'paused', outcome: { code: 'PROFILE_REQUIRED' } });
    expect(analysisRecordState(failed('AI_RETRY_LIMIT'))).toMatchObject({ state: 'failed', outcome: { code: 'AI_RETRY_LIMIT' } });
    expect(analysisRecordState(failed('TRANSACTION_UNAVAILABLE'))).toMatchObject({ state: 'skipped' });
    expect(analysisRecordState(record({ analysis_status: 'failed' }))).toMatchObject({ state: 'failed', outcome: { code: 'AI_FAILED', retry: true } });
    expect(analysisRecordState(record({ analysisStatus: 'pending', analysisJobId: 'task' })).state).toBe('queued');
    expect(analysisRecordState(record({ analysisStatus: 'pending' })).state).toBe('none');
    expect(analysisRecordState(record()).state).toBe('none');
  });
});

describe('summarizeAnalysisBacklog: the owner\'s loaded transactions', () => {
  it('counts waiting work, groups outcomes by code (most common first) and lists accounts the catch-up can retry', () => {
    const backlog = summarizeAnalysisBacklog([
      record({ analysisStatus: 'pending', analysisJobId: 'q1' }), record({ analysisStatus: 'running' }), record({ analysisStatus: 'pending' }),
      failed('PROFILE_REQUIRED'), failed('PROFILE_REQUIRED', { account_id: 'acct-b' }), failed('AI_RETRY_LIMIT', { account_id: 'acct-b' }),
      failed('CURRENCY_REVIEW_REQUIRED', { account_id: 'acct-c' }), failed('AI_UNAVAILABLE', { account_id: 'acct-d' }),
      record({ analysisStatus: 'completed', ai_suggestion: { id: 'ok' } as Transaction['ai_suggestion'] }), record({ pending: true, analysisStatus: 'pending', analysisJobId: 'q2' }),
    ]);
    expect(backlog.waiting).toBe(2);
    expect(backlog.outcomes.map(group => [group.outcome.code, group.count, group.accountIds])).toEqual([
      ['PROFILE_REQUIRED', 2, ['acct-a', 'acct-b']], ['AI_RETRY_LIMIT', 1, ['acct-b']], ['CURRENCY_REVIEW_REQUIRED', 1, ['acct-c']], ['AI_UNAVAILABLE', 1, ['acct-d']],
    ]);
    expect(backlog.retryAccountIds).toEqual(['acct-a', 'acct-b']);
  });
  it('is empty when nothing is queued or failed', () => {
    expect(summarizeAnalysisBacklog([record(), record({ analysisStatus: 'completed', ai_suggestion: { id: 'ok' } as Transaction['ai_suggestion'] })]))
      .toEqual({ waiting: 0, outcomes: [], retryAccountIds: [] });
  });
});

describe('aggregate copy', () => {
  it('states the count and sets the expectation that a first import is slow', () => {
    expect(analysisBacklogMessage(1)).toMatch(/^1 transaction waiting for AI analysis\. A first import can take a while/);
    expect(analysisBacklogMessage(1500)).toMatch(/^1500 transactions waiting for AI analysis\./);
    expect(analysisBacklogMessage(3)).not.toMatch(FORBIDDEN_CLAIMS);
  });
  it('titles grouped outcomes by kind', () => {
    expect(analysisOutcomeTitle(analysisOutcomeView('AI_FAILED')!, 1)).toBe('Analysis could not complete');
    expect(analysisOutcomeTitle(analysisOutcomeView('AI_FAILED')!, 12)).toBe('Analysis could not complete for 12 transactions');
    expect(analysisOutcomeTitle(analysisOutcomeView('PROFILE_REQUIRED')!, 40)).toBe('Analysis paused for 40 transactions');
    expect(analysisOutcomeTitle(analysisOutcomeView('AI_UNAVAILABLE')!, 2)).toBe('AI analysis is temporarily unavailable for 2 transactions');
    expect(analysisOutcomeTitle(analysisOutcomeView('TRANSACTION_UNAVAILABLE')!, 2)).toBe('2 transactions are not eligible for AI analysis');
  });
  it('phrases record-specific sentences for one or several records, and keeps neutral sentences as they are', () => {
    const currency = analysisOutcomeView('CURRENCY_REVIEW_REQUIRED')!;
    expect(analysisOutcomeMessage(currency, 1)).toBe('This record is not in U.S. dollars, so AI analysis does not run on it. Review it manually.');
    expect(analysisOutcomeMessage(currency, 2)).toBe('These records are not in U.S. dollars, so AI analysis does not run on them. Review them manually.');
    expect(analysisOutcomeMessage(analysisOutcomeView('AI_INPUT_CHANGED')!, 5)).toMatch(/^These transactions changed/);
    const profile = analysisOutcomeView('PROFILE_REQUIRED')!;
    expect(analysisOutcomeMessage(profile, 300)).toBe(profile.message);
    expect(analysisOutcomeMessage(analysisOutcomeView('SOMETHING_NEW')!, 3)).toBe(analysisOutcomeView('AI_FAILED')!.message);
  });
  it('labels a record card by outcome kind and feeds the review presentation', () => {
    expect(analysisOutcomeLabel(analysisOutcomeView('PROFILE_REQUIRED')!)).toBe('AI analysis paused');
    expect(analysisOutcomeLabel(analysisOutcomeView('AI_RETRY_LIMIT')!)).toBe('AI analysis could not complete');
    expect(analysisOutcomeLabel(analysisOutcomeView('TRANSACTION_UNAVAILABLE')!)).toBe('Not analyzed by AI');
    expect(reviewPresentation(failed('AI_UNAVAILABLE'))).toMatchObject({ label: 'AI analysis paused', outcome: { code: 'AI_UNAVAILABLE', retry: false } });
    expect(reviewPresentation(failed('AI_FAILED'))).toMatchObject({ label: 'AI analysis could not complete', categoryLabel: 'Category needs review' });
    expect(reviewPresentation(record({ analysisStatus: 'pending', analysisJobId: 'q' }))).toMatchObject({ label: 'Queued for AI analysis', outcome: null });
    expect(reviewPresentation(record())).toMatchObject({ label: 'No AI suggestion yet', outcome: null });
  });
});
