import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { UserProfile } from '@/lib/firebase/profiles-server';
import { TaxSummarySettings, calcScheduleSE } from './calcSE';

export interface ScheduleSEData {
  userProfile: UserProfile;
  taxSummarySettings: TaxSummarySettings;
  transactions: any[];
  taxYear: number;
}

export async function generateScheduleSEPDF(data: ScheduleSEData): Promise<Uint8Array> {
  const { userProfile, taxSummarySettings, taxYear } = data;
  
  // Calculate Schedule SE values
  const calculation = calcScheduleSE(taxSummarySettings, userProfile.filing_status);

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
  page.drawText('Schedule SE - Self-Employment Tax', {
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

  page.drawText(`Filing Status: ${userProfile.filing_status}`, {
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

  // Calculation Summary
  page.drawText('Self-Employment Tax Calculation', {
    x: margin,
    y: yPosition,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  yPosition -= 25;

  const calculationItems = [
    { label: 'Net Profit from Schedule C:', value: `$${calculation.netProfitFromScheduleC.toFixed(2)}` },
    { label: 'Adjustments:', value: `$${calculation.adjustments.toFixed(2)}` },
    { label: 'Net Earnings:', value: `$${calculation.netEarnings.toFixed(2)}` },
    { label: 'SE Base (92.35%):', value: `$${calculation.seBase.toFixed(2)}` },
  ];

  calculationItems.forEach(item => {
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

  yPosition -= 20;

  // Tax Breakdown
  page.drawText('Tax Breakdown', {
    x: margin,
    y: yPosition,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  yPosition -= 25;

  const taxItems = [
    { label: 'Social Security Tax (12.4%):', value: `$${calculation.socialSecurityTax.toFixed(2)}` },
    { label: 'Medicare Tax (2.9%):', value: `$${calculation.medicareTax.toFixed(2)}` },
    { label: 'Additional Medicare Tax (0.9%):', value: `$${calculation.additionalMedicareTax.toFixed(2)}` },
  ];

  taxItems.forEach(item => {
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

  yPosition -= 20;

  // Draw line separator
  page.drawLine({
    start: { x: margin + 20, y: yPosition },
    end: { x: pageWidth - margin, y: yPosition },
    thickness: 1,
    color: rgb(0, 0, 0)
  });

  yPosition -= 15;

  // Total SE Tax
  page.drawText('Total Self-Employment Tax:', {
    x: margin + 20,
    y: yPosition,
    size: 12,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  
  page.drawText(`$${calculation.totalSETax.toFixed(2)}`, {
    x: margin + 300,
    y: yPosition,
    size: 12,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  yPosition -= 30;

  // Half SE Deduction
  page.drawText('Half of SE Tax (Deductible on Schedule 1):', {
    x: margin + 20,
    y: yPosition,
    size: 11,
    font: boldFont,
    color: rgb(0, 0.5, 0)
  });
  
  page.drawText(`$${calculation.halfSEDeduction.toFixed(2)}`, {
    x: margin + 300,
    y: yPosition,
    size: 11,
    font: boldFont,
    color: rgb(0, 0.5, 0)
  });

  yPosition -= 40;

  // Tax Rates and Limits
  page.drawText('2024 Tax Rates and Limits', {
    x: margin,
    y: yPosition,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  yPosition -= 25;

  const rateItems = [
    { label: 'Social Security Rate:', value: '12.4%' },
    { label: 'Social Security Wage Base:', value: '$168,600' },
    { label: 'Medicare Rate:', value: '2.9%' },
    { label: 'Additional Medicare Rate:', value: '0.9%' },
    { label: 'Additional Medicare Threshold (Single):', value: '$200,000' },
    { label: 'Additional Medicare Threshold (Married):', value: '$250,000' },
    { label: 'SE Adjustment Factor:', value: '92.35%' },
  ];

  rateItems.forEach(item => {
    page.drawText(item.label, {
      x: margin + 20,
      y: yPosition,
      size: 10,
      font: font,
      color: rgb(0, 0, 0)
    });
    
    page.drawText(item.value, {
      x: margin + 300,
      y: yPosition,
      size: 10,
      font: boldFont,
      color: rgb(0, 0, 0)
    });
    yPosition -= 15;
  });

  yPosition -= 30;

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
    '• This is an unofficial rendering of Schedule SE calculations',
    '• Values map 1:1 to IRS Schedule SE fields',
    '• Consult a tax professional for proper filing',
    '• Half of SE tax is deductible on Schedule 1',
    '• SE tax is calculated on 92.35% of net earnings',
    '• Social Security tax is capped at the wage base',
    '• Additional Medicare tax applies to high earners',
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
