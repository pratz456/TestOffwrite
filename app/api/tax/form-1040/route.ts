/**
 * Form 1040 (U.S. Individual Income Tax Return) PDF Export
 * Generates an IRS-faithful 2-page 1040 pre-filled from WriteOff data.
 * POST body: { year: number }
 * Sources: IRS Rev. Proc. 2024-40, OBBB P.L. 119-21, IRS Form 1040 instructions
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import { calcScheduleSE } from '@/lib/reports/calcSE';
import { compute1040 } from '@/lib/tax-rules/compute-1040';
import { getAssetsSettings } from '@/lib/firebase/settings-server';
import { calc4562 } from '@/lib/reports/calc4562';

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
  if (val) p.drawText(val, { x: x + 2, y: y - 9, size: 8, font: bf, color: BLACK });
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

async function page1(doc: PDFDocument, f: PDFFont, bf: PDFFont, d: Record<string, any>, profile: Record<string, any>, yr: string): Promise<PDFPage> {
  const p = doc.addPage([PW, PH]);
  let y = MT;

  // Banner
  p.drawRectangle({ x: ML, y: y - 13, width: MR - ML, height: 13, color: BLUE });
  p.drawText(`WRITEOFF PRE-FILL  |  Tax Year ${yr}  |  Review all entries before filing`, { x: ML + 4, y: y - 9.5, size: 6.5, font: bf, color: WHITE });
  y -= 17;

  // IRS Header
  p.drawRectangle({ x: ML, y: y - 38, width: MR - ML, height: 38, color: HDRBLK });
  p.drawText('Form', { x: ML + 4, y: y - 11, size: 7, font: f, color: rgb(0.7, 0.7, 0.7) });
  p.drawText('1040', { x: ML + 4, y: y - 24, size: 18, font: bf, color: WHITE });
  p.drawText('U.S. Individual Income Tax Return', { x: ML + 70, y: y - 12, size: 10, font: bf, color: WHITE });
  p.drawText('Department of the Treasury—Internal Revenue Service', { x: ML + 70, y: y - 22, size: 7, font: f, color: rgb(0.6, 0.6, 0.6) });
  p.drawText('For the year Jan. 1-Dec. 31, 2025', { x: ML + 70, y: y - 31, size: 6, font: f, color: rgb(0.55, 0.55, 0.55) });
  p.drawText('OMB No. 1545-0074', { x: MR - 80, y: y - 11, size: 7, font: bf, color: WHITE });
  p.drawText(yr, { x: MR - 50, y: y - 26, size: 14, font: bf, color: GOLD });
  y -= 42;

  // Name/SSN
  hl(p, y, ML, MR, 0.5, BLACK); y -= 1;
  const parts = (profile.name || '').split(' ');
  field(p, 'First name and middle initial', ML, y - 2, 200, parts[0] || '', f, bf);
  vl(p, ML + 205, y, y - 16);
  field(p, 'Last name', ML + 208, y - 2, 162, parts.slice(1).join(' '), f, bf);
  vl(p, ML + 374, y, y - 16);
  field(p, 'Social security number', ML + 377, y - 2, 159, profile.ssn || '___-__-____', f, bf);
  hl(p, y - 16, ML, MR, 0.5, BLACK); y -= 20;

  field(p, 'Home address', ML, y - 2, 430, profile.mailing_address?.street || profile.primary_work_location || '', f, bf);
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
  p.drawText('At any time in 2025, did you receive, sell, or dispose of any digital asset (cryptocurrency)?', { x: ML, y: y - 8, size: 7, font: f, color: BLACK });
  p.drawRectangle({ x: MR - 60, y: y - 12, width: 7, height: 7, borderColor: BLACK, borderWidth: 0.5, color: WHITE });
  p.drawText('Yes', { x: MR - 51, y: y - 11, size: 7, font: f, color: BLACK });
  p.drawRectangle({ x: MR - 28, y: y - 12, width: 7, height: 7, borderColor: BLACK, borderWidth: 0.5, color: WHITE });
  p.drawText('No', { x: MR - 19, y: y - 11, size: 7, font: f, color: BLACK });
  hl(p, y - 18, ML, MR, 0.5, BLACK); y -= 22;

  // Income
  y = banner(p, 'Income', y, f, bf);
  y = row(p, '1a', 'Total wages from W-2 forms (Box 1)', y, d.w2Wages, f, bf, false);
  y = row(p, '1z', 'Total wages (add lines 1a-1h)', y, d.w2Wages, f, bf, true, true);
  y = row(p, '2b', 'Taxable interest', y, 0, f, bf, false);
  y = row(p, '3b', 'Ordinary dividends', y, 0, f, bf, true);
  y = row(p, '4b', 'IRA distributions (taxable)', y, 0, f, bf, false);
  y = row(p, '5b', 'Pensions and annuities (taxable)', y, 0, f, bf, true);
  y = row(p, '6b', 'Social security benefits (taxable)', y, 0, f, bf, false);
  y = row(p, '7', 'Capital gain or (loss)  -  attach Schedule D', y, 0, f, bf, true);
  y = row(p, '8', 'Additional income from Schedule 1 (includes Schedule C net profit)', y, d.scheduleCNetProfit, f, bf, false);
  y -= 4;
  y = hrow(p, '9', 'Total income. Add lines 1z, 2b, 3b, 4b, 5b, 6b, 7, 8.', y, d.totalIncome, f, bf, rgb(0.88, 0.92, 1.0), BLUE);
  y -= 4;
  y = row(p, '10', 'Adjustments to income from Schedule 1, Part II', y, d.adjustments, f, bf, false);
  y -= 4;
  y = hrow(p, '11', 'Adjusted gross income. Subtract line 10 from line 9.', y, d.agi, f, bf, rgb(0.88, 0.92, 1.0), BLUE);

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
  const stdAmt = d.standardDeduction?.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }) || '$15,750';
  y = row(p, '12', `${d.usingStandardDeduction ? 'Standard' : 'Itemized'} deduction (standard: ${stdAmt} single, $31,500 MFJ  -  2025)`, y, d.deductionUsed, f, bf, false);
  y = row(p, '13', 'Qualified business income deduction (Form 8995 / 8995-A)', y, d.qbiDeduction, f, bf, true);
  y = row(p, '14', 'Add lines 12 and 13', y, (d.deductionUsed || 0) + (d.qbiDeduction || 0), f, bf, false, true);
  y -= 4;
  y = hrow(p, '15', 'Taxable income. Subtract line 14 from line 11. If zero or less, enter -0-.', y, d.taxableIncome, f, bf, rgb(0.88, 0.92, 1.0), BLUE);
  y -= 6;

  // Tax
  y = banner(p, 'Tax and Credits', y, f, bf);
  y = row(p, '16', 'Tax (from tax table or rate schedule)', y, d.incomeTax, f, bf, false);
  y = row(p, '17', 'Alternative minimum tax (Form 6251)', y, 0, f, bf, true);
  y = row(p, '19', 'Tax after credits. Subtract credits from line 16.', y, d.incomeTax, f, bf, false, true);
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
  y = row(p, '25d', 'Total withholding (25a-25c)', y, d.w2FederalWithheld, f, bf, true, true);
  y = row(p, '26', '2025 estimated tax payments and amount applied from 2024', y, d.estimatedPayments, f, bf, false);
  y = row(p, '27', 'Earned income credit (EIC)', y, 0, f, bf, true);
  y = row(p, '28', 'Additional child tax credit', y, 0, f, bf, false);
  y -= 4;
  y = hrow(p, '33', 'Total payments. Add lines 25d, 26, 27, 28.', y, d.totalPayments, f, bf, rgb(0.88, 0.92, 1.0), BLUE);
  y -= 6;

  // Result
  const hasRefund = (d.refund || 0) > 0;
  y = banner(p, hasRefund ? 'Refund' : 'Amount You Owe', y, f, bf);
  if (hasRefund) {
    y = row(p, '34', 'Amount you overpaid (line 33 minus line 24)', y, d.refund, f, bf, false);
    y = hrow(p, '35a', 'Amount to be refunded to you (direct deposit).', y, d.refund, f, bf, rgb(0.88, 1.0, 0.88), rgb(0, 0.6, 0));
    y = row(p, '35b', 'Routing number for direct deposit', y, undefined, f, bf, false);
    y = row(p, '35d', 'Account number for direct deposit', y, undefined, f, bf, true);
  } else {
    y = hrow(p, '37', 'Amount you owe (line 24 minus line 33).', y, d.balanceDue, f, bf, rgb(1.0, 0.92, 0.88), rgb(0.8, 0.3, 0));
    y = row(p, '38', 'Estimated tax penalty (see instructions)', y, 0, f, bf, false);
  }
  y -= 10;

  // Sign here
  p.drawRectangle({ x: ML, y: y - 13, width: MR - ML, height: 13, color: HDRBLK });
  p.drawText('Sign Here', { x: ML + 4, y: y - 9.5, size: 8, font: bf, color: WHITE });
  p.drawText('Under penalties of perjury, I declare that to the best of my knowledge and belief, this return is true, correct, and complete.', { x: ML + 75, y: y - 6, size: 5.5, font: f, color: rgb(0.6, 0.6, 0.6) });
  y -= 16;
  hl(p, y - 20, ML, MR - 200, 0.5, BLACK);
  p.drawText('Your signature', { x: ML, y: y - 22, size: 6, font: f, color: GRAY });
  hl(p, y - 20, MR - 195, MR - 100, 0.5, BLACK);
  p.drawText('Date', { x: MR - 195, y: y - 22, size: 6, font: f, color: GRAY });
  hl(p, y - 20, MR - 95, MR, 0.5, BLACK);
  p.drawText('Your occupation', { x: MR - 95, y: y - 22, size: 6, font: f, color: GRAY });

  return p;
}

export async function POST(request: NextRequest) {
  try {
    let uid: string;
    try { uid = (await getUserFromReqOrThrow(request)).uid; }
    catch {
      const { user, error } = await getAuthenticatedUser(request);
      if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      uid = user.uid;
    }

    const { year } = await request.json();
    if (!year) return NextResponse.json({ error: 'Year required' }, { status: 400 });
    const taxYear = parseInt(String(year), 10);

    const [txResult, profileResult, grossSnap, income1099Snap, w2Snap, deductionsSnap, quarterlySnap, organizerSnap, assetsResult] = await Promise.all([
      getTransactionsServer(uid),
      getUserProfileServer(uid),
      adminDb.collection('gross_receipts').where('userId', '==', uid).where('taxYear', '==', taxYear).get(),
      adminDb.collection('income_1099').where('userId', '==', uid).where('taxYear', '==', taxYear).get(),
      adminDb.collection('w2_income').where('userId', '==', uid).where('taxYear', '==', taxYear).get(),
      adminDb.collection('tax_deductions').where('userId', '==', uid).where('taxYear', '==', taxYear).limit(1).get(),
      adminDb.collection('quarterly_payments').where('userId', '==', uid).where('taxYear', '==', taxYear).get(),
      adminDb.collection('tax_organizers').where('userId', '==', uid).where('taxYear', '==', taxYear).limit(1).get(),
      getAssetsSettings(uid),
    ]);

    const transactions = (txResult.data || []) as any[];
    const profile = (profileResult.data || {}) as Record<string, any>;
    const ded = deductionsSnap.empty ? {} as Record<string, any> : deductionsSnap.docs[0].data();
    const org = organizerSnap.empty ? {} as Record<string, any> : organizerSnap.docs[0].data();

    // Merge organizer data into profile for PDF pre-fill
    const enrichedProfile: Record<string, any> = {
      ...profile,
      // SSN from organizer (formatted as XXX-XX-XXXX)
      ssn: org.taxpayerSSN
        ? `${org.taxpayerSSN.slice(0,3)}-${org.taxpayerSSN.slice(3,5)}-${org.taxpayerSSN.slice(5,9)}`
        : '',
      // Spouse
      spouseName: org.spouseName || '',
      spouseSSN: org.spouseSSN
        ? `${org.spouseSSN.slice(0,3)}-${org.spouseSSN.slice(3,5)}-${org.spouseSSN.slice(5,9)}`
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

    const grossReceipts =
      grossSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0) +
      income1099Snap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
    const w2Wages = w2Snap.docs.reduce((s, d) => s + (d.data().box1Wages || d.data().wages || 0), 0);
    const w2FederalWithheld =
      w2Snap.docs.reduce((s, d) => s + (d.data().box2FederalWithheld || d.data().federalWithheld || 0), 0) +
      (profile.w2_federal_withheld || 0);
    const estimatedPayments = quarterlySnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
    const { totalDeductible } = aggregateScheduleC(transactions, String(taxYear), CATEGORY_MAP, { mode: 'confirmed-only' });
    const scheduleCNetProfit = Math.max(0, grossReceipts - totalDeductible);
    const filingStatus = (profile.filing_status || 'single') as any;
    const seCalc = calcScheduleSE({ scheduleCNetProfit, taxYear }, filingStatus);

    // Depreciation from assets (Section 179 / MACRS / Form 4562)
    const assets = assetsResult.data || [];
    const depreciationDeduction = assets.length > 0
      ? calc4562(assets, scheduleCNetProfit).totalDepreciation
      : 0;

    const result = compute1040({
      taxYear, filingStatus, scheduleCNetProfit, w2Wages, w2FederalWithheld, estimatedPayments,
      selfEmploymentTax: seCalc.totalSETax,
      halfSEDeduction: seCalc.halfSEDeduction,
      healthInsurancePremiums: ded.healthInsurancePremiums || profile.health_insurance_premiums || 0,
      sepIraContribution: ded.sepIraContribution || profile.sep_ira_contribution || 0,
      solo401kContribution: (ded.solo401kEmployeeContribution || 0) + (ded.solo401kEmployerContribution || 0) + (profile.solo_401k_contribution || 0),
      simpleIraContribution: ded.simpleIraContribution || 0,
      hsaContribution: ded.hsaContribution || profile.hsa_contribution || 0,
      studentLoanInterest: ded.studentLoanInterest || 0,
      charitableDonations: (ded?.charitableCashDonations || 0) + (ded?.charitableNonCashDonations || 0),
      depreciationDeduction,
      stateCode: profile?.state,
    }, ded.priorYearTotalTax || profile.prior_year_tax || undefined);

    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(`Form 1040 ${year}`);
    pdfDoc.setAuthor('WriteOff');
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const displayData: Record<string, any> = { ...result, w2Wages, scheduleCNetProfit, w2FederalWithheld, estimatedPayments };

    // Add completeness warnings to displayData
    const warnings: string[] = [];
    if (!result.totalIncome || result.totalIncome === 0) warnings.push('No income entered - add income in WriteOff before using this form');
    if (!enrichedProfile.ssn) warnings.push('SSN not filled in - enter SSN in Tax Organizer');
    if (!enrichedProfile.mailing_address?.street) warnings.push('Mailing address incomplete - update in Tax Organizer');
    displayData.warnings = warnings;

    const p1 = await page1(pdfDoc, font, boldFont, displayData, enrichedProfile, String(year));
    const p2 = await page2(pdfDoc, font, boldFont, displayData, String(year));
    footer(p1, 1, 2, String(year), font);
    footer(p2, 2, 2, String(year), font);

    const pdfBytes = await pdfDoc.save();
    return new NextResponse(pdfBytes as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Form_1040_${year}_WriteOff.pdf"`,
      },
    });
  } catch (err) {
    console.error('[1040 Export]', err);
    return NextResponse.json({ error: 'Failed to generate Form 1040' }, { status: 500 });
  }
}
