import React from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));

import { ExplanationCard } from '@/components/ai/explanation-card';
import { composeExplanation, normalizeExplanation, scheduleCLineFor, type ExplainableResult } from '@/lib/ai/explanation';
import { PROFESSION_PRIORS, type ProfessionMerchantHint } from '@/lib/ai/profession-priors';
import { CATEGORY_SCHEDULE_C_LINE, TRANSACTION_TAX_EVIDENCE } from '@/lib/ai/transaction-tax-policy';
import { assembleAuditSupportPacket, auditSupportPacketCSV, buildEvidenceRecord, type AuditSupportPacket } from '@/lib/reports/audit-support-packet';
import { convertTransactionsToCSV, type ExportRecord } from '@/lib/reports/transaction-export';
import { OTHER_EXPENSES_YEAR_FREE_LINE, scheduleCExportLine } from '@/lib/schedule-c/export-lines';
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
    expect(exportColumns(dues({ date: '2024-06-15', schedule_c_line: '18' }))).toEqual({ recorded: '18', mapped: '27a' });
    expect(exportColumns(dues({ date: '2025-03-01', schedule_c_line: ' 27a ' })).recorded).toBe('27b');
    expect(exportColumns(dues({ date: '2025-03-01', schedule_c_line: 'ask preparer' })).recorded).toBe('ask preparer');
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

  it('prints the year-free wording when the charge date is missing or invalid', () => {
    expect(OTHER_EXPENSES_YEAR_FREE_LINE).toBe(YEAR_FREE);
    const missing = dues();
    delete missing.date;
    delete missing.datetime;
    expect(exportColumns(missing)).toEqual({ recorded: YEAR_FREE, mapped: YEAR_FREE });
    expect(auditLine(missing)).toBe(YEAR_FREE);
    expect(whereItGoes(missing, 2026)).toBe(YEAR_FREE);
    const invalid = dues({ date: 'not-a-date', datetime: '2024-12-31' });
    expect(exportColumns(invalid)).toEqual({ recorded: YEAR_FREE, mapped: YEAR_FREE });
    expect(auditLine(invalid)).toBe(YEAR_FREE);
    expect(whereItGoes({ date: '2025-13-40', datetime: '2026-01-01', created_at: '2026-10-23T00:00:00Z' }, 2026)).toBe(YEAR_FREE);
    expect(whereItGoes({ merchant_name: 'AIGA' }, new Date().getFullYear())).toBe(YEAR_FREE);
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
    expect(scheduleCLineFor(duesResult({ schedule_c_line: undefined }), undefined)).toBe(YEAR_FREE);
    expect(scheduleCLineFor(duesResult({ schedule_c_line: 'line 27a' }), '2025-04-01')).toBe('Schedule C line 27b (Other expenses)');
    expect(scheduleCLineFor(duesResult({ schedule_c_line: 'line 25' }), '2025-04-01')).toBe('Schedule C line 25');
    expect(scheduleCLineFor(duesResult({ schedule_c_line: 'Schedule C line 18 (Office expense)' }), '2025-04-01')).toBe('Schedule C line 18 (Office expense)');
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
    expect(shown('Schedule C line 27a (Other expenses)', undefined)).toBe(YEAR_FREE);
    expect(shown('Schedule C line 27a (other expenses)', '')).toBe(YEAR_FREE);
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
      expect(scheduleCLineFor(duesResult({ schedule_c_line: supplied }), undefined)).toBe(YEAR_FREE);
    }
    expect(exportColumns(dues({ date: '', datetime: '2024-12-31' }))).toEqual({ recorded: YEAR_FREE, mapped: YEAR_FREE });
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
});
