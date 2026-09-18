import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: vi.fn() }));
vi.mock('@/lib/hooks/use-subscription', () => ({ useSubscription: () => ({ canAccess: () => false, isLoading: false }) }));
import { AuditSupportRecordsSummary, type AuditSupportSummary } from '@/app/protected/reports/components/AuditSupportRecordsCard';

const packet: AuditSupportSummary = {
  deductions: [
    { transactionId: 'tx-lodging', date: '2026-03-10', merchant: 'SYNTHETIC-HOTEL', amount: 180, substantiation: { category: 'lodging', label: 'Lodging while traveling', strict: true, status: 'needs_records', missing: ['receipt (required for lodging at any amount)', 'travel dates (departure and return)'], advisories: [] } },
    { transactionId: 'tx-software', date: '2026-03-11', merchant: 'SYNTHETIC-SOFTWARE', amount: 30, substantiation: { category: 'general', label: 'Ordinary business expense', strict: false, status: 'complete', missing: [], advisories: [] } },
  ],
  summary: { deductionCount: 2, recordedAmount: 210, byStatus: { complete: { count: 1, amount: 30 }, needs_records: { count: 1, amount: 180 } },
    byCategory: [], missingItems: [{ item: 'receipt (required for lodging at any amount)', count: 1 }, { item: 'travel dates (departure and return)', count: 1 }],
    excluded: { notConfirmed: 2, reviewRequired: 0, pending: 0, bankRemoved: 0, superseded: 0 },
    mileage: { tripCount: 3, ratedMiles: 120, unratedMiles: 0, unratedTrips: 0, standardMileageAmount: 87, ratesApplied: [0.725], tripsNeedingRecords: 1 } },
};
const noop = () => {};
const render = (overrides: Partial<React.ComponentProps<typeof AuditSupportRecordsSummary>> = {}) => renderToStaticMarkup(
  <AuditSupportRecordsSummary year={2026} packet={packet} loading={false} error={null} canDownloadPdf={false} downloading={null} onDownload={noop} onOpenTransaction={noop} onRetry={noop} {...overrides} />);

describe('audit support records card', () => {
  it('shows complete versus needs-records counts, the items missing records, exclusions and honest copy', () => {
    const html = render();
    for (const text of ['Audit support records', 'Complete', 'Need records', 'SYNTHETIC-HOTEL', 'Missing: receipt (required for lodging at any amount); travel dates (departure and return)', 'Add records for SYNTHETIC-HOTEL',
      '2 deductible records have not been confirmed through the review flow', '3', '120 rated miles', '1 need details', 'not audit representation or a guarantee', 'PDF · Premium']) expect(html).toContain(text);
    expect(html).not.toContain('Add records for SYNTHETIC-SOFTWARE');
    expect(html).not.toMatch(/audit defense|audit protection|guaranteed|maximize/i);
    expect(html.match(/>1</g)?.length).toBeGreaterThanOrEqual(2);
  });
  it('shows the review path for a records-review error and a loading state without counts', () => {
    const errored = render({ packet: null, error: { message: 'Some saved transactions have missing or invalid dates.', code: 'EXPORT_REVIEW_REQUIRED' } });
    expect(errored).toContain('Some saved transactions have missing or invalid dates.'); expect(errored).toContain('href="/protected/transactions"'); expect(errored).toContain('Retry');
    const loading = render({ packet: null, loading: true });
    expect(loading).toContain('Checking your confirmed deductions for 2026'); expect(loading).not.toContain('Need records');
  });
  it('labels the PDF as available when the plan allows it and reports a clean year plainly', () => {
    const html = render({ canDownloadPdf: true, packet: { ...packet, deductions: [packet.deductions[1]], summary: { ...packet.summary, deductionCount: 1, byStatus: { complete: { count: 1, amount: 30 }, needs_records: { count: 0, amount: 0 } }, missingItems: [], excluded: { notConfirmed: 0, reviewRequired: 0, pending: 0, bankRemoved: 0, superseded: 0 } } } });
    expect(html).not.toContain('Premium'); expect(html).toContain('Every confirmed deduction has the records its category requires on file.');
    expect(html).not.toContain('Items that still need records');
  });
});
