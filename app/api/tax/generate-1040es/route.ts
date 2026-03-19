import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

const QUARTERLY_DEADLINES: Record<number, { label: string; period: string }> = {
  1: { label: 'April 15', period: 'January 1 - March 31' },
  2: { label: 'June 15', period: 'April 1 - May 31' },
  3: { label: 'September 15', period: 'June 1 - August 31' },
  4: { label: 'January 15 (next year)', period: 'September 1 - December 31' },
};

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { quarter, userProfile, taxCalculation } = await request.json();

    if (!quarter || !taxCalculation) {
      return NextResponse.json({ error: 'Quarter and tax calculation are required' }, { status: 400 });
    }

    const currentYear = new Date().getFullYear();
    const quarterInfo = QUARTERLY_DEADLINES[quarter as number];
    if (!quarterInfo) {
      return NextResponse.json({ error: 'Invalid quarter (must be 1-4)' }, { status: 400 });
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const page = pdfDoc.addPage([612, 792]); // Letter size
    const { width, height } = page.getSize();
    let y = height - 50;
    const leftMargin = 50;
    const rightMargin = width - 50;

    const drawText = (text: string, x: number, yPos: number, options?: { font?: typeof font; size?: number; color?: ReturnType<typeof rgb> }) => {
      page.drawText(text, {
        x,
        y: yPos,
        font: options?.font || font,
        size: options?.size || 10,
        color: options?.color || rgb(0, 0, 0),
      });
    };

    const drawLine = (y1: number) => {
      page.drawLine({
        start: { x: leftMargin, y: y1 },
        end: { x: rightMargin, y: y1 },
        thickness: 0.5,
        color: rgb(0.3, 0.3, 0.3),
      });
    };

    // Header
    drawText('Form 1040-ES', leftMargin, y, { font: boldFont, size: 18 });
    y -= 18;
    drawText(`Estimated Tax Payment Voucher - ${currentYear}`, leftMargin, y, { font: boldFont, size: 12, color: rgb(0.3, 0.3, 0.3) });
    y -= 14;
    drawText('Department of the Treasury - Internal Revenue Service', leftMargin, y, { size: 9, color: rgb(0.4, 0.4, 0.4) });
    y -= 25;
    drawLine(y);
    y -= 20;

    // Quarter info
    drawText(`Quarter ${quarter} Payment Voucher`, leftMargin, y, { font: boldFont, size: 14 });
    y -= 18;
    drawText(`Due Date: ${quarterInfo.label}, ${quarter === 4 ? currentYear + 1 : currentYear}`, leftMargin, y, { size: 11 });
    y -= 15;
    drawText(`Income Period: ${quarterInfo.period}, ${currentYear}`, leftMargin, y, { size: 11, color: rgb(0.3, 0.3, 0.3) });
    y -= 30;
    drawLine(y);
    y -= 25;

    // Taxpayer info
    drawText('TAXPAYER INFORMATION', leftMargin, y, { font: boldFont, size: 11 });
    y -= 20;

    const name = userProfile?.name || user.email || 'Taxpayer';
    const filingStatus = (userProfile?.filing_status || 'single').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    const state = userProfile?.state || 'N/A';

    drawText(`Name:`, leftMargin, y, { font: boldFont, size: 10 });
    drawText(name, leftMargin + 80, y, { size: 10 });
    y -= 16;

    const addr = userProfile?.mailing_address;
    if (addr?.street) {
      drawText(`Address:`, leftMargin, y, { font: boldFont, size: 10 });
      drawText(addr.street, leftMargin + 80, y, { size: 10 });
      y -= 16;
      const cityStateZip = [addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
      if (cityStateZip) {
        drawText('', leftMargin, y);
        drawText(cityStateZip, leftMargin + 80, y, { size: 10 });
        y -= 16;
      }
    }

    drawText(`Filing Status:`, leftMargin, y, { font: boldFont, size: 10 });
    drawText(filingStatus, leftMargin + 80, y, { size: 10 });
    y -= 16;
    drawText(`State:`, leftMargin, y, { font: boldFont, size: 10 });
    drawText(state, leftMargin + 80, y, { size: 10 });
    y -= 16;
    drawText(`Tax Year:`, leftMargin, y, { font: boldFont, size: 10 });
    drawText(`${currentYear}`, leftMargin + 80, y, { size: 10 });
    y -= 30;
    drawLine(y);
    y -= 25;

    // Tax calculation summary
    drawText('ESTIMATED TAX CALCULATION', leftMargin, y, { font: boldFont, size: 11 });
    y -= 25;

    const formatUSD = (amount: number) => {
      return `$${Math.round(amount).toLocaleString('en-US')}`;
    };

    const rows: [string, string][] = [
      ['Estimated Business Income (Schedule C)', formatUSD(taxCalculation.businessIncome || 0)],
      ['W-2 Income', formatUSD(taxCalculation.w2Income || 0)],
      ['Total Estimated Income', formatUSD(taxCalculation.totalIncome || 0)],
      ['', ''],
      ['Estimated Income Tax', formatUSD(taxCalculation.incomeTax || 0)],
      ['Estimated Self-Employment Tax (Schedule SE)', formatUSD(taxCalculation.selfEmploymentTax || 0)],
      ['Total Estimated Tax for Year', formatUSD(taxCalculation.estimatedTax || 0)],
      ['', ''],
      ['Safe Harbor Amount (prior year)', formatUSD(taxCalculation.safeHarborAmount || 0)],
      ['YTD Payments Made', formatUSD(taxCalculation.ytdPayments || 0)],
    ];

    for (const [label, value] of rows) {
      if (label === '') {
        y -= 8;
        continue;
      }
      drawText(label, leftMargin + 10, y, { size: 10 });
      drawText(value, rightMargin - 80, y, { size: 10 });
      y -= 16;
    }

    y -= 10;
    drawLine(y);
    y -= 25;

    // Payment amount
    const paymentAmount = Math.round(taxCalculation.quarterlyAmount || 0);
    drawText(`AMOUNT OF ESTIMATED TAX PAYMENT FOR Q${quarter}`, leftMargin, y, { font: boldFont, size: 12 });
    y -= 25;

    page.drawRectangle({
      x: leftMargin,
      y: y - 10,
      width: rightMargin - leftMargin,
      height: 40,
      borderColor: rgb(0, 0.3, 0.6),
      borderWidth: 2,
      color: rgb(0.95, 0.97, 1),
    });

    drawText(`$${paymentAmount.toLocaleString('en-US')}.00`, leftMargin + 20, y + 5, { font: boldFont, size: 18, color: rgb(0, 0.2, 0.5) });
    y -= 50;

    // Payment instructions
    y -= 10;
    drawText('PAYMENT INSTRUCTIONS', leftMargin, y, { font: boldFont, size: 11 });
    y -= 20;

    const instructions = [
      'Make check or money order payable to "United States Treasury".',
      'Write your SSN and "Form 1040-ES" on the check.',
      `Mail to the IRS address for your state (see IRS.gov/1040es).`,
      'Or pay electronically at IRS.gov/Payments (recommended).',
      'You may also use IRS Direct Pay or EFTPS for free electronic payments.',
    ];

    for (const line of instructions) {
      drawText(`•  ${line}`, leftMargin + 10, y, { size: 9, color: rgb(0.25, 0.25, 0.25) });
      y -= 14;
    }

    y -= 15;
    drawLine(y);
    y -= 15;

    // Footer
    drawText(`Generated by WriteOff - ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, leftMargin, y, { size: 8, color: rgb(0.5, 0.5, 0.5) });
    y -= 12;
    drawText('This is an estimated tax worksheet, not an official IRS form. Consult a tax professional for your specific situation.', leftMargin, y, { size: 7, color: rgb(0.5, 0.5, 0.5) });

    const pdfBytes = await pdfDoc.save();

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Form-1040-ES-Q${quarter}-${currentYear}.pdf"`,
      },
    });

  } catch (error) {
    console.error('❌ [1040-ES] Error generating form:', error);
    return NextResponse.json(
      { error: 'Failed to generate Form 1040-ES', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
