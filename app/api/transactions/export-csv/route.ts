/**
 * Transaction CSV Export API
 * Exports confirmed transactions as a CSV file for accountants/CPAs.
 * Includes all IRS-relevant fields: date, merchant, amount, category,
 * deductible status, Schedule C line, and AI confidence.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';

function escapeCSV(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function row(fields: (string | number | boolean | null | undefined)[]): string {
  return fields.map(escapeCSV).join(',');
}

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : null;
    const filter = searchParams.get('filter') || 'all'; // all | deductible | non-deductible | unreviewed

    const { data: transactions = [] } = await getTransactionsServer(user.uid);

    // Filter by year if specified
    let filtered = transactions.filter((t: any) => {
      if (!year) return true;
      const dateStr = t.date || t.datetime || '';
      return dateStr.startsWith(String(year));
    });

    // Filter by deductibility
    if (filter === 'deductible') filtered = filtered.filter((t: any) => t.is_deductible === true);
    if (filter === 'non-deductible') filtered = filtered.filter((t: any) => t.is_deductible === false);
    if (filter === 'unreviewed') filtered = filtered.filter((t: any) => t.is_deductible === null || t.is_deductible === undefined);

    // Sort by date
    filtered.sort((a: any, b: any) => {
      const da = a.date || a.datetime || '';
      const db = b.date || b.datetime || '';
      return da.localeCompare(db);
    });

    // Build CSV
    const headers = [
      'Date',
      'Merchant / Description',
      'Amount',
      'Category',
      'Deductible',
      'Schedule C Line',
      'Expense Type',
      'Business Purpose',
      'Account',
      'AI Confidence',
      'Transaction ID',
    ];

    const lines: string[] = [headers.join(',')];

    for (const t of filtered) {
      const tx = t as any; // Transaction type is dynamic from Firestore
      const amount = typeof tx.amount === 'number' ? Math.abs(tx.amount).toFixed(2) : '';
      const date = (tx.date || tx.datetime || '').split('T')[0];
      const merchant = tx.merchant_name || tx.name || tx.description || '';
      const category = Array.isArray(tx.category) ? tx.category[tx.category.length - 1] : (tx.category || '');
      const deductible = tx.is_deductible === true ? 'Yes' : tx.is_deductible === false ? 'No' : 'Unreviewed';
      const scheduleLine = tx.schedule_c_line || tx.scheduleC_line || tx.expense_type || '';
      const expenseType = tx.expense_type || tx.deduction_category || '';
      const purpose = tx.business_purpose || tx.deductible_reason || tx.deduction_reason || '';
      const account = tx.account_id || '';
      const confidence = tx.deduction_score !== undefined ? `${Math.round((tx.deduction_score || 0) * 100)}%` : '';
      const txId = tx.transaction_code || tx.id || tx.trans_id || tx.transaction_id || '';

      lines.push(row([date, merchant, amount, category, deductible, scheduleLine, expenseType, purpose, account, confidence, txId]));
    }

    const csv = lines.join('\n');

    const filename = year
      ? `writeoff-transactions-${year}${filter !== 'all' ? `-${filter}` : ''}.csv`
      : `writeoff-transactions-all${filter !== 'all' ? `-${filter}` : ''}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('CSV export error:', error);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
