import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { UserProfile } from '@/lib/firebase/profiles-server';
import { HomeOfficeSettings, calc8829 } from './calc8829';

export interface Form8829Data {
  userProfile: UserProfile;
  homeOfficeSettings: HomeOfficeSettings;
  transactions: any[];
  taxYear: number;
}

export async function generateForm8829PDF(data: Form8829Data): Promise<Uint8Array> {
  const { userProfile, homeOfficeSettings, taxYear } = data;
  
  // Calculate Form 8829 values
  const calculation = calc8829(homeOfficeSettings);

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
  page.drawText('Form 8829 - Expenses for Business Use of Your Home', {
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

  // Home Office Information
  page.drawText('Home Office Information', {
    x: margin,
    y: yPosition,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  yPosition -= 25;

  const homeOfficeInfo = [
    { label: 'Total Home Square Footage:', value: `${homeOfficeSettings.totalHomeSqFt.toLocaleString()} sq ft` },
    { label: 'Office Square Footage:', value: `${homeOfficeSettings.officeSqFt.toLocaleString()} sq ft` },
    { label: 'Business Use Percentage:', value: `${calculation.businessUsePercentage.toFixed(2)}%` },
  ];

  homeOfficeInfo.forEach(info => {
    page.drawText(info.label, {
      x: margin + 20,
      y: yPosition,
      size: 11,
      font: font,
      color: rgb(0, 0, 0)
    });
    
    page.drawText(info.value, {
      x: margin + 300,
      y: yPosition,
      size: 11,
      font: boldFont,
      color: rgb(0, 0, 0)
    });
    yPosition -= 18;
  });

  yPosition -= 20;

  // Expense Allocation
  page.drawText('Expense Allocation', {
    x: margin,
    y: yPosition,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0)
  });
  yPosition -= 25;

  // Table headers
  const col1 = margin + 20;
  const col2 = margin + 200;
  const col3 = margin + 400;
  const col4 = margin + 500;

  page.drawText('Expense Type', {
    x: col1,
    y: yPosition,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  page.drawText('Total Amount', {
    x: col2,
    y: yPosition,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  page.drawText('Business %', {
    x: col3,
    y: yPosition,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  page.drawText('Allocated', {
    x: col4,
    y: yPosition,
    size: 10,
    font: boldFont,
    color: rgb(0, 0, 0)
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

  // Expense rows
  const expenses = [
    { name: 'Rent or Mortgage Interest', total: homeOfficeSettings.rentOrMortgageInterest, allocated: calculation.allocatedExpenses.rentOrMortgageInterest },
    { name: 'Utilities', total: homeOfficeSettings.utilities, allocated: calculation.allocatedExpenses.utilities },
    { name: 'Insurance', total: homeOfficeSettings.insurance, allocated: calculation.allocatedExpenses.insurance },
    { name: 'Repairs & Maintenance', total: homeOfficeSettings.repairsMaintenance, allocated: calculation.allocatedExpenses.repairsMaintenance },
    { name: 'Property Tax', total: homeOfficeSettings.propertyTax, allocated: calculation.allocatedExpenses.propertyTax },
    { name: 'Other Expenses', total: homeOfficeSettings.other, allocated: calculation.allocatedExpenses.other },
  ];

  expenses.forEach(expense => {
    page.drawText(expense.name, {
      x: col1,
      y: yPosition,
      size: 10,
      font: font,
      color: rgb(0, 0, 0)
    });

    page.drawText(`$${expense.total.toFixed(2)}`, {
      x: col2,
      y: yPosition,
      size: 10,
      font: font,
      color: rgb(0, 0, 0)
    });

    page.drawText(`${calculation.businessUsePercentage.toFixed(2)}%`, {
      x: col3,
      y: yPosition,
      size: 10,
      font: font,
      color: rgb(0, 0, 0)
    });

    page.drawText(`$${expense.allocated.toFixed(2)}`, {
      x: col4,
      y: yPosition,
      size: 10,
      font: font,
      color: rgb(0, 0, 0)
    });

    yPosition -= 15;
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

  // Totals
  page.drawText('Total Allocated Expenses:', {
    x: col1,
    y: yPosition,
    size: 11,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  page.drawText(`$${calculation.totalAllocatedExpenses.toFixed(2)}`, {
    x: col4,
    y: yPosition,
    size: 11,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  yPosition -= 25;

  // Direct Office Expenses
  page.drawText('Direct Office Expenses:', {
    x: col1,
    y: yPosition,
    size: 11,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  page.drawText(`$${calculation.directOfficeExpenses.toFixed(2)}`, {
    x: col4,
    y: yPosition,
    size: 11,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  yPosition -= 25;

  // Total Allowable Deduction
  page.drawText('Total Allowable Deduction:', {
    x: col1,
    y: yPosition,
    size: 12,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  page.drawText(`$${calculation.totalAllowableDeduction.toFixed(2)}`, {
    x: col4,
    y: yPosition,
    size: 12,
    font: boldFont,
    color: rgb(0, 0, 0)
  });

  yPosition -= 30;

  // Carryover Information
  if (calculation.carryoverToNextYear > 0) {
    page.drawText('Carryover to Next Year:', {
      x: col1,
      y: yPosition,
      size: 11,
      font: boldFont,
      color: rgb(0.8, 0, 0)
    });

    page.drawText(`$${calculation.carryoverToNextYear.toFixed(2)}`, {
      x: col4,
      y: yPosition,
      size: 11,
      font: boldFont,
      color: rgb(0.8, 0, 0)
    });

    yPosition -= 20;

    page.drawText('Note: Maximum home office deduction is $1,500 for 2024.', {
      x: margin + 20,
      y: yPosition,
      size: 9,
      font: font,
      color: rgb(0.5, 0.5, 0.5)
    });
  }

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
    '• This is an unofficial rendering of Form 8829 calculations',
    '• Values map 1:1 to IRS Form 8829 fields',
    '• Consult a tax professional for proper filing',
    '• Keep records of all home office expenses',
    '• Business use percentage is calculated as: Office sq ft ÷ Total home sq ft',
  ];

  notes.forEach(note => {
    page.drawText(note, {
      x: margin + 20,
      y: yPosition,
      size: 9,
      font: font,
      color: rgb(0, 0, 0)
    });
    yPosition -= 15;
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
