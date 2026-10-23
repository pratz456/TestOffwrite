import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';

const form1040State = vi.hoisted(() => ({ organizer: null as Record<string, unknown> | null }));
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {
  collection: (name: string) => ({
    where() { return this; }, limit() { return this; },
    get: async () => name === 'tax_organizers' && form1040State.organizer
      ? { empty: false, docs: [{ id: 'organizer', data: () => form1040State.organizer }] }
      : { empty: true, docs: [] },
  }),
  doc: () => ({ get: async () => ({ exists: false, data: () => null }) }),
} }));
vi.mock('@/app/api/_lib/auth', () => ({ getUserFromReqOrThrow: async () => ({ uid: 'form-1040-owner' }) }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: async () => ({ user: { uid: 'form-1040-owner' }, error: null }) }));
vi.mock('@/lib/subscriptions/feature-access', () => ({ requireFeatureAccess: async () => null }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
vi.mock('@/lib/firebase/profiles-server', () => ({ getUserProfileServer: async () => ({ data: { name: 'Synthetic Taxpayer', filing_status: 'single' }, error: null }) }));
vi.mock('@/lib/firebase/settings-server', () => ({ getScheduleCSettings: async () => ({ data: { assets: [], homeOffice: null, depreciationElections: { deMinimisSafeHarborYears: [] } }, error: null }) }));
vi.mock('@/lib/firebase/quarterly-payments-server', () => ({ getRecordedQuarterlyPayments: async () => [], totalRecordedPayments: () => 0 }));
vi.mock('@/lib/reports/tax-export-transactions', () => ({ readTaxExportTransactions: async () => [] }));

import { ExplanationCard } from '@/components/ai/explanation-card';
import { composeExplanation, normalizeExplanation, scheduleCLineFor, type ExplainableResult } from '@/lib/ai/explanation';
import { PROFESSION_PRIORS, type ProfessionMerchantHint } from '@/lib/ai/profession-priors';
import { CATEGORY_SCHEDULE_C_LINE, TRANSACTION_TAX_EVIDENCE } from '@/lib/ai/transaction-tax-policy';
import { assembleAuditSupportPacket, auditSupportPacketCSV, buildEvidenceRecord, type AuditSupportPacket } from '@/lib/reports/audit-support-packet';
import { convertTransactionsToCSV, type ExportRecord } from '@/lib/reports/transaction-export';
import { aggregateScheduleC } from '@/lib/schedule-c/aggregate';
import { OTHER_EXPENSES_UNNUMBERED_LABEL, OTHER_EXPENSES_YEAR_FREE_LINE, printedScheduleCLine, scheduleCExportLine } from '@/lib/schedule-c/export-lines';
import { safeTaxYear, safeYMD } from '@/lib/schedule-c/taxDate';
import { POST as form1040 } from '@/app/api/tax/form-1040/route';
import { guidanceSource, GUIDANCE_SOURCES } from '@/lib/tax-assistant/knowledge';

/**
 * User-facing sentences only. Exempt by name:
 * - CATEGORY_SCHEDULE_C_LINE: stored expense-category codes, not sentences.
 * - ProfessionMerchantHint.scheduleCLine: hint routing code, not a sentence.
 * - merchant-intelligence.ts: merchant code table, left out of this scan.
 */
const YEAR_TAG = 'line 27a on 2024 returns';
const YEAR_FREE = 'Schedule C line 27b (other expenses; line 27a on 2024 returns)';
const SAVED_IN_2025 = {
  created_at: '2025-01-15T16:00:00Z',
  updated_at: '2025-01-16T16:00:00Z',
  reviewed_at: '2025-01-16T16:00:00Z',
  ai_last_analyzed_at: '2025-01-16T16:00:00Z',
  uploadedAt: '2025-01-15T16:00:00Z',
  analysisCompletedAt: '2025-01-16T16:00:00Z',
};

function leftover27a(value: string): string {
  return value.split(YEAR_TAG).join('');
}
function assertUserText(value: string, where: string) {
  expect(value, where).not.toContain('before 2025');
  expect(leftover27a(value), where).not.toContain('27a');
}
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1; }
        else quoted = false;
      } else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { cells.push(current); current = ''; }
    else current += char;
  }
  cells.push(current);
  return cells;
}
function csvRow(csv: string): Record<string, string> {
  const [headers, row = ''] = csv.split('\r\n');
  const names = parseCsvLine(headers);
  const cells = parseCsvLine(row);
  return Object.fromEntries(names.map((name, index) => [name, cells[index] ?? '']));
}
function dues(fields: ExportRecord = {}): ExportRecord {
  return {
    id: 'dues-1', trans_id: 'dues-1', amount: 120, iso_currency_code: 'USD', merchant_name: 'AIGA',
    category: 'SERVICE_PROFESSIONAL_DUES', schedule_c_line: '27a', is_deductible: true,
    review_status: 'confirmed', review_source: 'user_corrected', ...SAVED_IN_2025, ...fields,
  };
}
function exportColumns(record: ExportRecord) {
  const row = csvRow(convertTransactionsToCSV([record]));
  return { recorded: row['Recorded Schedule C Line'], mapped: row['Category Mapping (preparer review)'] };
}
function auditLine(record: ExportRecord): string {
  const evidence = buildEvidenceRecord(record, { uid: 'owner', tripsByDate: new Map(), yearTripCount: 0, receiptsByTransaction: new Map() });
  const csv = auditSupportPacketCSV({ deductions: [evidence], mileageLog: { trips: [] } } as unknown as AuditSupportPacket);
  return csvRow(csv)['Schedule C Line'];
}
const source = { id: 'dues-274a3', title: 'Dues', url: 'https://www.irs.gov/publications/p334', edition: 'current', reviewed_at: '2026-09-16' };
function duesResult(overrides: Partial<ExplainableResult> = {}): ExplainableResult {
  return { status: 'ok', transaction_kind: 'expense', category: 'dues_and_memberships', is_deductible: true, schedule_c_line: '27a', sources: [source], ...overrides } as ExplainableResult;
}
function whereItGoes(charge: ExportRecord, taxYear: number | null, result: ExplainableResult = duesResult()) {
  return composeExplanation({ result, transaction: charge, profile: { income: 80000, filing_status: 'single' }, taxYear }).scheduleCLine;
}

afterEach(() => { vi.useRealTimers(); });

describe('printed Other expenses line', () => {
  it('prints 27b for 2025 and 2026 and 27a for 2024 in both transaction export columns', () => {
    for (const date of ['2025-03-01', '2026-03-02']) {
      expect(exportColumns(dues({ date }))).toEqual({ recorded: '27b', mapped: '27b' });
    }
    expect(exportColumns(dues({ date: '2024-06-15' }))).toEqual({ recorded: '27a', mapped: '27a' });
    expect(exportColumns(dues({ date: '2025-01-01', created_at: '2024-12-31T12:00:00Z' }))).toEqual({ recorded: '27b', mapped: '27b' });
  });

  it('maps the recorded code and the category code independently', () => {
    expect(exportColumns(dues({ date: '2025-03-01', category: 'SERVICE_SUBSCRIPTION' }))).toEqual({ recorded: '27b', mapped: '18' });
    expect(exportColumns(dues({ date: '2024-06-15', category: 'SERVICE_SUBSCRIPTION', schedule_c_line: '18' }))).toEqual({ recorded: '18', mapped: '18' });
    expect(exportColumns(dues({ date: '2024-06-15', schedule_c_line: '18' }))).toEqual({ recorded: '27a', mapped: '27a' });
    expect(exportColumns(dues({ date: '2025-03-01', schedule_c_line: ' 27a ' })).recorded).toBe('27b');
    expect(exportColumns(dues({ date: '2025-03-01', category: 'SERVICE_SUBSCRIPTION', schedule_c_line: 'ask preparer' })).recorded).toBe('ask preparer');
    expect(exportColumns(dues({ date: '2025-03-01', schedule_c_line: 'ask preparer' })).recorded).toBe('27b');
  });

  it('prints 27b for 2025 and 2026 and 27a for 2024 on the audit packet CSV', () => {
    expect(auditLine(dues({ date: '2025-03-01' }))).toBe('27b');
    expect(auditLine(dues({ date: '2026-03-02' }))).toBe('27b');
    expect(auditLine(dues({ date: '2024-06-15' }))).toBe('27a');
    const packet = assembleAuditSupportPacket('owner', 2025, { transactions: [dues({ date: '2025-04-02' })], trips: [], receipts: [] }, new Date('2026-02-01T00:00:00Z'));
    expect(packet.deductions[0].scheduleCLine).toBe('27b');
    expect(auditSupportPacketCSV(packet)).toContain(',27b,');
  });

  it('uses the paid or posted date when the record was saved in a later year', () => {
    const december = dues({ date: '2024-12-31' });
    expect(exportColumns(december)).toEqual({ recorded: '27a', mapped: '27a' });
    expect(auditLine(december)).toBe('27a');
    expect(whereItGoes(december, 2025)).toBe('Schedule C line 27a (Other expenses)');
    const posted = dues({ datetime: '2024-12-31T15:00:00Z' });
    delete posted.date;
    expect(exportColumns(posted)).toEqual({ recorded: '27a', mapped: '27a' });
    expect(auditLine(posted)).toBe('27a');
    expect(whereItGoes(posted, 2025)).toBe('Schedule C line 27a (Other expenses)');
  });

  it.each(['2024-07-01', '2026-10-23'])('withholds the line when the charge date is missing or invalid (system time %s)', (day) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${day}T12:00:00.000Z`));
    expect(OTHER_EXPENSES_YEAR_FREE_LINE).toBe(YEAR_FREE);
    const missing = dues();
    delete missing.date;
    delete missing.datetime;
    expect(exportColumns(missing)).toEqual({ recorded: '', mapped: '' });
    expect(auditLine(missing)).toBe('');
    expect(whereItGoes(missing, 2026)).toBeNull();
    expect(csvRow(convertTransactionsToCSV([missing]))['Data Review']).toContain('Needs more information');
    const invalid = dues({ date: 'not-a-date', datetime: '2024-12-31' });
    expect(exportColumns(invalid)).toEqual({ recorded: '', mapped: '' });
    expect(auditLine(invalid)).toBe('');
    expect(whereItGoes({ date: '2025-13-40', datetime: '2026-01-01', created_at: '2026-10-23T00:00:00Z' }, 2026)).toBeNull();
    expect(whereItGoes({ merchant_name: 'AIGA' }, new Date().getFullYear())).toBeNull();
  });

  it('maps a stored code 27b through the same Other expenses printer as 27a', () => {
    expect(printedScheduleCLine('27b', 2024)).toBe('27a');
    expect(printedScheduleCLine('27b', 2025)).toBe('27b');
    expect(printedScheduleCLine('27b', null)).toBe('');
    expect(printedScheduleCLine('27a', 2017)).toBe(OTHER_EXPENSES_UNNUMBERED_LABEL);
    expect(printedScheduleCLine('27a', 2018)).toBe('27a');
    expect(printedScheduleCLine('27a', 2021)).toBe('27a');
    expect(exportColumns(dues({ date: '2024-06-15', schedule_c_line: '27b' }))).toEqual({ recorded: '27a', mapped: '27a' });
    expect(exportColumns(dues({ date: '2025-04-01', schedule_c_line: '27b' }))).toEqual({ recorded: '27b', mapped: '27b' });
    const missing = dues({ schedule_c_line: '27b' });
    delete missing.date;
    delete missing.datetime;
    expect(exportColumns(missing)).toEqual({ recorded: '', mapped: '' });
    expect(printedScheduleCLine('18', 2024)).toBe('18');
    expect(printedScheduleCLine('18', null)).toBe('18');
  });

  it('keeps a non-27a line when the charge date is missing', () => {
    const software = dues({ category: 'SERVICE_SUBSCRIPTION', schedule_c_line: '18' });
    delete software.date;
    expect(exportColumns(software)).toEqual({ recorded: '18', mapped: '18' });
    expect(whereItGoes({ created_at: '2026-10-23T00:00:00Z' }, 2026, duesResult({ schedule_c_line: undefined, category: 'software_subscriptions' }))).toBe('Schedule C line 18 (Office expense)');
  });

  it('writes Where it goes from the charge date, including the category fallback and the card', () => {
    expect(whereItGoes({ date: '2025-06-01', created_at: '2024-01-01T00:00:00Z' }, 2024)).toBe('Schedule C line 27b (Other expenses)');
    expect(whereItGoes({ date: '2024-06-15' }, 2026)).toBe('Schedule C line 27a (Other expenses)');
    expect(scheduleCLineFor(duesResult({ schedule_c_line: undefined }), '2025-04-01')).toBe('Schedule C line 27b (Other expenses)');
    expect(scheduleCLineFor(duesResult({ schedule_c_line: undefined }), '2024-12-15')).toBe('Schedule C line 27a (Other expenses)');
    expect(scheduleCLineFor(duesResult({ schedule_c_line: undefined }), '2018-06-15')).toBe('Schedule C line 27a (Other expenses)');
    expect(scheduleCLineFor(duesResult({ schedule_c_line: undefined }), '2017-06-15')).toBe(OTHER_EXPENSES_UNNUMBERED_LABEL);
    expect(scheduleCLineFor(duesResult({ schedule_c_line: undefined }), undefined)).toBeNull();
    expect(scheduleCLineFor(duesResult({ schedule_c_line: 'line 27a' }), '2025-04-01')).toBe('Schedule C line 27b (Other expenses)');
    expect(scheduleCLineFor(duesResult({ category: 'utilities_phone_internet', schedule_c_line: 'line 25' }), '2025-04-01')).toBe('Schedule C line 25');
    expect(scheduleCLineFor(duesResult({ category: 'software_subscriptions', schedule_c_line: 'Schedule C line 18 (Office expense)' }), '2025-04-01')).toBe('Schedule C line 18 (Office expense)');
    const html = renderToStaticMarkup(<ExplanationCard explanation={composeExplanation({
      result: duesResult(), transaction: { date: '2025-06-01', merchant_name: 'AIGA', amount: 120, iso_currency_code: 'USD' },
      profile: { income: 80000, filing_status: 'single' }, taxYear: 2024,
    })} />);
    expect(html).toContain('Where it goes:');
    expect(html).toContain('Schedule C line 27b (Other expenses)');
    const older = renderToStaticMarkup(<ExplanationCard explanation={composeExplanation({
      result: duesResult(), transaction: { date: '2024-12-31', merchant_name: 'AIGA', amount: 120, iso_currency_code: 'USD' },
      profile: { income: 80000, filing_status: 'single' }, taxYear: 2025,
    })} />);
    expect(older).toContain('Where it goes:');
    expect(older).toContain('Schedule C line 27a (Other expenses)');
  });
});

describe('stored and supplied Other expenses sentences', () => {
  const saved = {
    headline: 'Likely deductible: Professional dues',
    why: 'Association dues for the design business are an ordinary expense when the membership serves the work.',
  };
  const shown = (scheduleCLine: string, chargeDate: unknown) =>
    normalizeExplanation({ ...saved, scheduleCLine }, { chargeDate })?.scheduleCLine;

  it('reprints a stored 27a sentence from the charge date and leaves other stored lines', () => {
    expect(shown('Schedule C line 27a (Other expenses)', '2025-06-01')).toBe('Schedule C line 27b (Other expenses)');
    expect(shown('schedule c line 27a', '2024-12-31')).toBe('Schedule C line 27a (Other expenses)');
    expect(shown('Schedule C line 27a (Other expenses)', '2018-06-15')).toBe('Schedule C line 27a (Other expenses)');
    expect(shown('Schedule C line 27a (Other expenses)', '2017-06-15')).toBe(OTHER_EXPENSES_UNNUMBERED_LABEL);
    expect(shown('Schedule C line 27a (Other expenses)', undefined)).toBeNull();
    expect(shown('Schedule C line 27a (other expenses)', '')).toBeNull();
    expect(shown('Schedule C line 18 (Office expense)', '2025-06-01')).toBe('Schedule C line 18 (Office expense)');
    expect(normalizeExplanation({ ...saved, scheduleCLine: 'Schedule C line 27a (Other expenses)' })?.scheduleCLine).toBe('Schedule C line 27a (Other expenses)');
    const html = renderToStaticMarkup(<ExplanationCard explanation={normalizeExplanation({ ...saved, scheduleCLine: 'Schedule C line 27a (Other expenses)' }, { chargeDate: '2025-03-02' })} />);
    expect(html).toContain('Where it goes:');
    expect(html).toContain('Schedule C line 27b (Other expenses)');
  });

  it('routes a supplied 27a sentence through the charge date', () => {
    for (const supplied of ['Schedule C line 27a (Other expenses)', 'line 27a (other expenses)']) {
      expect(scheduleCLineFor(duesResult({ schedule_c_line: supplied }), '2025-04-01')).toBe('Schedule C line 27b (Other expenses)');
      expect(scheduleCLineFor(duesResult({ schedule_c_line: supplied }), '2024-12-31')).toBe('Schedule C line 27a (Other expenses)');
      expect(scheduleCLineFor(duesResult({ schedule_c_line: supplied }), undefined)).toBeNull();
    }
    expect(exportColumns(dues({ date: '', datetime: '2024-12-31' }))).toEqual({ recorded: '', mapped: '' });
  });

  it('prints a bare supplied 27b through lineSentence for the charge year', () => {
    for (const supplied of ['27b', '27B', '  27b  ', 'line 27b', 'LINE   27B', 'Schedule C line 27b', 'schedule   c   line   27b', 'Schedule C line 27b (Other expenses)']) {
      expect(scheduleCLineFor(duesResult({ schedule_c_line: supplied }), '2024-06-01')).toBe('Schedule C line 27a (Other expenses)');
      expect(scheduleCLineFor(duesResult({ schedule_c_line: supplied }), '2025-06-01')).toBe('Schedule C line 27b (Other expenses)');
      expect(scheduleCLineFor(duesResult({ schedule_c_line: supplied }), undefined)).toBeNull();
    }
  });

  it('reprints a stored 27b card from the charge date when that date changes', () => {
    const card = (scheduleCLine: string, chargeDate: string) => renderToStaticMarkup(
      <ExplanationCard explanation={normalizeExplanation({ ...saved, scheduleCLine }, { chargeDate })} />,
    );
    for (const stored of ['27b (Other expenses)', '27B (Other expenses)', 'Schedule C line 27b (Other expenses)', '27b(Other expenses)']) {
      const older = card(stored, '2024-06-01');
      expect(older).toContain('Where it goes:');
      expect(older).toContain('Schedule C line 27a (Other expenses)');
      expect(older).not.toContain('27b');
      const newer = card(stored, '2025-06-01');
      expect(newer).toContain('Where it goes:');
      expect(newer).toContain('Schedule C line 27b (Other expenses)');
    }
  });

  it('prints a stored schedule_c_line of 27b on the transaction CSV by charge year', () => {
    const older = convertTransactionsToCSV([dues({ date: '2024-06-01', schedule_c_line: '27b' })]);
    expect(older.split('\r\n')[1]).toContain(',27a,27a,');
    expect(csvRow(older)['Recorded Schedule C Line']).toBe('27a');
    const newer = convertTransactionsToCSV([dues({ date: '2025-06-01', schedule_c_line: '27b' })]);
    expect(newer.split('\r\n')[1]).toContain(',27b,27b,');
    expect(csvRow(newer)['Recorded Schedule C Line']).toBe('27b');
    const missing = dues({ schedule_c_line: '27b' });
    delete missing.date;
    delete missing.datetime;
    const undated = convertTransactionsToCSV([missing]);
    expect(csvRow(undated)['Recorded Schedule C Line']).toBe('');
    expect(csvRow(undated)['Data Review']).toContain('Needs more information');
    expect(undated).not.toContain(YEAR_FREE);
  });

  it('treats a supplied 27b as Other expenses on every result path', () => {
    for (const supplied of ['27b', '27B', 'line 27b', 'LINE 27B (other expenses)', 'Schedule C line 27b', 'schedule c line 27b (Other expenses)']) {
      expect(scheduleCLineFor(duesResult({ schedule_c_line: supplied }), '2024-06-15')).toBe('Schedule C line 27a (Other expenses)');
      expect(scheduleCLineFor(duesResult({ schedule_c_line: supplied }), '2025-04-01')).toBe('Schedule C line 27b (Other expenses)');
      expect(scheduleCLineFor(duesResult({ schedule_c_line: supplied }), undefined)).toBeNull();
    }
    expect(scheduleCLineFor(duesResult({ status: 'blocked', schedule_c_line: '27b', missing_fields: ['supported_tax_year'] }), '2024-12-31')).toBe('Schedule C line 27a (Other expenses)');
    expect(scheduleCLineFor(duesResult({ is_deductible: false, schedule_c_line: 'line 27b' }), '2025-04-01')).toBe('Schedule C line 27b (Other expenses)');
    expect(scheduleCLineFor(duesResult({ transaction_kind: undefined, schedule_c_line: 'Schedule C line 27b' }), undefined)).toBeNull();
    expect(scheduleCLineFor(duesResult({ category: 'software_subscriptions', schedule_c_line: '18' }), '2024-06-15')).toBe('Schedule C line 18 (Office expense)');
    expect(scheduleCLineFor(duesResult({ category: 'software_subscriptions', schedule_c_line: 'Schedule C line 18 (Office expense)' }), '2025-04-01')).toBe('Schedule C line 18 (Office expense)');
  });

  it('reprints a stored 27b sentence from the charge date and leaves the year-free sentence unchanged', () => {
    expect(shown('Schedule C line 27b (Other expenses)', '2024-06-15')).toBe('Schedule C line 27a (Other expenses)');
    expect(shown('schedule c line 27b', '2025-04-01')).toBe('Schedule C line 27b (Other expenses)');
    expect(shown('Schedule C line 27b (other expenses)', undefined)).toBeNull();
    expect(shown('Schedule C line 18 (Office expense)', '2025-04-01')).toBe('Schedule C line 18 (Office expense)');
  });

  it('sends the exact year-free sentence to Needs more information', () => {
    const exact = 'Schedule C line 27b (other expenses; line 27a on 2024 returns)';
    expect(exact).toBe(OTHER_EXPENSES_YEAR_FREE_LINE);
    for (const chargeDate of ['2024-06-01', '2025-06-01', undefined]) {
      let card = normalizeExplanation({ ...saved, scheduleCLine: exact }, { chargeDate });
      for (let pass = 0; pass < 3; pass += 1) {
        expect(card?.scheduleCLine ?? null).toBeNull();
        expect(card?.headline).toBe('Needs more information');
        card = normalizeExplanation(card, { chargeDate });
      }
      const html = renderToStaticMarkup(<ExplanationCard explanation={normalizeExplanation({ ...saved, scheduleCLine: exact }, { chargeDate })} />);
      expect(html).toContain('Needs more information');
      expect(html).not.toContain('Where it goes:');
    }
    expect(scheduleCLineFor(duesResult({ category: 'software_subscriptions', schedule_c_line: exact }), '2024-06-01')).toBeNull();
  });
});

describe('year-free Other expenses copy', () => {
  it('tags every covered 27a mention for 2024 and keeps startup costs exact', () => {
    expect(guidanceSource('startup-costs')?.placement).toBe(`${YEAR_FREE} for the first-year amount; ongoing amortization from Form 4562 Part VI also goes in Part V, other expenses.`);
    for (const source of GUIDANCE_SOURCES) {
      if (source.placement) assertUserText(source.placement, `placement ${source.id}`);
    }
    const coveredIds = new Set(['education-reg-1.162-5', 'bank-fees-334', 'dues-274a3', 'gifts-274b']);
    for (const item of TRANSACTION_TAX_EVIDENCE) {
      const evidence = item as { id: string; edition: string; rule: string; notes?: string };
      for (const field of ['edition', 'rule', 'notes'] as const) {
        const value = evidence[field];
        if (value) assertUserText(value, `${evidence.id} ${field}`);
      }
      if (coveredIds.has(evidence.id)) expect(evidence.edition + evidence.rule).toContain(YEAR_TAG);
    }
    for (const prior of PROFESSION_PRIORS) {
      for (const value of [prior.label, prior.summary, prior.notes ?? '', ...prior.auditTraps, ...prior.typical.map(item => item.nuance)]) {
        assertUserText(value, prior.id);
      }
      for (const hint of Object.values(prior.hints ?? {})) {
        if (hint) assertUserText(hint.question, `${prior.id} hint`);
      }
    }
  });

  it('would reject the internal code table and a hint line code under the same user-text rule', () => {
    expect(CATEGORY_SCHEDULE_C_LINE.education_training).toBe('27a');
    expect(CATEGORY_SCHEDULE_C_LINE.dues_and_memberships).toBe('27a');
    expect(() => assertUserText(CATEGORY_SCHEDULE_C_LINE.dues_and_memberships ?? '', 'CATEGORY_SCHEDULE_C_LINE')).toThrow();
    const hint: ProfessionMerchantHint = { scheduleCLine: '27a', question: 'Was this a business dues payment?' };
    expect(() => assertUserText(hint.scheduleCLine ?? '', 'ProfessionMerchantHint.scheduleCLine')).toThrow();
    assertUserText(hint.question, 'ProfessionMerchantHint.question');
  });
});

describe('Form 1040 earned income credit', () => {
  it('still uses line 27a for 2025 on Form 1040', () => {
    const route = readFileSync(new URL('../app/api/tax/form-1040/route.ts', import.meta.url), 'utf8');
    expect(route).toContain("const eicLine = Number(yr) >= 2025 ? '27a' : '27';");
    expect(route).toContain("y = row(p, eicLine, 'Earned income credit (EIC)', y, d.eitcCredit, f, bf, true);");
    expect(scheduleCExportLine('27a', 2024)).toBe('27a');
    expect(scheduleCExportLine('27a', 2025)).toBe('27b');
  });

  it('prints line 27a on the 2025 Earned income credit row', async () => {
    form1040State.organizer = { userId: 'form-1040-owner', ...reviewedPersonalDeductionOrganizer(2025) };
    const spy = vi.spyOn(PDFPage.prototype, 'drawText');
    const response = await form1040(new NextRequest('http://localhost/api/tax/form-1040', { method: 'POST', body: JSON.stringify({ year: 2025 }) }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(2);
    const drawn = spy.mock.calls.map(call => String(call[0]));
    const eic = drawn.indexOf('Earned income credit (EIC)');
    expect(eic).toBeGreaterThan(0);
    expect(drawn[eic - 1]).toBe('27a');
    expect(drawn).toContain('Total payments. Add lines 25d, 26, 27a, 28.');
  });
});

const SAVED_CARD = {
  headline: 'Likely deductible: Professional dues',
  why: 'Association dues for the design business are an ordinary expense when the membership serves the work.',
};

function expectWithheld(record: ExportRecord, year: string) {
  const category = record.category === 'SERVICE_PROFESSIONAL_DUES' ? 'dues_and_memberships' : undefined;
  const explanation = composeExplanation({
    result: duesResult({ schedule_c_line: String(record.schedule_c_line), ...(category ? { category } : { category: undefined }) }),
    transaction: record,
    profile: { income: 80000, filing_status: 'single' },
    taxYear: Number(year),
  });
  expect(explanation.scheduleCLine).toBeNull();
  expect(explanation.headline).toContain('Needs more information');
  const html = renderToStaticMarkup(<ExplanationCard explanation={explanation} />);
  expect(html).not.toContain('Where it goes:');
  expect(html).not.toContain('Schedule C line 27');
  expect(html).not.toContain('Schedule C Line 27');
  const saved = normalizeExplanation({ ...SAVED_CARD, scheduleCLine: String(record.schedule_c_line) }, {
    chargeDate: record.date, category: record.category,
  });
  expect(saved?.scheduleCLine).toBeNull();
  expect(saved?.headline).toBe('Needs more information');
  expect(renderToStaticMarkup(<ExplanationCard explanation={saved} />)).not.toContain('Where it goes:');
  expect(csvRow(convertTransactionsToCSV([record]))['Recorded Schedule C Line']).toBe('');
  for (const mode of ['confirmed-only', 'default'] as const) {
    const totals = aggregateScheduleC([record as never], year, undefined, { mode });
    expect(totals.totalDeductible).toBe(0);
    expect(totals.totalExpenses).toBe(0);
  }
}

describe('energy labels and unknown parentheticals', () => {
  const years = (label: string, dates: Array<[string, string]>) => dates.map(([id, date]) => ({ id, date, label, year: date.slice(0, 4) }));
  const probes = [
    ...years('27a (Energy efficient commercial buildings)', [['A2-069', '2022-06-15'], ['A2-070', '2023-06-15'], ['A2-071', '2024-06-15'], ['A2-072', '2025-06-15'], ['A2-073', '2026-06-15']]),
    ...years('27a (179D)', [['A2-074', '2022-06-15'], ['A2-075', '2023-06-15'], ['A2-076', '2024-06-15'], ['A2-077', '2025-06-15'], ['A2-078', '2026-06-15']]),
    ...years('Line 27a (Form 7205)', [['A2-079', '2022-06-15'], ['A2-080', '2023-06-15'], ['A2-081', '2024-06-15'], ['A2-082', '2025-06-15'], ['A2-083', '2026-06-15']]),
  ];

  it.each(probes)('$id withholds $label for $date', ({ label, date, year }) => {
    expectWithheld(dues({ date, schedule_c_line: label }), year);
  });

  it('A2-102 keeps a confirmed 2024 dues row labeled 27a (179D) out of the total', () => {
    expectWithheld(dues({ date: '2024-06-15', schedule_c_line: '27a (179D)', review_status: 'confirmed' }), '2024');
  });

  it('keeps the unconfirmed twin of A2-102 in Needs more information', () => {
    expectWithheld(dues({ date: '2024-06-15', schedule_c_line: '27a (179D)', review_status: 'pending' }), '2024');
  });

  it('A2-103 withholds a label-only unknown parenthetical and counts it in no total', () => {
    const row = dues({ date: '2024-06-15', schedule_c_line: '27a (Synthetic unknown note)' });
    delete row.category;
    expectWithheld(row, '2024');
  });

  it('A-283 keeps a confirmed 2025 energy dues row out of the aggregateScheduleC total', () => {
    const row = dues({ date: '2025-06-15', schedule_c_line: '27a (Energy efficient commercial buildings)', amount: 480, review_status: 'confirmed' });
    expectWithheld(row, '2025');
    const totals = aggregateScheduleC([row as never], '2025', undefined, { mode: 'confirmed-only' });
    expect(totals.totalDeductible).toBe(0);
    expect(totals.lineItems['27a']).toBeUndefined();
    expect(totals.lineItems['27b']).toBeUndefined();
  });

  it('prints 27a for 2018 through 2021 and no line number for 2017', () => {
    expect(scheduleCExportLine('27a', 2017)).toBe(OTHER_EXPENSES_UNNUMBERED_LABEL);
    expect(scheduleCExportLine('27a', 2018)).toBe('27a');
    expect(scheduleCExportLine('27a', 2021)).toBe('27a');
    const older = dues({ date: '2017-06-15', schedule_c_line: '27a' });
    expect(exportColumns(older)).toEqual({ recorded: OTHER_EXPENSES_UNNUMBERED_LABEL, mapped: OTHER_EXPENSES_UNNUMBERED_LABEL });
    expect(whereItGoes(older, 2017)).toBe(OTHER_EXPENSES_UNNUMBERED_LABEL);
    expect(whereItGoes(older, 2017)).not.toMatch(/27a|27b/);
    const saved2017 = normalizeExplanation({ ...SAVED_CARD, scheduleCLine: 'Schedule C line 27a (Other expenses)' }, { chargeDate: '2017-06-15' });
    expect(saved2017?.scheduleCLine).toBe(OTHER_EXPENSES_UNNUMBERED_LABEL);
    const numbered = dues({ date: '2018-06-15', schedule_c_line: '27a' });
    expect(exportColumns(numbered)).toEqual({ recorded: '27a', mapped: '27a' });
    expect(whereItGoes(numbered, 2018)).toBe('Schedule C line 27a (Other expenses)');
    const saved2018 = normalizeExplanation({ ...SAVED_CARD, scheduleCLine: '27a' }, { chargeDate: '2018-06-15' });
    expect(saved2018?.scheduleCLine).toBe('Schedule C line 27a (Other expenses)');
    expect(exportColumns(dues({ date: '2021-06-15' })).recorded).toBe('27a');
    const totals = aggregateScheduleC([older as never], '2017', undefined, { mode: 'confirmed-only' });
    expect(totals.totalDeductible).toBe(120);
    expect(aggregateScheduleC([numbered as never], '2018', undefined, { mode: 'confirmed-only' }).totalDeductible).toBe(120);
  });

  it('rejects an impossible calendar day and keeps a real leap day', () => {
    expect(safeYMD('2025-02-30')).toBeNull();
    expect(safeYMD('2025-13-01')).toBeNull();
    expect(safeYMD('2024-02-29')).toBe('2024-02-29');
    expect(safeYMD('2025-02-29')).toBeNull();
    expect(safeTaxYear('2025-02-30')).toBeNull();
    expect(whereItGoes(dues({ date: '2024-02-29' }), 2024)).toBe('Schedule C line 27a (Other expenses)');
    expect(whereItGoes(dues({ date: '2025-02-29' }), 2025)).toBeNull();
    expect(exportColumns(dues({ date: '2025-02-30' }))).toEqual({ recorded: '', mapped: '' });
  });

  it('prints an allowlisted label by year and withholds it when the date is missing', () => {
    for (const label of ['27B', 'Line 27b', '27 b', '27b(Other expenses)']) {
      expect(scheduleCLineFor(duesResult({ category: 'software_subscriptions', schedule_c_line: label }), '2024-06-15')).toBe('Schedule C line 27a (Other expenses)');
      expect(scheduleCLineFor(duesResult({ category: 'software_subscriptions', schedule_c_line: label }), '2025-06-15')).toBe('Schedule C line 27b (Other expenses)');
      expect(scheduleCLineFor(duesResult({ category: 'software_subscriptions', schedule_c_line: label }), undefined)).toBeNull();
      expect(normalizeExplanation({ ...SAVED_CARD, scheduleCLine: label }, { chargeDate: '2024-06-15' })?.scheduleCLine).toBe('Schedule C line 27a (Other expenses)');
      expect(normalizeExplanation({ ...SAVED_CARD, scheduleCLine: label }, { chargeDate: '2025-06-15' })?.scheduleCLine).toBe('Schedule C line 27b (Other expenses)');
      expect(normalizeExplanation({ ...SAVED_CARD, scheduleCLine: label }, { chargeDate: undefined })?.scheduleCLine).toBeNull();
      expect(exportColumns(dues({ date: '2024-06-15', category: 'SERVICE_SUBSCRIPTION', schedule_c_line: label })).recorded).toBe('27a');
      expect(exportColumns(dues({ date: '2025-06-15', category: 'SERVICE_SUBSCRIPTION', schedule_c_line: label })).recorded).toBe('27b');
      const undated = dues({ category: 'SERVICE_SUBSCRIPTION', schedule_c_line: label });
      delete undated.date;
      delete undated.datetime;
      expect(exportColumns(undated).recorded).toBe('');
    }
  });
});
