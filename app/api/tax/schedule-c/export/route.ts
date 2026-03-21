/**
 * Schedule C (Form 1040) - IRS-Faithful PDF Export
 *
 * Generates a 2-page PDF mirroring the 2025 IRS Schedule C layout:
 *   Page 1: Form header, taxpayer fields A-I, Part I Income, Part II Expenses (lines 8-28)
 *   Page 2: Part III Cost of Goods Sold, Part IV Vehicle Info, Part V Other Expenses + Appendix
 *
 * Pre-fills expense lines from confirmed transactions via aggregateScheduleC.
 * Income lines (1-7) are left blank for manual entry before filing.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { checkHistoricalAccess } from '@/lib/subscriptions/historical-access';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import type { LineItemSummary } from '@/lib/schedule-c/aggregate';
import { adminDb } from '@/lib/firebase/admin';

// Page dimensions (US Letter)
const PW = 612;
const PH = 792;
const ML = 36;
const MR = 576;
const MT = 756;

// Colors
const BLACK   = rgb(0, 0, 0);
const DKGRAY  = rgb(0.25, 0.25, 0.25);
const GRAY    = rgb(0.50, 0.50, 0.50);
const LTGRAY  = rgb(0.80, 0.80, 0.80);
const WHITE   = rgb(1, 1, 1);
const SHADE   = rgb(0.94, 0.94, 0.94);
const BLUE    = rgb(0.10, 0.28, 0.56);
const GOLD    = rgb(1.00, 0.85, 0.00);
const HDRBLK  = rgb(0.08, 0.08, 0.08);

// Font sizes
const SZ_TITLE   = 13;
const SZ_SUB     = 9;
const SZ_SEC     = 9;
const SZ_LBL     = 7.5;
const SZ_VAL     = 8.5;
const SZ_LINENUM = 7;
const SZ_FOOT    = 6.5;
const SZ_BANNER  = 6.5;

function fmt(v: number | undefined | null): string {
  if (!v) return '';
  if (v < 0) return `-$${Math.abs(v).toFixed(2)}`;
  return `$${v.toFixed(2)}`;
}

function tw(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(text, size);
}

function drawR(page: PDFPage, text: string, xRight: number, y: number, size: number, font: PDFFont, color = BLACK) {
  page.drawText(text, { x: xRight - tw(font, text, size), y, size, font, color });
}

function hLine(page: PDFPage, y: number, x1 = ML, x2 = MR, t = 0.5, color = LTGRAY) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: t, color });
}

function vLine(page: PDFPage, x: number, y1: number, y2: number, t = 0.4) {
  page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: t, color: LTGRAY });
}

function box(page: PDFPage, x: number, y: number, w: number, h: number) {
  page.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: LTGRAY, borderWidth: 0.5, color: WHITE });
}

function filledBox(page: PDFPage, x: number, y: number, w: number, h: number, val: string, font: PDFFont, boldFont: PDFFont) {
  const filled = !!val;
  page.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: filled ? BLUE : LTGRAY, borderWidth: filled ? 0.75 : 0.4, color: filled ? rgb(0.93, 0.96, 1.0) : WHITE });
  if (val) drawR(page, val, x + w - 3, y - h + (h - SZ_VAL) / 2, SZ_VAL, boldFont, BLUE);
}

function inputLine(page: PDFPage, label: string, x: number, y: number, w: number, val: string, font: PDFFont, boldFont: PDFFont) {
  page.drawText(label, { x, y: y + 1, size: SZ_LBL - 0.5, font, color: GRAY });
  hLine(page, y - 10, x, x + w, 0.6, BLACK);
  if (val) page.drawText(val, { x: x + 2, y: y - 9, size: SZ_VAL, font: boldFont, color: BLACK });
}

function cb(page: PDFPage, x: number, y: number, label: string, checked: boolean, font: PDFFont) {
  page.drawRectangle({ x, y: y - 6, width: 7, height: 7, borderColor: BLACK, borderWidth: 0.6, color: WHITE });
  if (checked) page.drawText('X', { x: x + 1.5, y: y - 5, size: 5.5, font, color: BLACK });
  page.drawText(label, { x: x + 10, y: y - 5, size: SZ_LBL, font, color: BLACK });
}

// Full-width expense line (for Part I totals and Part II summary lines)
function expLine(
  page: PDFPage, num: string, label: string, y: number,
  amt: number | undefined, font: PDFFont, boldFont: PDFFont, shade = false
): number {
  const H = 13;
  const BW = 92;
  const BX = MR - BW;
  if (shade) page.drawRectangle({ x: ML, y: y - H, width: MR - ML, height: H, color: SHADE });
  drawR(page, num, ML + 19, y - 3.5, SZ_LINENUM, font, DKGRAY);
  page.drawText(label, { x: ML + 22, y: y - 3.5, size: SZ_LBL, font, color: BLACK });
  let dx = ML + 22 + tw(font, label, SZ_LBL) + 3;
  while (dx < BX - 4) { page.drawText('.', { x: dx, y: y - 3.5, size: SZ_LBL, font, color: LTGRAY }); dx += 3.5; }
  filledBox(page, BX, y, BW, H, fmt(amt), font, boldFont);
  hLine(page, y - H, ML, MR, 0.3);
  return y - H;
}

// Two-column expense line (IRS standard for lines 8-27)
const C2_DIV = 306;
const C2_BW  = 80;
const C2_H   = 13;

function exp2(
  page: PDFPage,
  lNum: string, lLabel: string, lAmt: number | undefined,
  rNum: string, rLabel: string, rAmt: number | undefined,
  y: number, font: PDFFont, boldFont: PDFFont, shade = false
): number {
  if (shade) page.drawRectangle({ x: ML, y: y - C2_H, width: MR - ML, height: C2_H, color: SHADE });
  vLine(page, C2_DIV, y, y - C2_H);

  // Left column
  drawR(page, lNum, ML + 19, y - 3.5, SZ_LINENUM, font, DKGRAY);
  page.drawText(lLabel, { x: ML + 22, y: y - 3.5, size: SZ_LBL, font, color: BLACK });
  const lBX = C2_DIV - C2_BW - 3;
  let dx = ML + 22 + tw(font, lLabel, SZ_LBL) + 3;
  while (dx < lBX - 3) { page.drawText('.', { x: dx, y: y - 3.5, size: SZ_LBL, font, color: LTGRAY }); dx += 3.5; }
  filledBox(page, lBX, y, C2_BW, C2_H, fmt(lAmt), font, boldFont);

  // Right column
  drawR(page, rNum, C2_DIV + 4, y - 3.5, SZ_LINENUM, font, DKGRAY);
  page.drawText(rLabel, { x: C2_DIV + 20, y: y - 3.5, size: SZ_LBL, font, color: BLACK });
  const rBX = MR - C2_BW;
  dx = C2_DIV + 20 + tw(font, rLabel, SZ_LBL) + 3;
  while (dx < rBX - 3) { page.drawText('.', { x: dx, y: y - 3.5, size: SZ_LBL, font, color: LTGRAY }); dx += 3.5; }
  filledBox(page, rBX, y, C2_BW, C2_H, fmt(rAmt), font, boldFont);

  hLine(page, y - C2_H, ML, MR, 0.25);
  return y - C2_H;
}

function sectionBanner(page: PDFPage, label: string, y: number, font: PDFFont, boldFont: PDFFont): number {
  const H = 14;
  page.drawRectangle({ x: ML, y: y - H, width: MR - ML, height: H, color: BLUE });
  page.drawText(label, { x: ML + 4, y: y - H + 4, size: SZ_SEC, font: boldFont, color: WHITE });
  return y - H - 2;
}

function footer(page: PDFPage, pageNum: number, total: number, font: PDFFont, taxYear: string) {
  hLine(page, 28, ML, MR, 0.5, LTGRAY);
  page.drawText(`Schedule C (Form 1040) ${taxYear}`, { x: ML, y: 19, size: SZ_FOOT, font, color: GRAY });
  page.drawText('Pre-filled by WriteOff | Not an official IRS form | Review all lines before filing with a tax professional', { x: ML, y: 11, size: SZ_FOOT - 0.5, font, color: GRAY });
  drawR(page, `Page ${pageNum} of ${total}`, MR, 19, SZ_FOOT, font, GRAY);
}

// ─── Build Page 1 ─────────────────────────────────────────────────────────────
async function buildPage1(
  pdfDoc: PDFDocument, font: PDFFont, boldFont: PDFFont,
  lines: Record<string, number | undefined>, profile: any, taxYear: string
): Promise<PDFPage> {
  const page = pdfDoc.addPage([PW, PH]);
  let y = MT;

  // Pre-fill banner
  page.drawRectangle({ x: ML, y: y - 13, width: MR - ML, height: 13, color: BLUE });
  page.drawText(`WRITEOFF PRE-FILL  |  Tax Year ${taxYear}  |  Income lines 1-7 are blank  -  enter gross receipts and COGS manually`, {
    x: ML + 4, y: y - 9.5, size: SZ_BANNER, font: boldFont, color: WHITE
  });
  y -= 17;

  // IRS form header block
  const HDR_H = 38;
  page.drawRectangle({ x: ML, y: y - HDR_H, width: MR - ML, height: HDR_H, color: HDRBLK });

  // Left: form name
  page.drawText('SCHEDULE C', { x: ML + 4, y: y - 13, size: 11, font: boldFont, color: WHITE });
  page.drawText('(Form 1040)', { x: ML + 4, y: y - 24, size: 8, font, color: rgb(0.75, 0.75, 0.75) });
  page.drawText('Department of the Treasury — Internal Revenue Service', { x: ML + 4, y: y - 34, size: 5.5, font, color: rgb(0.55, 0.55, 0.55) });

  // Center: title
  const midX = PW / 2;
  const t1 = 'Profit or Loss From Business'; const t2 = '(Sole Proprietorship)';
  const t3 = 'Go to www.irs.gov/ScheduleC for instructions and the latest information.';
  const t4 = 'Attach to Form 1040, 1040-SR, 1040-SS, or 1040-NR.';
  page.drawText(t1, { x: midX - tw(boldFont, t1, 10) / 2, y: y - 12, size: 10, font: boldFont, color: WHITE });
  page.drawText(t2, { x: midX - tw(font, t2, 7.5) / 2, y: y - 22, size: 7.5, font, color: rgb(0.8, 0.8, 0.8) });
  page.drawText(t3, { x: midX - tw(font, t3, 5.5) / 2, y: y - 30, size: 5.5, font, color: rgb(0.6, 0.6, 0.6) });
  page.drawText(t4, { x: midX - tw(font, t4, 5.5) / 2, y: y - 36, size: 5.5, font, color: rgb(0.6, 0.6, 0.6) });

  // Right: OMB + year
  page.drawText('OMB No. 1545-0074', { x: MR - 80, y: y - 12, size: 7, font: boldFont, color: WHITE });
  page.drawText(taxYear, { x: MR - 50, y: y - 23, size: 14, font: boldFont, color: GOLD });
  page.drawText('Attachment Sequence No. 09', { x: MR - 96, y: y - 34, size: 5.5, font, color: rgb(0.55, 0.55, 0.55) });
  y -= HDR_H + 4;

  // Name + SSN row
  hLine(page, y, ML, MR, 0.5, BLACK);
  y -= 1;
  const nameLabel = 'Name of proprietor';
  const ssnLabel = 'Social security number (SSN)';
  const nameW = 360;
  const ssnW = MR - ML - nameW - 10;
  inputLine(page, nameLabel, ML, y - 2, nameW, profile?.name || '', font, boldFont);
  vLine(page, ML + nameW + 5, y - 2, y - 15);
  inputLine(page, ssnLabel, ML + nameW + 8, y - 2, ssnW, profile?.ssn || '', font, boldFont);
  hLine(page, y - 16, ML, MR, 0.5, BLACK);
  y -= 20;

  // Field A
  page.drawText('A', { x: ML, y: y - 7, size: 8, font: boldFont, color: BLACK });
  inputLine(page, 'Principal business or profession, including product or service (see instructions)', ML + 12, y - 3, 330, profile?.profession || '', font, boldFont);
  page.drawText('B', { x: ML + 352, y: y - 7, size: 8, font: boldFont, color: BLACK });
  inputLine(page, 'Enter code from instructions', ML + 364, y - 3, 88, profile?.naics_code || '', font, boldFont);
  hLine(page, y - 18, ML, MR, 0.5, BLACK);
  y -= 22;

  // Field C + D
  page.drawText('C', { x: ML, y: y - 7, size: 8, font: boldFont, color: BLACK });
  inputLine(page, 'Business name. If no separate business name, leave blank.', ML + 12, y - 3, 300, '', font, boldFont);
  page.drawText('D', { x: ML + 320, y: y - 7, size: 8, font: boldFont, color: BLACK });
  inputLine(page, 'Employer ID number (EIN)', ML + 332, y - 3, 110, profile?.ein || '', font, boldFont);
  hLine(page, y - 18, ML, MR, 0.5, BLACK);
  y -= 22;

  // Field E
  page.drawText('E', { x: ML, y: y - 7, size: 8, font: boldFont, color: BLACK });
  inputLine(page, 'Business address (including suite or room no.)', ML + 12, y - 3, 480, profile?.primary_work_location || '', font, boldFont);
  hLine(page, y - 18, ML, MR, 0.5, BLACK);
  y -= 18;
  page.drawText('City, town or post office, state, and ZIP code', { x: ML + 12, y: y - 4, size: SZ_LBL - 0.5, font, color: GRAY });
  hLine(page, y - 14, ML + 12, MR, 0.5, BLACK);
  hLine(page, y - 14, ML, MR, 0.5, BLACK);
  y -= 18;

  // Field F: Accounting method
  page.drawText('F', { x: ML, y: y - 7, size: 8, font: boldFont, color: BLACK });
  page.drawText('Accounting method:', { x: ML + 12, y: y - 7, size: SZ_LBL, font: boldFont, color: BLACK });
  cb(page, ML + 100, y - 3, 'Cash', true, font);
  cb(page, ML + 145, y - 3, 'Accrual', false, font);
  cb(page, ML + 198, y - 3, 'Other (specify)', false, font);
  inputLine(page, '', ML + 290, y - 3, 100, '', font, boldFont);

  // Field G
  page.drawText('G', { x: ML + 400, y: y - 7, size: 8, font: boldFont, color: BLACK });
  const gText = 'Did you "materially participate" in the operation of this business during 2025?';
  page.drawText(gText, { x: ML + 412, y: y - 7, size: SZ_LBL - 0.5, font, color: BLACK });
  hLine(page, y - 18, ML, MR, 0.5, BLACK);
  y -= 22;

  // Field H + I
  page.drawText('H', { x: ML, y: y - 7, size: 8, font: boldFont, color: BLACK });
  page.drawText('If you started or acquired this business during 2025, check here', { x: ML + 12, y: y - 7, size: SZ_LBL, font, color: BLACK });
  page.drawRectangle({ x: ML + 255, y: y - 12, width: 8, height: 8, borderColor: BLACK, borderWidth: 0.5, color: WHITE });
  page.drawText('I', { x: ML + 280, y: y - 7, size: 8, font: boldFont, color: BLACK });
  page.drawText('Did you make any payments in 2025 that would require you to file Form(s) 1099?', { x: ML + 292, y: y - 7, size: SZ_LBL, font, color: BLACK });
  hLine(page, y - 18, ML, MR, 0.5, BLACK);
  y -= 24;

  // ── PART I: Income ──
  y = sectionBanner(page, 'Part I   Income', y, font, boldFont);

  y = expLine(page, '1', 'Gross receipts or sales. See instructions for line 1 and check the box if this income was reported to you on Form W-2 and the "Statutory employee" box on that form was checked', y, undefined, font, boldFont, false);
  y = expLine(page, '2', 'Returns and allowances', y, undefined, font, boldFont, true);
  y = expLine(page, '3', 'Subtract line 2 from line 1', y, undefined, font, boldFont, false);
  y = expLine(page, '4', 'Cost of goods sold (from line 42)', y, undefined, font, boldFont, true);
  y = expLine(page, '5', 'Gross profit. Subtract line 4 from line 3', y, undefined, font, boldFont, false);
  y = expLine(page, '6', 'Other income, including federal and state gasoline or fuel tax credit or refund (see instructions)', y, undefined, font, boldFont, true);
  y -= 1;
  page.drawRectangle({ x: ML, y: y - 15, width: MR - ML, height: 15, color: rgb(0.90, 0.94, 1.0) });
  page.drawText('7', { x: ML + 2, y: y - 11, size: SZ_LINENUM, font, color: DKGRAY });
  page.drawText('Gross income. Add lines 5 and 6', { x: ML + 22, y: y - 11, size: SZ_LBL, font: boldFont, color: BLACK });
  filledBox(page, MR - 92, y, 92, 15, '', font, boldFont);
  hLine(page, y - 15, ML, MR, 0.5, BLUE);
  y -= 20;

  // ── PART II: Expenses ──
  y = sectionBanner(page, 'Part II   Expenses   (Enter expenses for business use of your home only on line 30)', y, font, boldFont);

  y = exp2(page, '8', 'Advertising', lines['8'], '18', 'Office expense (see instructions)', lines['18'], y, font, boldFont, false);
  y = exp2(page, '9', 'Car and truck expenses (see instructions)', lines['9'], '19', 'Pension and profit-sharing plans', undefined, y, font, boldFont, true);
  y = exp2(page, '10', 'Commissions and fees', lines['10'], '20a', 'Rent/lease - vehicles, machinery', lines['20a'], y, font, boldFont, false);
  y = exp2(page, '11', 'Contract labor (see instructions)', lines['11'], '20b', 'Rent/lease - other business property', lines['20b'], y, font, boldFont, true);
  y = exp2(page, '12', 'Depletion', undefined, '21', 'Repairs and maintenance', undefined, y, font, boldFont, false);
  y = exp2(page, '13', 'Depreciation (Form 4562)', undefined, '22', 'Supplies (not in Part III)', lines['22'], y, font, boldFont, true);
  y = exp2(page, '14', 'Employee benefit programs', undefined, '23', 'Taxes and licenses', undefined, y, font, boldFont, false);
  y = exp2(page, '15', 'Insurance (other than health)', lines['15'], '24a', 'Travel (see instructions)', lines['24a'], y, font, boldFont, true);
  y = exp2(page, '16a', 'Mortgage interest (banks)', lines['16a'], '24b', 'Deductible meals (see instr.)', lines['24b'], y, font, boldFont, false);
  y = exp2(page, '16b', 'Other interest', undefined, '25', 'Utilities', lines['25'], y, font, boldFont, true);
  y = exp2(page, '17', 'Legal and professional svcs', lines['17'], '26', 'Wages (less employment credits)', undefined, y, font, boldFont, false);
  y -= 2;

  // Line 27a: Other expenses
  page.drawText('27a', { x: ML + 2, y: y - 11, size: SZ_LINENUM, font, color: DKGRAY });
  page.drawText('Other expenses (from line 48)', { x: ML + 22, y: y - 11, size: SZ_LBL, font, color: BLACK });
  const otherAmt = lines['27a'];
  filledBox(page, C2_DIV - C2_BW - 3, y, C2_BW, C2_H, fmt(otherAmt), font, boldFont);
  page.drawText('27b', { x: C2_DIV + 4, y: y - 11, size: SZ_LINENUM, font, color: DKGRAY });
  page.drawText('Reserved for future use', { x: C2_DIV + 20, y: y - 11, size: SZ_LBL, font, color: GRAY });
  hLine(page, y - C2_H, ML, MR, 0.3);
  y -= C2_H + 3;

  // Line 28 total
  page.drawRectangle({ x: ML, y: y - 16, width: MR - ML, height: 16, color: rgb(0.88, 0.92, 1.0) });
  page.drawText('28', { x: ML + 2, y: y - 12, size: SZ_LINENUM, font: boldFont, color: BLACK });
  page.drawText('Total expenses before expenses for business use of home. Add lines 8 through 27a', { x: ML + 22, y: y - 12, size: SZ_LBL, font: boldFont, color: BLACK });
  const total28 = lines['28'] || 0;
  filledBox(page, MR - 92, y, 92, 16, fmt(total28), font, boldFont);
  hLine(page, y - 16, ML, MR, 0.7, BLUE);
  y -= 20;

  // Lines 29-32 brief
  y = expLine(page, '29', 'Tentative profit or (loss). Subtract line 28 from line 7', y, undefined, font, boldFont, true);
  y = expLine(page, '30', 'Expenses for business use of your home. Do not report these expenses elsewhere. Attach Form 8829', y, undefined, font, boldFont, false);
  y = expLine(page, '31', 'Net profit or (loss). Subtract line 30 from line 29', y, undefined, font, boldFont, true);
  y -= 3;
  page.drawText('32', { x: ML + 2, y: y - 9, size: SZ_LINENUM, font, color: DKGRAY });
  page.drawText('If a loss, check the box that describes your investment in this activity. See instructions.', { x: ML + 22, y: y - 9, size: SZ_LBL, font, color: BLACK });
  cb(page, MR - 120, y - 4, '32a  All investment is at risk.', false, font);
  cb(page, MR - 60, y - 4, '32b  Some is not.', false, font);
  hLine(page, y - 18, ML, MR, 0.4);

  return page;
}

// ─── Build Page 2 ─────────────────────────────────────────────────────────────
async function buildPage2(
  pdfDoc: PDFDocument, font: PDFFont, boldFont: PDFFont,
  lines: Record<string, number | undefined>,
  lineItems: LineItemSummary[],
  profile: any, taxYear: string
): Promise<PDFPage> {
  const page = pdfDoc.addPage([PW, PH]);
  let y = MT;

  // Continuation header
  page.drawRectangle({ x: ML, y: y - 13, width: MR - ML, height: 13, color: BLUE });
  page.drawText(`Schedule C (Form 1040) ${taxYear}  |  Page 2`, { x: ML + 4, y: y - 9.5, size: SZ_BANNER, font: boldFont, color: WHITE });
  drawR(page, 'Pre-filled by WriteOff', MR - 4, y - 9.5, SZ_BANNER, font, WHITE);
  y -= 17;

  // ── PART III: Cost of Goods Sold ──
  y = sectionBanner(page, 'Part III   Cost of Goods Sold (see instructions)', y, font, boldFont);

  const partIIIRows = [
    ['33', 'Method(s) used to value closing inventory:', '', true],
    ['34', 'Was there any change in determining quantities, costs, or valuations between opening and closing inventory?', '', false],
    ['35', 'Inventory at beginning of year. If different from last year\'s closing inventory, attach explanation', '', true],
    ['36', 'Purchases less cost of items withdrawn for personal use', '', false],
    ['37', 'Cost of labor. Do not include any amounts paid to yourself', '', true],
    ['38', 'Materials and supplies', '', false],
    ['39', 'Other costs', '', true],
    ['40', 'Add lines 35 through 39', '', false],
    ['41', 'Inventory at end of year', '', true],
    ['42', 'Cost of goods sold. Subtract line 41 from line 40. Enter the result here and on line 4', '', false],
  ];

  for (const [num, label, , shade] of partIIIRows) {
    const H = 13;
    const BW = 92;
    const BX = MR - BW;
    if (shade) page.drawRectangle({ x: ML, y: y - H, width: MR - ML, height: H, color: SHADE });
    drawR(page, num as string, ML + 19, y - 3.5, SZ_LINENUM, font, DKGRAY);
    page.drawText(label as string, { x: ML + 22, y: y - 3.5, size: SZ_LBL, font, color: BLACK });
    box(page, BX, y, BW, H);
    hLine(page, y - H, ML, MR, 0.3);
    y -= H;
  }
  y -= 6;

  // ── PART IV: Vehicle Information ──
  y = sectionBanner(page, 'Part IV   Information on Your Vehicle. Complete this part only if you are claiming car or truck expenses on line 9.', y, font, boldFont);

  const vehicleRows = [
    ['43', 'When did you place your vehicle in service for business purposes? (month/day/year)'],
    ['44', 'Of the total number of miles you drove your vehicle during 2025, enter the number of miles you used your vehicle for: a  Business  ________   b  Commuting  ________   c  Other  ________'],
    ['45', 'Was your vehicle available for personal use during off-duty hours?'],
    ['46', 'Do you (or your spouse) have another vehicle available for personal use?'],
    ['47a', 'Do you have evidence to support your deduction?'],
    ['47b', 'If "Yes," is the evidence written?'],
  ];

  for (const [num, label] of vehicleRows) {
    const H = 14;
    page.drawText(num as string, { x: ML + 2, y: y - 10, size: SZ_LINENUM, font, color: DKGRAY });
    page.drawText(label as string, { x: ML + 22, y: y - 10, size: SZ_LBL, font, color: BLACK });
    if ((num as string).startsWith('45') || (num as string).startsWith('46') || (num as string).startsWith('47')) {
      cb(page, MR - 70, y - 7, 'Yes', false, font);
      cb(page, MR - 30, y - 7, 'No', false, font);
    }
    hLine(page, y - H, ML, MR, 0.3);
    y -= H;
  }
  y -= 6;

  // ── PART V: Other Expenses ──
  y = sectionBanner(page, 'Part V   Other Expenses. List below business expenses not included on lines 8-26 or line 30.', y, font, boldFont);

  // Pull line 27a transactions
  const otherItem = lineItems.find(li => li.lineCode === '27a');
  const otherTxns = otherItem?.transactions || [];
  const maxRows = Math.min(otherTxns.length, 8);

  for (let i = 0; i < 9; i++) {
    const H = 14;
    const BW = 92;
    const BX = MR - BW;
    const lineNum = 48 + i;
    const tx = i < maxRows ? otherTxns[i] : null;
    page.drawText(String(lineNum), { x: ML + 2, y: y - 10, size: SZ_LINENUM, font, color: DKGRAY });
    if (tx) {
      const merchantStr = (tx as any).merchant_name || '';
      inputLine(page, '', ML + 22, y - 3, 300, merchantStr, font, boldFont);
      filledBox(page, BX, y, BW, H, fmt(Math.abs((tx as any).amount || 0)), font, boldFont);
    } else {
      hLine(page, y - 10, ML + 22, BX - 4, 0.4, LTGRAY);
      box(page, BX, y, BW, H);
    }
    hLine(page, y - H, ML, MR, 0.25);
    y -= H;
  }

  // Line 48 total
  y -= 2;
  page.drawRectangle({ x: ML, y: y - 16, width: MR - ML, height: 16, color: rgb(0.90, 0.94, 1.0) });
  page.drawText('48', { x: ML + 2, y: y - 12, size: SZ_LINENUM, font: boldFont, color: BLACK });
  page.drawText('Total other expenses. Enter here and on line 27a', { x: ML + 22, y: y - 12, size: SZ_LBL, font: boldFont, color: BLACK });
  const line27Total = lines['27a'] || 0;
  filledBox(page, MR - 92, y, 92, 16, fmt(line27Total), font, boldFont);
  hLine(page, y - 16, ML, MR, 0.7, BLUE);
  y -= 24;

  // Transaction appendix summary at bottom if space allows
  if (y > 120) {
    hLine(page, y, ML, MR, 0.5, LTGRAY);
    y -= 10;
    page.drawText('WriteOff Transaction Summary  -  Confirmed Deductible Transactions by Schedule C Line', {
      x: ML, y, size: SZ_LBL, font: boldFont, color: DKGRAY
    });
    y -= 12;

    for (const item of lineItems) {
      if (y < 50) break;
      const H = 11;
      page.drawText(`Line ${item.lineCode}`, { x: ML, y: y - 3, size: SZ_LBL, font: boldFont, color: BLACK });
      page.drawText(item.lineName, { x: ML + 38, y: y - 3, size: SZ_LBL, font, color: BLACK });
      page.drawText(`${item.transactionCount} txn${item.transactionCount !== 1 ? 's' : ''}`, { x: ML + 240, y: y - 3, size: SZ_LBL, font, color: GRAY });
      drawR(page, fmt(item.deductible), MR, y - 3, SZ_LBL, boldFont, BLUE);
      hLine(page, y - H, ML, MR, 0.25);
      y -= H;
    }
  }

  return page;
}

// ─── Main POST handler ────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    // Auth
    let uid: string | null = null;
    try {
      const { uid: huid } = await getUserFromReqOrThrow(request);
      uid = huid;
    } catch {
      const { user, error } = await getAuthenticatedUser(request);
      if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      uid = user.uid;
    }

    // Subscription check
    const access = await checkHistoricalAccess(uid);
    if (!access.hasAccess) {
      return NextResponse.json({ error: 'Subscription required', requiresSubscription: true }, { status: 403 });
    }

    const { year } = await request.json();
    if (!year) return NextResponse.json({ error: 'Year is required' }, { status: 400 });

    // Fetch transactions + profile
    const { data: transactions = [] } = await getTransactionsServer(uid);
    const { data: profile } = await getUserProfileServer(uid);

    // Fetch organizer for SSN
    const orgSnap = await adminDb.collection('tax_organizers')
      .where('userId', '==', uid)
      .where('taxYear', '==', parseInt(String(year), 10))
      .limit(1).get();
    const orgData = orgSnap.empty ? {} as any : orgSnap.docs[0].data();
    const enrichedProfile = {
      ...profile,
      ssn: orgData.taxpayerSSN
        ? `${String(orgData.taxpayerSSN).slice(0,3)}-${String(orgData.taxpayerSSN).slice(3,5)}-${String(orgData.taxpayerSSN).slice(5,9)}`
        : '',
    } as any;

    // Fetch gross receipts (manual income entries) for this tax year
    const grossReceiptsSnap = await adminDb
      .collection('gross_receipts')
      .where('userId', '==', uid)
      .where('taxYear', '==', parseInt(String(year), 10))
      .get();
    const grossReceiptsTotal = grossReceiptsSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);

    // Fetch 1099 income forms for this tax year
    const income1099Snap = await adminDb
      .collection('income_1099')
      .where('userId', '==', uid)
      .where('taxYear', '==', parseInt(String(year), 10))
      .get();
    const income1099Total = income1099Snap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);

    // Combine all income sources for Line 1 (Gross Receipts)
    const totalGrossReceipts = grossReceiptsTotal + income1099Total;

    // Aggregate into Schedule C line totals
    const { totalDeductible, lineItemsArray } = aggregateScheduleC(
      transactions as any[], year, CATEGORY_MAP, { mode: 'confirmed-only' }
    );

    // Build line map keyed by IRS line code
    const lines: Record<string, number | undefined> = {};
    let totalExpenses = 0;
    for (const item of lineItemsArray) {
      lines[item.lineCode] = item.deductible || undefined;
      totalExpenses += item.deductible || 0;
    }
    lines['28'] = totalExpenses > 0 ? totalExpenses : undefined;
    // Pre-fill income lines from manual entries + 1099s
    lines['1'] = totalGrossReceipts > 0 ? totalGrossReceipts : undefined;
    lines['5'] = (totalGrossReceipts > 0 && !lines['4']) ? totalGrossReceipts : undefined;
    if (lines['1'] && lines['28']) {
      lines['29'] = lines['1'] - lines['28'];
      lines['31'] = lines['29']; // simplified (no home office on line 30)
    }

    // Generate PDF
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(`Schedule C ${year}`);
    pdfDoc.setAuthor('WriteOff');
    pdfDoc.setSubject(`Form 1040 Schedule C - Tax Year ${year}`);
    pdfDoc.setCreator('WriteOff Tax Software');

    const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const page1 = await buildPage1(pdfDoc, font, boldFont, lines, enrichedProfile, String(year));
    const page2 = await buildPage2(pdfDoc, font, boldFont, lines, lineItemsArray, enrichedProfile, String(year));

    // Add footers
    footer(page1, 1, 2, font, String(year));
    footer(page2, 2, 2, font, String(year));

    const pdfBytes = await pdfDoc.save();
    const filename = `Schedule_C_${year}_WriteOff.pdf`;

    return new NextResponse(pdfBytes as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      }
    });

  } catch (err) {
    console.error('[Schedule C Export] Error:', err);
    return NextResponse.json({ error: 'Failed to generate Schedule C PDF' }, { status: 500 });
  }
}
