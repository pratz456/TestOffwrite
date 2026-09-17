import { decryptSensitive, isEncrypted, formatSSNForDisplay } from '@/lib/security/utils';
import { requireFeatureAccess } from '@/lib/subscriptions/feature-access';
/**
 * Form 1040 (U.S. Individual Income Tax Return) PDF Export
 * Generates a 2-page federal planning summary using reviewed WriteOff data.
 * Uses the published 2025 form layout for 2026 planning, not a final 2026 IRS form.
 * POST body: { year: number }
 * Sources: IRS Rev. Proc. 2024-40, OBBB P.L. 119-21, IRS Form 1040 instructions
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { buildFederalTaxSnapshot } from '@/lib/tax-rules/federal-tax-snapshot';
import { IncomeReconciliationRequiredError } from '@/lib/tax-rules/business-income';
import { FilingStatusReviewRequiredError } from '@/lib/tax-rules/filing-status';
import { SocialSecurityReviewRequiredError } from '@/lib/tax-rules/social-security';
import { PersonalDeductionReviewRequiredError } from '@/lib/tax-rules/personal-deductions';
import { DependentCreditReviewRequiredError } from '@/lib/tax-rules/credit-scope';
import { CapitalGainReviewRequiredError } from '@/lib/tax-rules/capital-gains';
import { BusinessLossReviewRequiredError } from '@/lib/tax-rules/business-losses';
import { OBBBADeductionReviewRequiredError } from '@/lib/tax-rules/obbba-deductions';
import { createPlanningPDF } from '@/lib/reports/planning-pdf';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { readTaxExportTransactions } from '@/lib/reports/tax-export-transactions';
import { ExportReviewRequiredError } from '@/lib/reports/transaction-export';
import { ExportDataUnavailableError } from '@/lib/reports/export-records';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { getRecordedQuarterlyPayments, totalRecordedPayments } from '@/lib/firebase/quarterly-payments-server';
import { getFederalTaxRules, SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';
import { getScheduleCSettings } from '@/lib/firebase/settings-server';
import { readIncomeReconciliationDecisions } from '@/lib/firebase/income-reconciliations-server';
import { incomeReconciliationReviewBody } from '@/lib/tax-rules/income-reconciliation-response';
import { scheduleCReviewCode } from '@/lib/tax-rules/schedule-c-profit';

const PW = 612, PH = 792, ML = 36, MR = 576, MT = 756;
const BLACK  = rgb(0, 0, 0);
const GRAY   = rgb(0.45, 0.45, 0.45);
const LTGRAY = rgb(0.80, 0.80, 0.80);
const WHITE  = rgb(1, 1, 1);
const BLUE   = rgb(0.10, 0.28, 0.56);
const GOLD   = rgb(1, 0.85, 0);
const HDRBLK = rgb(0.08, 0.08, 0.08);
const SHADE  = rgb(0.94, 0.94, 0.94);
const FILLED = rgb(0.93, 0.96, 1.0);

function tw(f: PDFFont, t: string, s: number) { return f.widthOfTextAtSize(t, s); }
function drawR(p: PDFPage, t: string, xR: number, y: number, s: number, f: PDFFont, c = BLACK) {
  p.drawText(t, { x: xR - tw(f, t, s), y, size: s, font: f, color: c });
}
function hl(p: PDFPage, y: number, x1 = ML, x2 = MR, th = 0.4, c = LTGRAY) {
  p.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: th, color: c });
}
function vl(p: PDFPage, x: number, y1: number, y2: number) {
  p.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: 0.5, color: BLACK });
}
function box(p: PDFPage, x: number, y: number, w: number, h: number, val: string, f: PDFFont, bf: PDFFont) {
  const filled = !!val;
  p.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: filled ? BLUE : LTGRAY, borderWidth: filled ? 0.75 : 0.4, color: filled ? FILLED : WHITE });
  if (filled) drawR(p, val, x + w - 3, y - h + (h - 8) / 2, 8.5, bf, BLUE);
}
function field(p: PDFPage, lbl: string, x: number, y: number, w: number, val: string, f: PDFFont, bf: PDFFont) {
  p.drawText(lbl, { x, y: y + 1, size: 5.5, font: f, color: GRAY });
  hl(p, y - 10, x, x + w, 0.6, BLACK);
  if (val) {
    let visible = String(val);
    try { bf.encodeText(visible); } catch { visible = '[See identity appendix]'; }
    if (tw(bf, visible, 8) > w - 4) {
      while (visible.length && tw(bf, visible + '...', 8) > w - 4) visible = visible.slice(0, -1);
      visible += '...';
    }
    p.drawText(visible, { x: x + 2, y: y - 9, size: 8, font: bf, color: BLACK });
  }
}
function fmtN(n: number | undefined): string {
  if (!n) return '';
  if (n < 0) return `-$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}
function row(p: PDFPage, num: string, lbl: string, y: number, val: number | undefined, f: PDFFont, bf: PDFFont, shade = false, bold = false): number {
  const H = 13, BW = 100;
  if (shade) p.drawRectangle({ x: ML, y: y - H, width: MR - ML, height: H, color: SHADE });
  drawR(p, num, ML + 20, y - 9, 7, f, GRAY);
  p.drawText(lbl, { x: ML + 24, y: y - 9, size: 7.5, font: bold ? bf : f, color: BLACK });
  box(p, MR - BW, y, BW, H, fmtN(val), f, bf);
  hl(p, y - H);
  return y - H;
}
function hrow(p: PDFPage, num: string, lbl: string, y: number, val: number | undefined, f: PDFFont, bf: PDFFont, bg: ReturnType<typeof rgb>, bc: ReturnType<typeof rgb>): number {
  const H = 15, BW = 100;
  p.drawRectangle({ x: ML, y: y - H, width: MR - ML, height: H, color: bg });
  drawR(p, num, ML + 20, y - 11, 7, bf, GRAY);
  p.drawText(lbl, { x: ML + 24, y: y - 11, size: 7.5, font: bf, color: BLACK });
  box(p, MR - BW, y, BW, H, fmtN(val), f, bf);
  hl(p, y - H, ML, MR, 0.7, bc);
  return y - H;
}
function banner(p: PDFPage, lbl: string, y: number, f: PDFFont, bf: PDFFont): number {
  p.drawRectangle({ x: ML, y: y - 13, width: MR - ML, height: 13, color: BLUE });
  p.drawText(lbl, { x: ML + 4, y: y - 9.5, size: 8, font: bf, color: WHITE });
  return y - 15;
}
function footer(p: PDFPage, pg: number, tot: number, yr: string, f: PDFFont) {
  hl(p, 28, ML, MR, 0.5, LTGRAY);
  p.drawText(`Form 1040 (${yr})  |  Pre-filled by WriteOff  |  Not an official IRS form. Review with a tax professional before filing.`, { x: ML, y: 19, size: 6, font: f, color: GRAY });
  drawR(p, `Page ${pg} of ${tot}`, MR, 19, 6, f, GRAY);
}

/** Warnings are free text from the calculation; keep every character encodable in the standard font. */
function safeText(f: PDFFont, value: unknown): string {
  return Array.from(String(value ?? '').replace(/\s+/g, ' ').trim()).map(char => {
    try { f.encodeText(char); return char; } catch { return `[U+${char.codePointAt(0)!.toString(16).toUpperCase()}]`; }
  }).join('');
}
function wrapText(f: PDFFont, value: string, size: number, available: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of value.split(' ')) {
    if (!word) continue;
    const candidate = line ? `${line} ${word}` : word;
    if (tw(f, candidate, size) <= available) { line = candidate; continue; }
    if (line) lines.push(line);
    line = '';
    for (const char of word) {
      if (line && tw(f, line + char, size) > available) { lines.push(line); line = ''; }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}
/** Review-notes block on the form page: lists every calculation warning next to the figures it qualifies. */
const REVIEW_NOTES_BOTTOM = 48;
function reviewNotes(p: PDFPage, warnings: string[], y: number, f: PDFFont, bf: PDFFont, appendixPage: number): number {
  const notes = [...new Set(warnings.map(warning => safeText(f, warning)).filter(Boolean))];
  y = banner(p, `Review notes (${notes.length})`, y, f, bf);
  const size = 7, lineHeight = 9.5, indent = 14;
  const pointer = `Full list continues in the review notes appendix (page ${appendixPage}).`;
  if (notes.length === 0) {
    p.drawText('No calculation limits were reported for the saved inputs. The preparer review items in the appendix still apply.', { x: ML, y: y - 8, size, font: f, color: BLACK });
    return y - lineHeight - 4;
  }
  for (const [index, note] of notes.entries()) {
    const lines = wrapText(f, note, size, MR - ML - indent);
    const remaining = index < notes.length - 1;
    // Keep room for the pointer line so a long list never runs into the footer.
    if (y - lines.length * lineHeight - (remaining ? lineHeight : 0) < REVIEW_NOTES_BOTTOM) {
      p.drawText(pointer, { x: ML, y: y - 8, size, font: bf, color: BLUE });
      return y - lineHeight;
    }
    p.drawText(`${index + 1}.`, { x: ML, y: y - 8, size, font: bf, color: GRAY });
    for (const line of lines) {
      p.drawText(line, { x: ML + indent, y: y - 8, size, font: f, color: BLACK });
      y -= lineHeight;
    }
    y -= 2;
  }
  return y;
}

async function page1(doc: PDFDocument, f: PDFFont, bf: PDFFont, d: Record<string, any>, profile: Record<string, any>, yr: string): Promise<PDFPage> {
  const p = doc.addPage([PW, PH]);
  let y = MT;

  // Banner
  p.drawRectangle({ x: ML, y: y - 13, width: MR - ML, height: 13, color: BLUE });
  p.drawText(`WRITEOFF PLANNING SUMMARY  |  Tax Year ${yr}  |  ${Number(yr) >= 2026 ? '2025 form layout; review before filing' : 'Review all entries before filing'}`, { x: ML + 4, y: y - 9.5, size: 6.5, font: bf, color: WHITE });
  y -= 17;

  // IRS Header
  p.drawRectangle({ x: ML, y: y - 38, width: MR - ML, height: 38, color: HDRBLK });
  p.drawText('Form', { x: ML + 4, y: y - 11, size: 7, font: f, color: rgb(0.7, 0.7, 0.7) });
  p.drawText('1040', { x: ML + 4, y: y - 24, size: 18, font: bf, color: WHITE });
  p.drawText('Federal estimate - preparer summary', { x: ML + 70, y: y - 12, size: 10, font: bf, color: WHITE });
  p.drawText('NOT FOR FILING - incomplete tax-return information', { x: ML + 70, y: y - 22, size: 7, font: f, color: rgb(0.6, 0.6, 0.6) });
  p.drawText(`For the year Jan. 1-Dec. 31, ${yr}`, { x: ML + 70, y: y - 31, size: 6, font: f, color: rgb(0.55, 0.55, 0.55) });
  p.drawText('WriteOff draft', { x: MR - 80, y: y - 11, size: 7, font: bf, color: WHITE });
  p.drawText(yr, { x: MR - 50, y: y - 26, size: 14, font: bf, color: GOLD });
  y -= 42;

  // Name/SSN
  hl(p, y, ML, MR, 0.5, BLACK); y -= 1;
  field(p, 'Full name as saved (verify legal return name)', ML, y - 2, 370, profile.name || '', f, bf);
  vl(p, ML + 374, y, y - 16);
  field(p, 'Social security number', ML + 377, y - 2, 159, profile.ssn || '___-__-____', f, bf);
  hl(p, y - 16, ML, MR, 0.5, BLACK); y -= 20;

  if (profile.filing_status === 'married_filing_jointly' || profile.filing_status === 'married_filing_separately') {
    field(p, 'Spouse full name as saved', ML, y - 2, 370, profile.spouseName || '', f, bf);
    field(p, 'Spouse SSN', ML + 377, y - 2, 159, profile.spouseSSN || '', f, bf);
    hl(p, y - 16, ML, MR, 0.5, BLACK); y -= 20;
  }
  field(p, 'Home address', ML, y - 2, 430, profile.mailing_address?.street || '', f, bf);
  vl(p, ML + 435, y, y - 16);
  field(p, 'Apt. no.', ML + 438, y - 2, 98, '', f, bf);
  hl(p, y - 16, ML, MR, 0.5, BLACK); y -= 20;

  field(p, 'City, town', ML, y - 2, 290, profile.mailing_address?.city || '', f, bf);
  vl(p, ML + 295, y, y - 16);
  field(p, 'State', ML + 298, y - 2, 40, profile.mailing_address?.state || profile.state || '', f, bf);
  vl(p, ML + 342, y, y - 16);
  field(p, 'ZIP code', ML + 345, y - 2, 90, profile.mailing_address?.zip || '', f, bf);
  hl(p, y - 16, ML, MR, 0.5, BLACK); y -= 20;

  // Filing status
  p.drawText('Filing Status:', { x: ML, y: y - 8, size: 7.5, font: bf, color: BLACK });
  const fsMap: Record<string, number> = { single: 0, married_filing_jointly: 1, married_filing_separately: 2, head_of_household: 3 };
  const selFS = fsMap[profile.filing_status || 'single'] ?? 0;
  ['Single', 'Married filing jointly', 'Married filing separately', 'Head of household'].forEach((lbl, i) => {
    const bx = ML + 90 + i * 120;
    p.drawRectangle({ x: bx, y: y - 12, width: 7, height: 7, borderColor: BLACK, borderWidth: 0.5, color: WHITE });
    if (i === selFS) p.drawText('X', { x: bx + 1.5, y: y - 11, size: 5.5, font: f, color: BLACK });
    p.drawText(lbl, { x: bx + 10, y: y - 11, size: 6.5, font: f, color: BLACK });
  });
  hl(p, y - 18, ML, MR, 0.5, BLACK); y -= 22;

  // Digital assets
  p.drawText(`At any time in ${yr}, did you receive, sell, or dispose of any digital asset (cryptocurrency)?`, { x: ML, y: y - 8, size: 7, font: f, color: BLACK });
  p.drawRectangle({ x: MR - 60, y: y - 12, width: 7, height: 7, borderColor: BLACK, borderWidth: 0.5, color: WHITE });
  p.drawText('Yes', { x: MR - 51, y: y - 11, size: 7, font: f, color: BLACK });
  p.drawRectangle({ x: MR - 28, y: y - 12, width: 7, height: 7, borderColor: BLACK, borderWidth: 0.5, color: WHITE });
  p.drawText('No', { x: MR - 19, y: y - 11, size: 7, font: f, color: BLACK });
  hl(p, y - 18, ML, MR, 0.5, BLACK); y -= 22;

  // Income
  y = banner(p, 'Income', y, f, bf);
  y = row(p, '1a', 'Total wages from W-2 forms (Box 1)', y, d.w2Wages, f, bf, false);
  y = row(p, '1z', 'Total wages (add lines 1a-1h)', y, d.w2Wages, f, bf, true, true);
  y = row(p, '2a', 'Tax-exempt interest reported for the benefit worksheet', y, d.taxExemptInterest || 0, f, bf, false);
  y = row(p, '2b', 'Taxable interest', y, d.interest, f, bf, false);
  y = row(p, '3b', 'Ordinary dividends', y, d.dividends, f, bf, true);
  y = row(p, '4b', 'IRA distributions (taxable)', y, d.iraDist, f, bf, false);
  y = row(p, '5b', 'Pensions and annuities (taxable)', y, 0, f, bf, true);
  y = row(p, '6a', 'Social security benefits (Box5 net benefits)', y, d.socialSecurityNetBenefits || 0, f, bf, true);
  y = row(p, '6b', 'Social security benefits (taxable)', y, d.socialSecurity, f, bf, false);
  if (d.socialSecurityLivedApartAllYear === true) y = row(p, '6d', 'Married filing separately: lived apart from spouse all year [X]', y, undefined, f, bf, false);
  y = row(p, Number(yr) >= 2025 ? '7a' : '7', 'Capital gain or (loss)  -  attach Schedule D', y, d.capGains, f, bf, true);
  y = row(p, '8', 'Additional income from Schedule 1 (includes Schedule C net profit)', y, d.schedule1Income, f, bf, false);
  y -= 4;
  y = hrow(p, '9', 'Total income. Add lines 1z, 2b, 3b, 4b, 5b, 6b, 7, 8.', y, d.totalIncome, f, bf, rgb(0.88, 0.92, 1.0), BLUE);
  y -= 4;
  y = row(p, '10', 'Adjustments to income from Schedule 1, Part II', y, d.adjustments, f, bf, false);
  y -= 4;
  y = hrow(p, Number(yr) >= 2025 ? '11a' : '11', 'Adjusted gross income. Subtract line 10 from line 9.', y, d.agi, f, bf, rgb(0.88, 0.92, 1.0), BLUE);

  return p;
}

async function page2(doc: PDFDocument, f: PDFFont, bf: PDFFont, d: Record<string, any>, yr: string): Promise<PDFPage> {
  const p = doc.addPage([PW, PH]);
  let y = MT;

  // Banner
  p.drawRectangle({ x: ML, y: y - 13, width: MR - ML, height: 13, color: BLUE });
  p.drawText(`Form 1040 (${yr})  |  Page 2  |  Pre-filled by WriteOff`, { x: ML + 4, y: y - 9.5, size: 6.5, font: bf, color: WHITE });
  y -= 17;

  // Deductions
  y = banner(p, 'Standard Deduction or Itemized Deductions', y, f, bf);
  const hasSchedule1A = Number(yr) >= 2025;
  y = row(p, hasSchedule1A ? '12e' : '12', `${d.usingStandardDeduction ? 'Standard deduction (reviewed age, blindness and dependency)' : 'Itemized deductions (Schedule A)'}`, y, d.deductionUsed, f, bf, false);
  const nonItemizerCharity = d.nonItemizerCharitableDeduction || 0;
  // §170(p) applies from 2026; the final 2026 form line is not published, so the row is labeled by section.
  if (nonItemizerCharity > 0) y = row(p, '12*', 'Charitable cash gifts for non-itemizers (section 170(p); line per final 2026 form)', y, nonItemizerCharity, f, bf, false);
  y = row(p, hasSchedule1A ? '13a' : '13', 'Qualified business income deduction (Form 8995 / 8995-A)', y, d.qbiDeduction, f, bf, true);
  const schedule1ATotal = hasSchedule1A ? (d.scheduleOneADeductions ?? d.enhancedSeniorDeduction) : 0;
  if (hasSchedule1A) y = row(p, '13b', 'Enhanced senior deduction, qualified tips, overtime and vehicle loan interest (Schedule 1-A line 38)', y, schedule1ATotal, f, bf, false);
  y = row(p, '14', hasSchedule1A ? (nonItemizerCharity > 0 ? 'Add lines 12e, 12*, 13a and 13b' : 'Add lines 12e, 13a and 13b') : 'Add lines 12 and 13', y, d.deductionUsed + nonItemizerCharity + d.qbiDeduction + schedule1ATotal, f, bf, false, true);
  y -= 4;
  y = hrow(p, '15', 'Taxable income after deductions (not less than zero)', y, d.taxableIncome, f, bf, rgb(0.88, 0.92, 1.0), BLUE);
  y -= 6;

  // Tax
  y = banner(p, 'Tax and Credits', y, f, bf);
  y = row(p, '16', 'Tax (from tax table or rate schedule)', y, d.incomeTax, f, bf, false);
  y = row(p, '17', 'Alternative minimum tax (Form 6251)', y, 0, f, bf, true);
  y = row(p, '19', 'Child tax credit and credit for other dependents', y, d.childTaxCredit, f, bf, false);
  y = row(p, '22', 'Income tax after nonrefundable credits', y, Math.max(0, d.incomeTax - d.totalCredits), f, bf, true, true);
  y -= 4;

  // Other taxes
  y = banner(p, 'Other Taxes', y, f, bf);
  y = row(p, 'SE', 'Self-employment tax (Schedule SE, Line 12)', y, d.selfEmploymentTax, f, bf, false);
  y = row(p, 'AMT', 'Additional Medicare Tax (Form 8959)', y, d.additionalMedicareTax || 0, f, bf, true);
  y -= 4;
  y = hrow(p, '24', 'Total tax. Add all tax lines.', y, d.totalTax, f, bf, rgb(0.88, 0.92, 1.0), BLUE);
  y -= 6;

  // Payments
  y = banner(p, 'Payments', y, f, bf);
  y = row(p, '25a', 'W-2 federal income tax withheld (Box 2  -  all employers)', y, d.w2FederalWithheld, f, bf, false);
  y = row(p, '25b', 'SSA/RRB federal income tax withheld', y, d.socialSecurityFederalWithheld || 0, f, bf, false);
  y = row(p, '25d', 'Recorded withholding only (W-2 and SSA/RRB)', y, d.w2FederalWithheld + (d.socialSecurityFederalWithheld || 0), f, bf, true, true);
  y = row(p, '26', `${yr} recorded estimated tax payments`, y, d.estimatedPayments, f, bf, false);
  y = row(p, '27', 'Earned income credit (EIC)', y, d.eitcCredit, f, bf, true);
  y = row(p, '28', 'Additional child tax credit', y, d.additionalCTC, f, bf, false);
  y -= 4;
  y = hrow(p, '33', 'Total payments. Add lines 25d, 26, 27, 28.', y, d.totalPayments, f, bf, rgb(0.88, 0.92, 1.0), BLUE);
  y -= 6;

  // Result
  const hasRefund = (d.refund || 0) > 0;
  y = banner(p, hasRefund ? 'Refund' : 'Amount You Owe', y, f, bf);
  if (hasRefund) {
    y = row(p, '34', 'Amount you overpaid (line 33 minus line 24)', y, d.refund, f, bf, false);
    y = hrow(p, '35a', 'Estimated overpayment - refund election not collected', y, d.refund, f, bf, rgb(0.88, 1.0, 0.88), rgb(0, 0.6, 0));
    y = row(p, '35b', 'Refund instructions require review; see optional account record', y, undefined, f, bf, false);
    y = row(p, '35d', 'This summary does not request a refund or direct deposit', y, undefined, f, bf, true);
  } else {
    y = hrow(p, '37', 'Amount you owe (line 24 minus line 33).', y, d.balanceDue, f, bf, rgb(1.0, 0.92, 0.88), rgb(0.8, 0.3, 0));
    y = row(p, '38', 'Estimated tax penalty - not calculated', y, 0, f, bf, false);
  }
  y -= 10;

  y = banner(p, 'Preparer review required - do not sign or file this summary', y, f, bf);
  p.drawText('This is not a complete return, an IRS form, or an e-file authorization. See the review notes below and the appendix.', { x: ML, y: y - 8, size: 7.5, font: f, color: BLACK });
  y -= 16;

  // Calculation warnings belong on the page that shows the refund/balance, not only in the appendix.
  reviewNotes(p, Array.isArray(d.warnings) ? d.warnings : [], y, f, bf, 3);

  return p;
}

export async function POST(request: NextRequest) {
  let requestedYear = NaN;
  try {
    let uid: string;
    try { uid = (await getUserFromReqOrThrow(request)).uid; }
    catch {
      const { user, error } = await getAuthenticatedUser(request);
      if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      uid = user.uid;
    }

    const denied = await requireFeatureAccess(uid, 'exports');
    if (denied) return denied;

    const { year } = await request.json();
    if (!year) return NextResponse.json({ error: 'Year required' }, { status: 400 });
    const taxYear = Number(year);
    try { getFederalTaxRules(taxYear); } catch {
      return NextResponse.json({ error: `Supported tax years: ${SUPPORTED_TAX_YEARS.join(', ')}` }, { status: 400 });
    }
    requestedYear = taxYear;

    const [txResult, profileResult, grossSnap, income1099Snap, w2Snap, deductionsSnap, quarterlySnap, organizerSnap, settingsResult, reconciliationDecisions] = await Promise.all([
      readTaxExportTransactions(uid, taxYear),
      getUserProfileServer(uid),
      adminDb.collection('gross_receipts').where('userId', '==', uid).where('taxYear', '==', taxYear).get(),
      adminDb.collection('income_1099').where('userId', '==', uid).where('taxYear', '==', taxYear).get(),
      adminDb.collection('w2_income').where('userId', '==', uid).where('taxYear', '==', taxYear).get(),
      adminDb.collection('tax_deductions').where('userId', '==', uid).where('taxYear', '==', taxYear).limit(1).get(),
      getRecordedQuarterlyPayments(uid, taxYear),
      adminDb.collection('tax_organizers').where('userId', '==', uid).where('taxYear', '==', taxYear).limit(1).get(),
      getScheduleCSettings(uid),
      readIncomeReconciliationDecisions(uid, taxYear),
    ]);

    if (profileResult.error || settingsResult.error || !settingsResult.data) {
      return NextResponse.json({ error: 'Could not load the information needed for this calculation. Please retry.' }, { status: 503 });
    }
    const settings = settingsResult.data;
    const transactions = txResult;
    const profile = (profileResult.data || {}) as Record<string, any>;
    const ded = deductionsSnap.empty ? {} as Record<string, any> : deductionsSnap.docs[0].data();
    const org = organizerSnap.empty ? {} as Record<string, any> : organizerSnap.docs[0].data();

    for (const key of ['taxpayerSSN', 'spouseSSN', 'bankAccount']) {
      if (typeof org[key] === 'string' && isEncrypted(org[key])) org[key] = decryptSensitive(org[key]);
    }

    // Merge organizer data into profile for PDF pre-fill
    const enrichedProfile: Record<string, any> = {
      ...profile,
      // SSN from organizer (formatted as XXX-XX-XXXX)
      ssn: org.taxpayerSSN
        ? formatSSNForDisplay(org.taxpayerSSN)
        : '',
      // Spouse
      spouseName: org.spouseName || '',
      spouseSSN: org.spouseSSN
        ? formatSSNForDisplay(org.spouseSSN)
        : '',
      // Address (organizer address takes priority over profile)
      mailing_address: {
        street: org.streetAddress || profile.mailing_address?.street || '',
        city: org.city || profile.mailing_address?.city || '',
        state: org.stateAddr || profile.mailing_address?.state || profile.state || '',
        zip: org.zipCode || profile.mailing_address?.zip || '',
      },
      // Bank for direct deposit
      bankRouting: org.bankRouting || '',
      bankAccount: org.bankAccount || '',
      bankAccountType: org.bankAccountType || 'checking',
      // Prior year AGI for e-file
      priorYearAGI: org.priorYearAGI || '',
      // IP PIN
      ipPin: org.ipPin || '',
    };

    const snapshot = buildFederalTaxSnapshot({
      taxYear, transactions, profile, organizer: org, deductions: ded,
      grossReceipts: grossSnap.docs.map(d => ({ ...d.data(), id: d.id })),
      forms1099: income1099Snap.docs.map(d => ({ ...d.data(), id: d.id })),
      reconciliationDecisions,
      w2Entries: w2Snap.docs.map(d => d.data()),
      assets: settings.assets, homeOffice: settings.homeOffice, depreciationElections: settings.depreciationElections,
      estimatedPayments: totalRecordedPayments(quarterlySnap),
    });
    const { result } = snapshot;
    enrichedProfile.filing_status = snapshot.filingStatus;

    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(`Form 1040 ${year}`);
    pdfDoc.setAuthor('WriteOff');
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const displayData: Record<string, any> = {
      ...result, ...snapshot.income,
      socialSecurityLivedApartAllYear: snapshot.socialSecurityWorksheet?.livedApartAllYear,
      // Schedule 1 line 3 carries the allowed Schedule C result, negative in a reviewed loss year.
      schedule1Income: snapshot.income.scheduleCAllowed + snapshot.income.rental + snapshot.income.otherOrdinaryIncome,
      w2FederalWithheld: snapshot.w2.withheld, w2StateWithheld: snapshot.w2.stateWithheld, estimatedPayments: snapshot.payments.estimatedPayments,
    };

    // Add completeness warnings to displayData
    const warnings: string[] = [...(result.calculationWarnings || [])];
    if (!result.totalIncome || result.totalIncome === 0) warnings.push('No income entered - add income in WriteOff before using this form');
    if (!enrichedProfile.ssn) warnings.push('SSN not filled in - enter SSN in Tax Organizer');
    if (!enrichedProfile.mailing_address?.street) warnings.push('Mailing address incomplete - update in Tax Organizer');
    displayData.warnings = warnings;

    const p1 = await page1(pdfDoc, font, boldFont, displayData, enrichedProfile, String(year));
    const p2 = await page2(pdfDoc, font, boldFont, displayData, String(year));
    const notes = await createPlanningPDF('Form 1040 - identity records and review notes', taxYear);
    notes.paragraph('Do not file this export with the IRS. It is an incomplete planning summary. WriteOff has not prepared all required schedules, signatures, elections or state returns.', true);
    notes.paragraph('Missing or blank fields are not findings that the item is zero or inapplicable. The numeric estimate covers the saved inputs and supported rules only.');
    notes.section('Complete saved identity and optional handoff records');
    notes.table(['Record', 'Saved value'], [
      ['Full name', enrichedProfile.name || 'Not provided'], ['SSN', enrichedProfile.ssn || 'Not provided'],
      ['Spouse name', enrichedProfile.spouseName || 'Not provided'], ['Spouse SSN', enrichedProfile.spouseSSN || 'Not provided'],
      ['Address', [enrichedProfile.mailing_address.street, enrichedProfile.mailing_address.city, enrichedProfile.mailing_address.state, enrichedProfile.mailing_address.zip].filter(Boolean).join(', ') || 'Not provided'],
      ['Optional refund routing / account', enrichedProfile.bankRouting || enrichedProfile.bankAccount ? `${enrichedProfile.bankRouting || 'Not provided'} / ${enrichedProfile.bankAccount || 'Not provided'} (${enrichedProfile.bankAccountType})` : 'Not provided'],
    ], [195, 333]);
    notes.section('Review notes');
    notes.paragraph(warnings.length ? `${warnings.length} calculation or completeness note(s) qualify the figures on pages 1-2:` : 'No calculation limits were reported for the saved inputs.');
    warnings.forEach((warning, index) => notes.paragraph(`${index + 1}. ${warning}`));
    notes.paragraph('Verify all income sources; IRA versus pension classification and basis; qualified dividends and capital gains; depreciation and home-office adjustments; credits; AMT and other taxes; all non-W-2/non-SSA withholding; prior-year payments applied; Form8959 withholding; refund elections; and penalties. Supporting Schedules1,1-A,2,3,A,D and other required forms are not produced by this summary.');
    notes.paragraph('Review legal names, taxpayer/spouse identity, digital-asset answers, residency and all signatures with the preparer. Optional bank details are records only and do not authorize any payment, refund or electronic filing.');
    const appendix = await PDFDocument.load(await notes.save(2));
    for (const page of await pdfDoc.copyPages(appendix, appendix.getPageIndices())) pdfDoc.addPage(page);
    footer(p1, 1, pdfDoc.getPageCount(), String(year), font);
    footer(p2, 2, pdfDoc.getPageCount(), String(year), font);

    const pdfBytes = await pdfDoc.save();
    return new NextResponse(pdfBytes as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Form_1040_${year}_WriteOff.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    if (err instanceof IncomeReconciliationRequiredError) return NextResponse.json(incomeReconciliationReviewBody(err, requestedYear), { status: 422 });
    if (err instanceof ExportReviewRequiredError || err instanceof IncomeReconciliationRequiredError || err instanceof FilingStatusReviewRequiredError || err instanceof SocialSecurityReviewRequiredError || err instanceof PersonalDeductionReviewRequiredError || err instanceof DependentCreditReviewRequiredError
      || err instanceof CapitalGainReviewRequiredError || err instanceof BusinessLossReviewRequiredError || err instanceof OBBBADeductionReviewRequiredError) return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    const reviewCode = scheduleCReviewCode(err);
    if (reviewCode) return NextResponse.json({ error: err instanceof Error ? err.message : 'Schedule C records need review', code: reviewCode }, { status: 422 });
    if (err instanceof ExportDataUnavailableError) return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
    console.error('[1040 Export]', err);
    return NextResponse.json({ error: 'Failed to generate Form 1040' }, { status: 500 });
  }
}
