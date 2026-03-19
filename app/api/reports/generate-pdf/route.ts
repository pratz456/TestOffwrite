export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { checkHistoricalAccess } from '@/lib/subscriptions/historical-access';

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 [Reports Generate PDF API] Starting request...');

    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      console.error('❌ [Reports Generate PDF API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ [Reports Generate PDF API] User authenticated:', user.uid);

    // Check subscription access - require active subscription for report exports
    const access = await checkHistoricalAccess(user.uid);
    if (!access.hasAccess) {
      console.log(`⚠️ [Reports Generate PDF API] User ${user.uid} does not have subscription access`);
      return NextResponse.json(
        { 
          error: 'Subscription required', 
          requiresSubscription: true,
          message: 'An active subscription is required to export reports. Please subscribe to access this feature.'
        },
        { status: 403 }
      );
    }

    const reportData = await request.json();

    // Validate report data
    if (!reportData || !reportData.summary || !reportData.monthlyData) {
      console.error('❌ [Reports Generate PDF API] Invalid report data:', reportData);
      return NextResponse.json(
        { error: 'Invalid report data. Missing summary or monthlyData.' },
        { status: 400 }
      );
    }

    console.log('📋 [Reports Generate PDF API] Generating PDF for user:', user.uid);

    // Generate PDF content using pdf-lib
    const pdfBytes = await generatePDFContent(reportData);

    console.log('✅ [Reports Generate PDF API] PDF generated successfully');

    const filename = `tax-report-${new Date().toISOString().split('T')[0]}.pdf`;

    // Return PDF as response
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });

  } catch (error) {
    console.error('❌ [Reports Generate PDF API] Error generating PDF report:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate PDF report',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

async function generatePDFContent(data: any): Promise<Uint8Array> {
  // Create a new PDF document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Standard US Letter size (8.5 x 11 inches)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const margin = 50;
  let yPosition = pageHeight - margin;

  // Header
  page.drawText('TAX DEDUCTION REPORT', {
    x: margin,
    y: yPosition,
    size: 20,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  yPosition -= 30;

  // Report metadata
  page.drawText(`Generated: ${new Date(data.generatedAt).toLocaleDateString()}`, {
    x: margin,
    y: yPosition,
    size: 12,
    font: font,
    color: rgb(0.5, 0.5, 0.5)
  });
  yPosition -= 20;

  if (data.user) {
    page.drawText(`User: ${data.user}`, {
      x: margin,
      y: yPosition,
      size: 12,
      font: font,
      color: rgb(0.5, 0.5, 0.5)
    });
    yPosition -= 30;
  }

  // Summary section
  page.drawText('SUMMARY', {
    x: margin,
    y: yPosition,
    size: 16,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  yPosition -= 30;

  const summaryItems = [
    { label: 'Year to Date Total:', value: `$${data.summary.yearToDateTotal.toFixed(2)}` },
    { label: 'Current Month Total:', value: `$${data.summary.currentMonthTotal.toFixed(2)}` },
    { label: 'Average Monthly:', value: `$${data.summary.avgMonthly.toFixed(2)}` },
    { label: 'Estimated Refund:', value: `$${data.summary.estimatedRefund.toFixed(2)}` },
    { label: 'Months with Data:', value: `${data.summary.monthsWithData}` },
    { label: 'Month over Month Change:', value: `${data.summary.monthOverMonthChange.toFixed(1)}%` }
  ];

  summaryItems.forEach(item => {
    page.drawText(item.label, {
      x: margin,
      y: yPosition,
      size: 12,
      font: font,
      color: rgb(0, 0, 0)
    });

    page.drawText(item.value, {
      x: margin + 200,
      y: yPosition,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0)
    });

    yPosition -= 20;
  });

  yPosition -= 20;

  // Monthly breakdown section
  page.drawText('MONTHLY BREAKDOWN', {
    x: margin,
    y: yPosition,
    size: 16,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  yPosition -= 30;

  // Check if we need a new page before starting the monthly breakdown
  let currentPage = page;
  if (yPosition < 150) {
    currentPage = pdfDoc.addPage([612, 792]);
    yPosition = pageHeight - margin;
  }

  // Table header
  currentPage.drawText('Month', {
    x: margin,
    y: yPosition,
    size: 12,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  currentPage.drawText('Tax Savings', {
    x: margin + 150,
    y: yPosition,
    size: 12,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  currentPage.drawText('Transactions', {
    x: margin + 300,
    y: yPosition,
    size: 12,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  yPosition -= 25;

  // Draw a line under header
  currentPage.drawLine({
    start: { x: margin, y: yPosition },
    end: { x: pageWidth - margin, y: yPosition },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8)
  });

  yPosition -= 15;

  // Monthly data rows
  data.monthlyData.forEach((month: any) => {
    // Check if we need a new page
    if (yPosition < 50) {
      currentPage = pdfDoc.addPage([612, 792]);
      yPosition = pageHeight - margin;
    }

    currentPage.drawText(month.monthName, {
      x: margin,
      y: yPosition,
      size: 11,
      font: font,
      color: rgb(0, 0, 0)
    });

    currentPage.drawText(`$${month.total.toFixed(2)}`, {
      x: margin + 150,
      y: yPosition,
      size: 11,
      font: font,
      color: rgb(0, 0, 0)
    });

    currentPage.drawText(`${month.count}`, {
      x: margin + 300,
      y: yPosition,
      size: 11,
      font: font,
      color: rgb(0, 0, 0)
    });

    yPosition -= 20;
  });

  // Add footer with page number
  const pages = pdfDoc.getPages();
  pages.forEach((page, index) => {
    page.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: pageWidth - margin - 80,
      y: 30,
      size: 10,
      font: font,
      color: rgb(0.5, 0.5, 0.5)
    });
  });

  // Serialize the PDF to bytes
  return await pdfDoc.save();
}
