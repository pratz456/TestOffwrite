import { describe, expect, it } from 'vitest';
import type { Transaction } from '@/lib/firebase/transactions';
import { prioritizeTransactionReview } from '@/lib/transactions/review-priority';
import { dashboardNextSteps } from '@/lib/dashboard/next-steps';
import { hasTransactionFactChange } from '@/lib/transactions/fact-changes';

const record = (id: string, fields: Partial<Transaction> = {}): Transaction => ({ id, trans_id: id, account_id: 'account',
  merchant_name: id, amount: 10, date: '2026-09-20', iso_currency_code: 'USD', category: 'other', is_deductible: null, ...fields });
const suggestion = { id: 'suggestion', status: 'needs_more_info' } as NonNullable<Transaction['ai_suggestion']>;

describe('review urgency and three next steps', () => {
  it('puts unanswered facts before ordinary suggestions and processing/confirmed records, without mutating inputs', () => {
    const records = [record('confirmed', { review_status: 'confirmed', is_deductible: true }),
      record('routine', { ai_suggestion: { ...suggestion, status: 'ok' }, amount: 500 }),
      record('processing', { analysisStatus: 'running', amount: 1000 }), record('question', { ai_suggestion: suggestion }),
      record('bank-pending', { pending: true, amount: 2000 })];
    expect(prioritizeTransactionReview(records).map(row => row.id)).toEqual(['question', 'routine', 'processing', 'confirmed', 'bank-pending']);
    expect(records[0].id).toBe('confirmed');
  });
  it('uses recorded magnitude only within the same priority and retains ties stably', () => {
    const records = [record('small', { ai_suggestion: suggestion }), record('large', { ai_suggestion: suggestion, amount: 100 }), record('equal', { ai_suggestion: suggestion, amount: -100 })];
    expect(prioritizeTransactionReview(records).map(row => row.id)).toEqual(['large', 'equal', 'small']);
  });
  it('limits home to the tax blocker, missing facts and routine review in that order', () => {
    const rows = [record('ready', { ai_suggestion: { ...suggestion, status: 'ok' } }), record('question', { ai_suggestion: suggestion })];
    const steps = dashboardNextSteps(rows, { status: 'review', code: 'INCOME_RECONCILIATION_REQUIRED', message: 'Reconcile overlapping income.' });
    expect(steps.map(step => step.id)).toEqual(['tax-inputs', 'facts', 'categories']);
    expect(steps[0].screen).toBe('income-tracking'); expect(steps[1].transaction?.id).toBe('question');
    expect(steps[2].title).toBe('Review 1 category');
  });
  it('does not send users to answer records still processing, pending or already resolved', () => {
    const rows = [record('pending', { pending: true }), record('processing', { analysisStatus: 'running' }),
      record('queued', { analysisStatus: 'pending', analysisJobId: 'task' }),
      record('confirmed', { review_status: 'confirmed', is_deductible: false })];
    expect(dashboardNextSteps(rows, { status: 'loading' })).toEqual([]);
  });
  it('keeps a confirmed category with unresolved tax treatment actionable', () => {
    const steps = dashboardNextSteps([record('asset', { review_status: 'confirmed', tax_review_required: true })], { status: 'loading' });
    expect(steps).toHaveLength(1); expect(steps[0].id).toBe('facts');
  });
  it('offers retry and a first-record action without fabricating an estimate', () => {
    const steps = dashboardNextSteps([], { status: 'error', message: 'Unavailable' });
    expect(steps.map(step => step.id)).toEqual(['tax-retry', 'first-record']);
    expect(steps[0].retry).toBe(true); expect(JSON.stringify(steps)).not.toMatch(/\$|savings/i);
  });
});

describe('substantive transaction facts', () => {
  it.each(['business_purpose', 'notes', 'travel_destination', 'client_project', 'meeting_notes', 'documentation_status'])('detects changed %s', field => {
    expect(hasTransactionFactChange({ [field]: 'before' }, { [field]: 'after' })).toBe(true);
  });
  it('ignores workflow, cosmetic and decision changes while recognizing nested fact changes', () => {
    expect(hasTransactionFactChange({}, { attendees: [], equipment_details: { make: '' } })).toBe(false);
    expect(hasTransactionFactChange({}, { analysisStatus: 'completed', is_deductible: true, receipt_url: 'reference', updated_at: 1 })).toBe(false);
    expect(hasTransactionFactChange({ attendees: ['Me', 'Client'], notes: 'Client meeting' }, { attendees: ['Client', 'Me'], notes: ' Client   meeting ' })).toBe(false);
    expect(hasTransactionFactChange({ equipment_details: { business_use_percentage: 100 } }, { equipment_details: { business_use_percentage: 50 } })).toBe(true);
  });
});
