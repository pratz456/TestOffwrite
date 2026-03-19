/**
 * Schedule C PDF Export API
 *
 * PDF generation path: auth → subscription check → getTransactionsServer(uid) → aggregateScheduleC(transactions, year)
 * → pdf-lib. Produces accountant-ready Schedule C Summary: header (WriteOff logo, title, tax year, generated, prepared for),
 * disclaimer (once), Summary Totals table, Breakdown by Line, Appendix (transaction detail by line with Date/Merchant/Amount
 * tables and subtotals per line), minimal footer (Page X of Y on every page).
 * Totals and line items use the shared aggregation in lib/schedule-c/aggregate.ts so PDF and UI match.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import path from 'path';
import fs from 'fs';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { checkHistoricalAccess } from '@/lib/subscriptions/historical-access';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { aggregateScheduleC, CATEGORY_MAP } from '@/lib/schedule-c/aggregate';
import type { LineItemSummary } from '@/lib/schedule-c/aggregate';
import { safeTaxYear, safeYMD } from '@/lib/schedule-c/taxDate';

const MARGIN = 54;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const FOOTER_BOTTOM = 40; // minimum y for content (safe print area)
const SECTION_GAP = 26;
const BLACK = rgb(0, 0, 0);
const GRAY = rgb(0.35, 0.35, 0.35);
const LIGHT_GRAY = rgb(0.5, 0.5, 0.5);
const HEADER_SPACING = 8;

// Print-safe 3-level border system (~25% / 45% / 65% gray)
const BORDER_LIGHT = rgb(0.75, 0.75, 0.75);   // table grids, minor rules
const BORDER_MED = rgb(0.55, 0.55, 0.55);     // section dividers
const BORDER_STRONG = rgb(0.35, 0.35, 0.35);  // subtotals, Line 28 emphasis
const BRAND_BLUE = rgb(31 / 255, 78 / 255, 121 / 255); // #1F4E79 — only header divider (+ section title text)
const LINE28_TINT_OPACITY = 0.10;
const SUMMARY_HEADER_BG = rgb(0.93, 0.93, 0.93);  // ~7% gray, print-visible
const APPENDIX_STRIPE = rgb(0.94, 0.94, 0.94);    // ~6% gray, print-visible
const SUBTOTAL_BG = rgb(0.93, 0.93, 0.93);        // ~7% gray, print-visible

// Typography scale
const TITLE_MAIN = 21;
const TITLE_SUB = 15;
const META_SIZE = 10;
const SECTION_HEADER = 12;
const TABLE_HEADER = 10;
const BODY_SIZE = 10;
const FOOTER_SIZE = 9;
const DISCLAIMER_SIZE = 8;

function formatCurrency(value: number): string {
  if (value < 0) return `-$${Math.abs(value).toFixed(2)}`;
  return `$${value.toFixed(2)}`;
}

function drawTextRight(page: PDFPage, text: string, xRight: number, y: number, size: number, font: PDFFont, color = BLACK) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: xRight - width, y, size, font, color });
}

function drawHLineWithColor(page: PDFPage, y: number, color: ReturnType<typeof rgb>, thickness = 1) {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness,
    color
  });
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '-';
  try {
    return safeYMD(dateStr) ?? '—';
  } catch {
    return '-';
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user (support Authorization header or session cookie)
    let uid: string | null = null;
    try {
      const { uid: headerUid } = await getUserFromReqOrThrow(request);
      uid = headerUid;
    } catch (headerAuthError) {
      const { user, error: authError } = await getAuthenticatedUser(request);
      if (authError || !user) {
        console.warn('⚠️ [Schedule C Export] Authentication failed:', headerAuthError || authError);
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      uid = user.uid;
    }

    // Check subscription access - require active subscription for Schedule C export
    const access = await checkHistoricalAccess(uid);
    if (!access.hasAccess) {
      console.log(`⚠️ [Schedule C Export] User ${uid} does not have subscription access`);
      return NextResponse.json(
        { 
          error: 'Subscription required', 
          requiresSubscription: true,
          message: 'An active subscription is required to export Schedule C reports. Please subscribe to access this feature.'
        },
        { status: 403 }
      );
    }

    const { year, includeAppendix = true } = await request.json();

    if (!year) {
      return NextResponse.json(
        { error: 'Year is required' },
        { status: 400 }
      );
    }

    // Fetch transactions via same path as rest of app (userId + user_id + per-account fallback)
    const { data: transactions = [], error: fetchError } = await getTransactionsServer(uid);
    if (fetchError) {
      console.warn('⚠️ [Schedule C Export] getTransactionsServer error:', fetchError);
    }
    console.log(`📊 [Schedule C Export] Total transactions fetched: ${transactions.length}`);

    // Single source of truth: shared aggregation (year filter, deductible rule, 50% meals)
    const { totalExpenses, totalDeductible, lineItems, lineItemsArray } = aggregateScheduleC(
      transactions,
      year,
      CATEGORY_MAP,
      { mode: 'confirmed-only' }
    );
    console.log(`📊 [Schedule C Export] Year ${year}: totalExpenses=${totalExpenses.toFixed(2)}, totalDeductible=${totalDeductible.toFixed(2)}, lineItems=${lineItemsArray.length}`);

    // Credits/refunds (negative amounts) are already netted into line totals in `confirmed-only` mode.
    // We keep a small "offsets" display block for transparency.
    const creditsInLines = lineItemsArray.flatMap((item: LineItemSummary) =>
      (item.transactions ?? []).filter((tx: any) => (tx.amount ?? 0) < 0)
    );
    const totalCreditAmount = creditsInLines.reduce((sum: number, t: any) => sum + (t.amount ?? 0), 0); // negative
    const hasCredits = creditsInLines.length > 0;

    // --- PDF generation (premium, accountant-ready) ---
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const courierFont = await pdfDoc.embedFont(StandardFonts.Courier);
    const courierBoldFont = await pdfDoc.embedFont(StandardFonts.CourierBold);

    let currentPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let yPosition = PAGE_HEIGHT - MARGIN;

    function nextPageIfNeeded(requiredSpace: number): void {
      if (yPosition < FOOTER_BOTTOM + requiredSpace) {
        currentPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        yPosition = PAGE_HEIGHT - MARGIN;
        // Continuation header so loose pages are identifiable
        currentPage.drawText(`WriteOff - Schedule C Summary (Tax Year ${year})`, {
          x: MARGIN,
          y: yPosition,
          size: FOOTER_SIZE,
          font: font,
          color: GRAY
        });
        drawHLineWithColor(currentPage, yPosition - 8, BORDER_LIGHT, 0.5);
        yPosition -= 22;
      }
    }

    // ----- Header: logo (top-left), two-line title (left), metadata block (top right), blue divider -----
    let logoHeight = 0;
    const logoPaths = [path.join(process.cwd(), 'public', 'logo.png'), path.join(process.cwd(), 'public', 'writeofflogo.png')];
    for (const logoPath of logoPaths) {
      try {
        if (fs.existsSync(logoPath)) {
          const logoBytes = fs.readFileSync(logoPath);
          const logoImage = await pdfDoc.embedPng(logoBytes);
          const maxHeight = 36;
          const scale = Math.min(1, 120 / logoImage.width, maxHeight / logoImage.height);
          const w = logoImage.width * scale;
          const h = logoImage.height * scale;
          logoHeight = h + HEADER_SPACING;
          currentPage.drawImage(logoImage, {
            x: MARGIN,
            y: yPosition - h,
            width: w,
            height: h
          });
          yPosition -= logoHeight;
          break;
        }
      } catch (e) {
        console.warn('[Schedule C Export] Logo not loaded (skip):', (e as Error).message);
      }
    }

    let preparedForName = '';
    try {
      const { adminAuth } = await import('@/lib/firebase/admin');
      const userRecord = await adminAuth.getUser(uid);
      preparedForName = userRecord.displayName || userRecord.email || '';
    } catch {
      // skip
    }

    const generatedStr = `Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
    const taxYearStr = `Tax Year: ${year}`;
    const preparedStr = preparedForName ? `Prepared for: ${preparedForName}` : '';
    const xRight = PAGE_WIDTH - MARGIN;

    const titleY1 = yPosition;
    currentPage.drawText('WriteOff', { x: MARGIN, y: titleY1, size: TITLE_SUB, font: boldFont, color: BRAND_BLUE });
    const w1 = font.widthOfTextAtSize(taxYearStr, META_SIZE);
    currentPage.drawText(taxYearStr, { x: xRight - w1, y: titleY1, size: META_SIZE, font: font, color: GRAY });

    const titleY2 = yPosition - 16;
    currentPage.drawText('Schedule C Summary', { x: MARGIN, y: titleY2, size: TITLE_MAIN, font: boldFont, color: BLACK });
    const w2 = font.widthOfTextAtSize(generatedStr, META_SIZE);
    currentPage.drawText(generatedStr, { x: xRight - w2, y: titleY2, size: META_SIZE, font: font, color: GRAY });

    let metaNextY = titleY2 - 12;
    if (preparedStr) {
      const w3 = font.widthOfTextAtSize(preparedStr, META_SIZE);
      currentPage.drawText(preparedStr, { x: xRight - w3, y: metaNextY, size: META_SIZE, font: font, color: GRAY });
      metaNextY -= 12;
    }

    const accountingStr = 'Accounting Method: Cash Basis';
    const wAcct = font.widthOfTextAtSize(accountingStr, META_SIZE);
    currentPage.drawText(accountingStr, { x: xRight - wAcct, y: metaNextY, size: META_SIZE, font: font, color: GRAY });

    let headerBottom = metaNextY - 12;

    yPosition = headerBottom - HEADER_SPACING;
    drawHLineWithColor(currentPage, yPosition, BRAND_BLUE, 1);
    yPosition -= SECTION_GAP;

    // ----- Section 1: Summary Totals (Line | Description | Deductible Amount) -----
    currentPage.drawText('Summary Totals', {
      x: MARGIN,
      y: yPosition,
      size: SECTION_HEADER,
      font: boldFont,
      color: BRAND_BLUE
    });
    yPosition -= 20;

    const colLine = MARGIN;
    const colDesc = MARGIN + 52;
    const colDeductRight = PAGE_WIDTH - MARGIN;
    const summaryRowHeight = 18;
    const summaryHeaderRowHeight = 16;

    currentPage.drawRectangle({
      x: MARGIN,
      y: yPosition - summaryHeaderRowHeight,
      width: PAGE_WIDTH - 2 * MARGIN,
      height: summaryHeaderRowHeight,
      color: SUMMARY_HEADER_BG
    });
    currentPage.drawText('Line', { x: colLine, y: yPosition, size: TABLE_HEADER, font: boldFont, color: BLACK });
    currentPage.drawText('Description', { x: colDesc, y: yPosition, size: TABLE_HEADER, font: boldFont, color: BLACK });
    drawTextRight(currentPage, 'Deductible Amount', colDeductRight, yPosition, TABLE_HEADER, boldFont);
    yPosition -= summaryHeaderRowHeight;

    drawHLineWithColor(currentPage, yPosition, BORDER_LIGHT, 0.5);
    yPosition -= 14;

    lineItemsArray.forEach((item: LineItemSummary) => {
      // In confirmed-only mode, line totals are already netted (credits/refunds reduce expenses).
      const adjustedDeductible = item.deductible;

      currentPage.drawText(item.lineCode, { x: colLine, y: yPosition, size: BODY_SIZE, font: font, color: BLACK });
      const desc = item.lineCode === '24b' ? 'Meals (50%)' : item.lineName;
      currentPage.drawText(desc, { x: colDesc, y: yPosition, size: BODY_SIZE, font: font, color: BLACK });
      drawTextRight(currentPage, formatCurrency(adjustedDeductible), colDeductRight, yPosition, BODY_SIZE, courierFont);
      yPosition -= summaryRowHeight;
    });

    // Expense Offsets (Credits/Refunds) — display only if credits detected
    if (hasCredits) {
      currentPage.drawText('-', { x: colLine, y: yPosition, size: BODY_SIZE, font: font, color: GRAY });
      currentPage.drawText('Expense Offsets (Credits/Refunds)', { x: colDesc, y: yPosition, size: BODY_SIZE, font: font, color: GRAY });
      drawTextRight(currentPage, formatCurrency(totalCreditAmount), colDeductRight, yPosition, BODY_SIZE, courierFont, GRAY);
      yPosition -= summaryRowHeight;
    }

    const line28RowHeight = 18;
    yPosition -= 6 + 4; // extra space above Line 28
    drawHLineWithColor(currentPage, yPosition, BORDER_STRONG, 1);
    yPosition -= 14;

    const displayTotal = totalDeductible;
    currentPage.drawRectangle({
      x: MARGIN,
      y: yPosition - line28RowHeight,
      width: PAGE_WIDTH - 2 * MARGIN,
      height: line28RowHeight,
      color: BRAND_BLUE,
      opacity: LINE28_TINT_OPACITY
    });
    currentPage.drawText('28', { x: colLine, y: yPosition, size: 14, font: boldFont, color: BLACK });
    currentPage.drawText('Total Expenses', { x: colDesc, y: yPosition, size: 14, font: boldFont, color: BLACK });
    drawTextRight(currentPage, formatCurrency(displayTotal), colDeductRight, yPosition, 14, courierBoldFont);
    yPosition -= line28RowHeight;
    drawHLineWithColor(currentPage, yPosition, BORDER_STRONG, 1);
    yPosition -= 8; // extra space below Line 28

    yPosition -= SECTION_GAP;
    // ----- Section 2: Breakdown by Line -----
    currentPage.drawText('Breakdown by Line', {
      x: MARGIN,
      y: yPosition,
      size: SECTION_HEADER,
      font: boldFont,
      color: BRAND_BLUE
    });
    yPosition -= 20;

    const breakdownLineGap = 18;
    lineItemsArray.forEach((item: LineItemSummary, idx: number) => {
      // In confirmed-only mode, these already represent net amounts.
      const adjustedDeductible = item.deductible;
      const adjustedTotal = item.total;

      nextPageIfNeeded(70);
      if (idx > 0) {
        yPosition -= breakdownLineGap;
        drawHLineWithColor(currentPage, yPosition, BORDER_MED, 0.5);
        yPosition -= 14;
      }
      currentPage.drawText(`Line ${item.lineCode} - ${item.lineName}`, {
        x: MARGIN,
        y: yPosition,
        size: 11,
        font: boldFont,
        color: BLACK
      });
      yPosition -= 16;
      currentPage.drawText(`Gross: ${formatCurrency(adjustedTotal)}  •  Deductible: ${formatCurrency(adjustedDeductible)}  •  Transactions: ${item.transactionCount}`, {
        x: MARGIN + 8,
        y: yPosition,
        size: BODY_SIZE,
        font: font,
        color: GRAY
      });
      yPosition -= 22;
    });

    // Breakdown entry for credits if any
    if (hasCredits) {
      nextPageIfNeeded(70);
      yPosition -= breakdownLineGap;
      drawHLineWithColor(currentPage, yPosition, BORDER_MED, 0.5);
      yPosition -= 14;
      currentPage.drawText('Expense Offsets (Credits/Refunds)', {
        x: MARGIN,
        y: yPosition,
        size: 11,
        font: boldFont,
        color: GRAY
      });
      yPosition -= 16;
      currentPage.drawText(`Offset: ${formatCurrency(totalCreditAmount)}  •  Transactions: ${creditsInLines.length}`, {
        x: MARGIN + 8,
        y: yPosition,
        size: BODY_SIZE,
        font: font,
        color: GRAY
      });
      yPosition -= 22;
    }

    yPosition -= SECTION_GAP;

    // ----- Appendix: Transaction Detail by Schedule C Line (conditional) -----
    if (includeAppendix) {
    const appendixRowHeight = 20; // 2-line merchant wrap
    const appendixLineHeight = 10;
    const appendixColDate = MARGIN;
    const appendixColMerchant = MARGIN + 74;
    const appendixColAmountRight = PAGE_WIDTH - MARGIN;
    const appendixMerchantMaxWidth = appendixColAmountRight - appendixColMerchant - 10;

    function wrapMerchant(text: string, wrapFont: PDFFont, size: number, maxWidth: number): string[] {
      const words = (text || 'Unknown').trim().split(/\s+/);
      const lines: string[] = [];
      let line = '';
      const ellipsis = '…';
      for (const w of words) {
        const candidate = line ? `${line} ${w}` : w;
        if (wrapFont.widthOfTextAtSize(candidate, size) <= maxWidth) {
          line = candidate;
        } else {
          if (line) lines.push(line);
          if (wrapFont.widthOfTextAtSize(w, size) <= maxWidth) {
            line = w;
          } else {
            let s = w;
            while (s.length && wrapFont.widthOfTextAtSize(s + ellipsis, size) > maxWidth) s = s.slice(0, -1);
            line = (s || w[0] || '') + ellipsis;
          }
        }
      }
      if (line) lines.push(line);
      if (lines.length > 2) {
        let s = lines[1];
        while (s.length && wrapFont.widthOfTextAtSize(s + ellipsis, size) > maxWidth) s = s.slice(0, -1);
        return [lines[0], (s || lines[1].slice(0, 1)) + ellipsis];
      }
      return lines.slice(0, 2);
    }

    nextPageIfNeeded(80);
    currentPage.drawText('Appendix - Transaction Detail by Schedule C Line', {
      x: MARGIN,
      y: yPosition,
      size: SECTION_HEADER,
      font: boldFont,
      color: BRAND_BLUE
    });
    yPosition -= 28;

    function drawAppendixTableHeader(): void {
      currentPage.drawText('Date', { x: appendixColDate, y: yPosition, size: TABLE_HEADER, font: boldFont, color: BLACK });
      currentPage.drawText('Merchant', { x: appendixColMerchant, y: yPosition, size: TABLE_HEADER, font: boldFont, color: BLACK });
      drawTextRight(currentPage, 'Amount', appendixColAmountRight, yPosition, TABLE_HEADER, courierBoldFont);
      yPosition -= appendixRowHeight;
      drawHLineWithColor(currentPage, yPosition, BORDER_LIGHT, 0.5);
      yPosition -= 10;
    }

    lineItemsArray.forEach((item: LineItemSummary) => {
      if (item.transactions.length === 0) return;

      // In confirmed-only mode, appendix subtotals already reconcile to line totals.
      const adjustedDeductible = item.deductible;

      nextPageIfNeeded(60);
      yPosition -= 10; // spacing before group
      let lastAppendixPage = currentPage;
      currentPage.drawText(`Line ${item.lineCode} - ${item.lineName} (${item.transactionCount} transactions)`, {
        x: MARGIN,
        y: yPosition,
        size: 11,
        font: boldFont,
        color: BLACK
      });
      yPosition -= 14;
      drawHLineWithColor(currentPage, yPosition, BORDER_MED, 0.5);
      yPosition -= 10;

      drawAppendixTableHeader();

      item.transactions.forEach((tx: { date?: string; merchant_name?: string; amount?: number }, rowIndex: number) => {
        nextPageIfNeeded(appendixRowHeight + 24);
        if (currentPage !== lastAppendixPage) {
          lastAppendixPage = currentPage;
          currentPage.drawText(`Line ${item.lineCode} - ${item.lineName} (continued)`, {
            x: MARGIN,
            y: yPosition,
            size: BODY_SIZE,
            font: boldFont,
            color: GRAY
          });
          yPosition -= 14;
          drawAppendixTableHeader();
        }
        if (rowIndex % 2 === 1) {
          currentPage.drawRectangle({
            x: MARGIN,
            y: yPosition - appendixRowHeight,
            width: PAGE_WIDTH - 2 * MARGIN,
            height: appendixRowHeight,
            color: APPENDIX_STRIPE
          });
        }
        const dateText = formatDate(tx.date);
        const merchantLines = wrapMerchant(tx.merchant_name ?? '', font, BODY_SIZE, appendixMerchantMaxWidth);
        const rawAmount = tx.amount ?? 0;
        const isCredit = rawAmount < 0;
        const displayAmt = isCredit ? formatCurrency(rawAmount) : formatCurrency(Math.abs(rawAmount));
        currentPage.drawText(dateText, { x: appendixColDate, y: yPosition, size: BODY_SIZE, font: font, color: BLACK });
        merchantLines.forEach((mLine, i) => {
          currentPage.drawText(mLine, { x: appendixColMerchant, y: yPosition - i * appendixLineHeight, size: BODY_SIZE, font: font, color: BLACK });
        });
        drawTextRight(currentPage, displayAmt, appendixColAmountRight, yPosition, BODY_SIZE, courierFont, isCredit ? GRAY : BLACK);
        yPosition -= appendixRowHeight;
      });

      nextPageIfNeeded(appendixRowHeight + 30);
      if (currentPage !== lastAppendixPage) {
        lastAppendixPage = currentPage;
        currentPage.drawText(`Line ${item.lineCode} - ${item.lineName} (continued)`, {
          x: MARGIN,
          y: yPosition,
          size: BODY_SIZE,
          font: boldFont,
          color: GRAY
        });
        yPosition -= 14;
        drawAppendixTableHeader();
      }

      drawHLineWithColor(currentPage, yPosition, BORDER_STRONG, 1);
      yPosition -= 10;
      currentPage.drawRectangle({
        x: MARGIN,
        y: yPosition - appendixRowHeight,
        width: PAGE_WIDTH - 2 * MARGIN,
        height: appendixRowHeight,
        color: SUBTOTAL_BG
      });
      currentPage.drawText('Subtotal', { x: appendixColMerchant, y: yPosition, size: TABLE_HEADER, font: boldFont, color: BLACK });
      drawTextRight(currentPage, formatCurrency(adjustedDeductible), appendixColAmountRight, yPosition, TABLE_HEADER, courierBoldFont);
      yPosition -= appendixRowHeight + 14;
    });
    } // end if (includeAppendix)

    // ----- Footer: every page = "WriteOff – Schedule C Summary (Tax Year YYYY)" (left), "Page X of Y" (right); disclaimer only on page 1 -----
    const disclaimer = 'This is a summary for data entry into tax software. Not an official IRS form. Consult a tax professional.';
    const footerBrand = `WriteOff - Schedule C Summary (Tax Year ${year})`;
    const pageCount = pdfDoc.getPageCount();
    const yFooter = FOOTER_BOTTOM - 4;

    for (let i = 0; i < pageCount; i++) {
      const p = pdfDoc.getPage(i);
      drawHLineWithColor(p, yFooter + 12, BORDER_LIGHT, 0.5);
      p.drawText(footerBrand, {
        x: MARGIN,
        y: yFooter,
        size: FOOTER_SIZE,
        font: font,
        color: GRAY
      });
      const pageText = `Page ${i + 1} of ${pageCount}`;
      const pageWidth = font.widthOfTextAtSize(pageText, FOOTER_SIZE);
      p.drawText(pageText, {
        x: PAGE_WIDTH - MARGIN - pageWidth,
        y: yFooter,
        size: FOOTER_SIZE,
        font: font,
        color: GRAY
      });
    }
    const page1 = pdfDoc.getPage(0);
    page1.drawText(disclaimer, {
      x: MARGIN,
      y: FOOTER_BOTTOM - 12,
      size: DISCLAIMER_SIZE,
      font: font,
      color: GRAY
    });

    // Posted-date disclosure (page 1 only, below disclaimer)
    const postedDateNote = 'Transactions reflect posted/settled dates within the selected tax year.';
    page1.drawText(postedDateNote, {
      x: MARGIN,
      y: FOOTER_BOTTOM - 22,
      size: DISCLAIMER_SIZE,
      font: font,
      color: GRAY
    });

    const pdfBytes = await pdfDoc.save();
    const filename = `WriteOff_ScheduleC_Summary_${year}.pdf`;

    return new NextResponse(pdfBytes as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });

  } catch (error) {
    console.error('PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}
