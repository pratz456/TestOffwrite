export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { adminDb } from '@/lib/firebase/admin';
import { getUserTaxRate } from '@/lib/tax-rules/federal-brackets';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const CATEGORY_LABELS: Record<string, string> = {
  advertising_marketing: 'Advertising & Marketing',
  supplies_small_tools: 'Office Supplies & Small Tools',
  software_subscriptions: 'Software & Subscriptions',
  contract_labor: 'Contract Labor',
  equipment: 'Equipment',
  vehicle_expense: 'Vehicle Expenses',
  travel: 'Travel',
  meals_50: 'Meals (50% deductible)',
  home_office: 'Home Office',
  utilities_phone_internet: 'Utilities, Phone & Internet',
  education_training: 'Education & Training',
  dues_and_memberships: 'Dues & Memberships',
  bank_and_payment_fees: 'Bank & Payment Fees',
  rent: 'Rent',
  other: 'Other Expenses',
  cost_of_goods_sold: 'Cost of Goods Sold',
};

function parseDateToISO(dateLike: unknown): string {
  try {
    if (!dateLike) return '';
    if (typeof (dateLike as { toDate?: () => Date })?.toDate === 'function') {
      return (dateLike as { toDate: () => Date }).toDate().toISOString();
    }
    if (dateLike instanceof Date) return dateLike.toISOString();
    if (typeof dateLike === 'number') return new Date(dateLike).toISOString();
    if (typeof dateLike === 'string') {
      const d = new Date(dateLike);
      return isNaN(d.getTime()) ? String(dateLike) : d.toISOString();
    }
    return String(dateLike);
  } catch {
    return String(dateLike);
  }
}

function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] || category || 'Other Expenses';
}

async function fetchAllTransactions(uid: string): Promise<Array<{ amount: number; category: string; date: string; merchant_name: string }>> {
  const accountsSnap = await adminDb.collection(`user_profiles/${uid}/accounts`).get();
  const all: Array<{ amount: number; category: string; date: string; merchant_name: string }> = [];

  for (const accDoc of accountsSnap.docs) {
    const txSnap = await adminDb
      .collection(`user_profiles/${uid}/accounts/${accDoc.id}/transactions`)
      .get();

    for (const doc of txSnap.docs) {
      const data = doc.data();
      const amount = typeof data.amount === 'number' ? data.amount : Number(data.amount) || 0;
      const dateIso = parseDateToISO(data.date ?? data.created_at ?? data.updated_at);
      all.push({
        amount,
        category: data.category || '',
        date: dateIso,
        merchant_name: data.merchant_name || data.merchant || 'Unknown',
      });
    }
  }

  return all;
}

function filterByPeriod(
  transactions: Array<{ amount: number; category: string; date: string; merchant_name: string }>,
  year: number,
  month?: number
): typeof transactions {
  return transactions.filter((t) => {
    if (!t.date) return false;
    const d = new Date(t.date);
    const y = d.getFullYear();
    if (y !== year) return false;
    if (month != null && month >= 1 && month <= 12) {
      return d.getMonth() + 1 === month;
    }
    return true;
  });
}

function computePL(
  transactions: Array<{ amount: number; category: string; date: string; merchant_name: string }>,
  incomeTaxRate: number = 0.25
) {
  const incomeBySource: Record<string, number> = {};
  let costOfGoodsSold = 0;
  const expensesByCategory: Record<string, number> = {};

  for (const t of transactions) {
    if (t.amount > 0) {
      const source = t.merchant_name || 'Other Income';
      incomeBySource[source] = (incomeBySource[source] || 0) + t.amount;
    } else if (t.category === 'cost_of_goods_sold') {
      costOfGoodsSold += Math.abs(t.amount);
    } else if (t.amount < 0) {
      const cat = t.category || 'other';
      expensesByCategory[cat] = (expensesByCategory[cat] || 0) + Math.abs(t.amount);
    }
  }

  const totalIncome = Object.values(incomeBySource).reduce((a, b) => a + b, 0);
  const totalExpenses = Object.values(expensesByCategory).reduce((a, b) => a + b, 0);
  const grossProfit = totalIncome - costOfGoodsSold;
  const netProfit = grossProfit - totalExpenses;

  // Effective tax rate estimate: SE tax (15.3%) + income tax (user-specific rate)
  const selfEmploymentTax = Math.max(0, netProfit) * 0.153;
  const taxableIncome = Math.max(0, netProfit - selfEmploymentTax * 0.5);
  const incomeTaxEst = taxableIncome * incomeTaxRate;
  const effectiveTaxRate =
    netProfit > 0 ? (selfEmploymentTax + incomeTaxEst) / netProfit : null;

  return {
    incomeBySource: Object.entries(incomeBySource).map(([source, amount]) => ({ source, amount })),
    costOfGoodsSold,
    grossProfit,
    expensesByCategory: Object.entries(expensesByCategory).map(([category, amount]) => ({
      category,
      label: getCategoryLabel(category),
      amount,
    })),
    totalIncome,
    totalExpenses,
    netProfit,
    effectiveTaxRate: effectiveTaxRate != null ? Math.round(effectiveTaxRate * 10000) / 100 : null,
    selfEmploymentTax,
    incomeTax: incomeTaxEst,
  };
}

export async function POST(request: NextRequest) {
  try {
    console.log('📊 [P&L Report] POST request received');

    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      console.log('❌ [P&L Report] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: { year?: number; month?: number } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const year = body.year ?? new Date().getFullYear();
    const month = body.month;

    console.log(`📊 [P&L Report] Fetching transactions for user ${user.uid}, year ${year}${month != null ? `, month ${month}` : ''}`);

    const allTx = await fetchAllTransactions(user.uid);
    const filtered = filterByPeriod(allTx, year, month);

    const { data: userProfile } = await getUserProfileServer(user.uid);
    const incomeTaxRate = getUserTaxRate(userProfile ?? undefined);

    const current = computePL(filtered, incomeTaxRate);

    // Prior period comparison
    let priorPeriod: typeof current | null = null;
    if (month != null) {
      const priorMonth = month === 1 ? 12 : month - 1;
      const priorYear = month === 1 ? year - 1 : year;
      const priorFiltered = filterByPeriod(allTx, priorYear, priorMonth);
      if (priorFiltered.length > 0) {
        priorPeriod = computePL(priorFiltered, incomeTaxRate);
      }
    } else {
      const priorFiltered = filterByPeriod(allTx, year - 1);
      if (priorFiltered.length > 0) {
        priorPeriod = computePL(priorFiltered, incomeTaxRate);
      }
    }

    const response = {
      year,
      month: month ?? null,
      periodLabel: month != null ? `${year}-${String(month).padStart(2, '0')}` : `${year}`,
      income: current.incomeBySource,
      costOfGoodsSold: current.costOfGoodsSold,
      grossProfit: current.grossProfit,
      operatingExpenses: current.expensesByCategory,
      totalIncome: current.totalIncome,
      totalExpenses: current.totalExpenses,
      netProfit: current.netProfit,
      effectiveTaxRate: current.effectiveTaxRate,
      selfEmploymentTax: current.selfEmploymentTax,
      incomeTax: current.incomeTax,
      priorPeriod: priorPeriod
        ? {
            totalIncome: priorPeriod.totalIncome,
            totalExpenses: priorPeriod.totalExpenses,
            netProfit: priorPeriod.netProfit,
          }
        : null,
      transactionCount: filtered.length,
    };

    console.log(`📊 [P&L Report] Returning data: ${filtered.length} transactions, net profit $${current.netProfit.toFixed(2)}`);
    return NextResponse.json(response);
  } catch (err) {
    console.error('❌ [P&L Report] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate P&L report' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format');
    const yearParam = searchParams.get('year');
    const monthParam = searchParams.get('month');

    if (format !== 'pdf') {
      return NextResponse.json({ error: 'Use POST for JSON data. GET supports format=pdf only.' }, { status: 400 });
    }

    console.log('📊 [P&L Report] GET PDF request');

    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
    const month = monthParam ? parseInt(monthParam, 10) : undefined;

    const allTx = await fetchAllTransactions(user.uid);
    const filtered = filterByPeriod(allTx, year, month);

    const { data: userProfile } = await getUserProfileServer(user.uid);
    const incomeTaxRate = getUserTaxRate(userProfile ?? undefined);
    const pl = computePL(filtered, incomeTaxRate);

    const pdfBytes = await generatePLPDF({
      year,
      month,
      ...pl,
      transactionCount: filtered.length,
    });

    const periodLabel = month != null ? `${year}-${String(month).padStart(2, '0')}` : `${year}`;
    const filename = `profit-loss-${periodLabel}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (err) {
    console.error('❌ [P&L Report] PDF error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate PDF' },
      { status: 500 }
    );
  }
}

async function generatePLPDF(data: {
  year: number;
  month?: number;
  totalIncome: number;
  costOfGoodsSold: number;
  grossProfit: number;
  totalExpenses: number;
  netProfit: number;
  effectiveTaxRate: number | null;
  incomeBySource: Array<{ source: string; amount: number }>;
  expensesByCategory: Array<{ category: string; label: string; amount: number }>;
  transactionCount: number;
}): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  let y = 792 - margin;

  const periodLabel = data.month != null
    ? `${data.year}-${String(data.month).padStart(2, '0')}`
    : `${data.year}`;

  page.drawText('PROFIT & LOSS STATEMENT', {
    x: margin,
    y,
    size: 20,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  y -= 24;

  page.drawText(`Period: ${periodLabel}`, {
    x: margin,
    y,
    size: 12,
    font: font,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 30;

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  page.drawText('INCOME', { x: margin, y, size: 14, font: boldFont, color: rgb(0, 0, 0) });
  y -= 20;

  for (const { source, amount } of data.incomeBySource) {
    page.drawText(source, { x: margin, y, size: 10, font: font, color: rgb(0, 0, 0) });
    page.drawText(`$${fmt(amount)}`, { x: 450, y, size: 10, font: font, color: rgb(0, 0, 0) });
    y -= 16;
  }
  page.drawText('Total Income', { x: margin, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
  page.drawText(`$${fmt(data.totalIncome)}`, { x: 450, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
  y -= 24;

  if (data.costOfGoodsSold > 0) {
    page.drawText('Cost of Goods Sold', { x: margin, y, size: 10, font: font, color: rgb(0, 0, 0) });
    page.drawText(`($${fmt(data.costOfGoodsSold)})`, { x: 450, y, size: 10, font: font, color: rgb(0, 0, 0) });
    y -= 16;
    page.drawText('Gross Profit', { x: margin, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
    page.drawText(`$${fmt(data.grossProfit)}`, { x: 450, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
    y -= 24;
  }

  page.drawText('OPERATING EXPENSES', { x: margin, y, size: 14, font: boldFont, color: rgb(0, 0, 0) });
  y -= 20;

  for (const { label, amount } of data.expensesByCategory) {
    page.drawText(label, { x: margin, y, size: 10, font: font, color: rgb(0, 0, 0) });
    page.drawText(`$${fmt(amount)}`, { x: 450, y, size: 10, font: font, color: rgb(0, 0, 0) });
    y -= 16;
  }
  page.drawText('Total Expenses', { x: margin, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
  page.drawText(`$${fmt(data.totalExpenses)}`, { x: 450, y, size: 11, font: boldFont, color: rgb(0, 0, 0) });
  y -= 28;

  page.drawText('NET PROFIT / (LOSS)', { x: margin, y, size: 12, font: boldFont, color: rgb(0, 0, 0) });
  page.drawText(
    `$${data.netProfit >= 0 ? '' : '('}${fmt(Math.abs(data.netProfit))}${data.netProfit >= 0 ? '' : ')'}`,
    { x: 450, y, size: 12, font: boldFont, color: rgb(0, 0, 0) }
  );
  y -= 20;

  if (data.effectiveTaxRate != null && data.netProfit > 0) {
    page.drawText(`Effective Tax Rate (est.): ${data.effectiveTaxRate.toFixed(1)}%`, {
      x: margin,
      y,
      size: 10,
      font: font,
      color: rgb(0.4, 0.4, 0.4),
    });
    y -= 16;
  }

  page.drawText(`Transactions: ${data.transactionCount}`, {
    x: margin,
    y,
    size: 9,
    font: font,
    color: rgb(0.5, 0.5, 0.5),
  });

  return pdfDoc.save();
}
