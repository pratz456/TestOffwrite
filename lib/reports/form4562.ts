import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { UserProfile } from '@/lib/firebase/profiles-server';
import { Asset, calc4562 } from './calc4562';

export interface Form4562Data {
  userProfile: UserProfile;
  assetsSettings: Asset[];
  transactions: any[];
  taxYear: number;
}

export async function generateForm4562PDF(data: Form4562Data): Promise<Uint8Array> {
  const { userProfile, assetsSettings, taxYear } = data;
  
  // Calculate Form 4562 values
  // For now, we'll use a default business income - this should come from Schedule C
  const businessIncome = 100000; // Default business income - should be replaced with actual Schedule C data when available
  const calculation = calc4562(assetsSettings, businessIncome);

  // Create PDF document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Standard US Letter size
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const margin = 50;
  let yPosition = pageHeight - margin;

  // Header
  page.drawText('Form 4562 - Depreciation and Amortization', {
    x: margin,
    y: yPosition,
    size: 18,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  yPosition -= 30;

  page.drawText(`Tax Year: ${taxYear}`, {
    x: margin,
    y: yPosition,
    size: 12,
    font: font,
    color: rgb(0, 0, 0)
  });
  yPosition -= 20;

  page.drawText(`Generated for: ${userProfile.name}`, {
    x: margin,
    y: yPosition,
    size: 12,
    font: font,
    color: rgb(0, 0, 0)
  });
  yPosition -= 20;

  page.drawText(`Generated: ${new Date().toLocaleDateString()}`, {
    x: margin,
    y: yPosition,
    size: 10,
    font: font,
    color: rgb(0.5, 0.5, 0.5)
  });
  yPosition -= 40;

  // Summary Section
  page.drawText('Depreciation Summary', {
    x: margin,
    y: yPosition,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  yPosition -= 25;

  const summaryItems = [
    { label: 'Total Section 179 Deduction:', value: `$${calculation.totalSection179.toFixed(2)}` },
    { label: 'Total Bonus Depreciation:', value: `$${calculation.totalBonusDepreciation.toFixed(2)}` },
    { label: 'Total Regular Depreciation:', value: `$${calculation.totalRegularDepreciation.toFixed(2)}` },
    { label: 'Total Depreciation:', value: `$${calculation.totalDepreciation.toFixed(2)}` },
    { label: 'Total Carryover:', value: `$${calculation.totalCarryover.toFixed(2)}` },
  ];

  summaryItems.forEach(item => {
    page.drawText(item.label, {
      x: margin + 20,
      y: yPosition,
      size: 11,
      font: font,
      color: rgb(0, 0, 0)
    });
    
    page.drawText(item.value, {
      x: margin + 300,
      y: yPosition,
      size: 11,
      font: boldFont,
      color: rgb(0, 0, 0)
    });
    yPosition -= 18;
  });

  yPosition -= 30;

  // Assets Detail
  page.drawText('Asset Details', {
    x: margin,
    y: yPosition,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  yPosition -= 25;

  // Table headers
  const col1 = margin + 10;
  const col2 = margin + 120;
  const col3 = margin + 200;
  const col4 = margin + 280;
  const col5 = margin + 360;
  const col6 = margin + 440;
  const col7 = margin + 520;

  const headers = [
    { text: 'Description', x: col1 },
    { text: 'Cost', x: col2 },
    { text: 'Business %', x: col3 },
    { text: 'Section 179', x: col4 },
    { text: 'Bonus', x: col5 },
    { text: 'Regular', x: col6 },
    { text: 'Total', x: col7 },
  ];

  headers.forEach(header => {
    page.drawText(header.text, {
      x: header.x,
      y: yPosition,
      size: 9,
      font: boldFont,
      color: rgb(0, 0, 0)
    });
  });

  yPosition -= 15;

  // Draw line separator
  page.drawLine({
    start: { x: margin + 10, y: yPosition },
    end: { x: pageWidth - margin, y: yPosition },
    thickness: 1,
    color: rgb(0, 0, 0)
  });

  yPosition -= 10;

  // Asset rows
  calculation.assets.forEach((assetCalc, index) => {
    // Check if we need a new page
    if (yPosition < margin + 100) {
      const newPage = pdfDoc.addPage([612, 792]);
      yPosition = newPage.getHeight() - margin - 50;
      
      // Redraw headers on new page
      headers.forEach(header => {
        newPage.drawText(header.text, {
          x: header.x,
          y: yPosition,
          size: 9,
          font: boldFont,
          color: rgb(0, 0, 0)
        });
      });
      yPosition -= 15;
      
      newPage.drawLine({
        start: { x: margin + 10, y: yPosition },
        end: { x: pageWidth - margin, y: yPosition },
        thickness: 1,
        color: rgb(0, 0, 0)
      });
      yPosition -= 10;
    }

    const asset = assetCalc.asset;
    
    // Truncate description if too long
    const description = asset.description.length > 15 
      ? asset.description.substring(0, 15) + '...' 
      : asset.description;

    page.drawText(description, {
      x: col1,
      y: yPosition,
      size: 8,
      font: font,
      color: rgb(0, 0, 0)
    });

    page.drawText(`$${asset.cost.toFixed(0)}`, {
      x: col2,
      y: yPosition,
      size: 8,
      font: font,
      color: rgb(0, 0, 0)
    });

    page.drawText(`${asset.businessUsePercent}%`, {
      x: col3,
      y: yPosition,
      size: 8,
      font: font,
      color: rgb(0, 0, 0)
    });

    page.drawText(`$${assetCalc.section179Deduction.toFixed(0)}`, {
      x: col4,
      y: yPosition,
      size: 8,
      font: font,
      color: rgb(0, 0, 0)
    });

    page.drawText(`$${assetCalc.bonusDepreciation.toFixed(0)}`, {
      x: col5,
      y: yPosition,
      size: 8,
      font: font,
      color: rgb(0, 0, 0)
    });

    page.drawText(`$${assetCalc.regularDepreciation.toFixed(0)}`, {
      x: col6,
      y: yPosition,
      size: 8,
      font: font,
      color: rgb(0, 0, 0)
    });

    page.drawText(`$${assetCalc.totalDepreciation.toFixed(0)}`, {
      x: col7,
      y: yPosition,
      size: 8,
      font: boldFont,
      color: rgb(0, 0, 0)
    });

    yPosition -= 12;
  });

  yPosition -= 20;

  // Draw line separator
  page.drawLine({
    start: { x: margin + 10, y: yPosition },
    end: { x: pageWidth - margin, y: yPosition },
    thickness: 1,
    color: rgb(0, 0, 0)
  });

  yPosition -= 15;

  // Totals row
  page.drawText('TOTALS:', {
    x: col1,
    y: yPosition,
    size: 9,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  page.drawText(`$${calculation.totalSection179.toFixed(0)}`, {
    x: col4,
    y: yPosition,
    size: 9,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  page.drawText(`$${calculation.totalBonusDepreciation.toFixed(0)}`, {
    x: col5,
    y: yPosition,
    size: 9,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  page.drawText(`$${calculation.totalRegularDepreciation.toFixed(0)}`, {
    x: col6,
    y: yPosition,
    size: 9,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  page.drawText(`$${calculation.totalDepreciation.toFixed(0)}`, {
    x: col7,
    y: yPosition,
    size: 9,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  yPosition -= 40;

  // Important Notes
  page.drawText('Important Notes:', {
    x: margin,
    y: yPosition,
    size: 12,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  yPosition -= 20;

  const notes = [
    '• This is an unofficial rendering of Form 4562 calculations',
    '• Values map 1:1 to IRS Form 4562 fields',
    '• Consult a tax professional for proper filing',
    '• Section 179 limit for 2024: $1,160,000',
    '• Bonus depreciation rate for 2024: 60%',
    '• Keep detailed records of all business assets',
  ];

  notes.forEach(note => {
    page.drawText(note, {
      x: margin + 20,
      y: yPosition,
      size: 9,
      font: font,
      color: rgb(0, 0, 0)
    });
    yPosition -= 12;
  });

  // Footer
  yPosition = margin + 30;
  page.drawText('Generated by WriteOff App - Unofficial tax form rendering', {
    x: margin,
    y: yPosition,
    size: 8,
    font: font,
    color: rgb(0.5, 0.5, 0.5)
  });

  // Generate PDF bytes
  return await pdfDoc.save();
}
