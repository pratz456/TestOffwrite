export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getTransactionsServer, MAX_TRANSACTIONS_PAGE_SIZE } from '@/lib/firebase/transactions-server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

const OWNER_DATA_CACHE_CONTROL = 'private, no-store';

export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const year = searchParams.get('year') || new Date().getFullYear().toString();

    // Optional cursor paging: `limit` (1..MAX_TRANSACTIONS_PAGE_SIZE) plus the `nextCursor` from the
    // previous page. Without `limit` the response is the full list, exactly as before.
    const limitParam = searchParams.get('limit');
    const cursor = searchParams.get('cursor');
    let limit: number | undefined;
    if (limitParam !== null) {
      limit = Number.parseInt(limitParam, 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TRANSACTIONS_PAGE_SIZE) {
        return NextResponse.json({ error: `limit must be an integer between 1 and ${MAX_TRANSACTIONS_PAGE_SIZE}` }, { status: 400 });
      }
    }

    const { data: allTransactions, error, nextCursor } = await getTransactionsServer(
      user.uid,
      limit ? { limit, cursor } : undefined
    );

    if (error) {
      console.error('Error fetching transactions:', error);
      return NextResponse.json({ error: 'Failed to fetch transactions' }, { status: 500 });
    }

    let filteredTransactions = allTransactions || [];

    // Filter by month if specified
    if (month) {
      const targetMonth = parseInt(month);
      const targetYear = parseInt(year);
      
      filteredTransactions = filteredTransactions.filter(transaction => {
        const transactionDate = new Date(transaction.date);
        return transactionDate.getMonth() === targetMonth && 
               transactionDate.getFullYear() === targetYear;
      });
    }

    // Sort by date (newest first)
    filteredTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({ 
      success: true,
      transactions: filteredTransactions,
      data: filteredTransactions, // Keep both for backward compatibility
      count: filteredTransactions.length,
      month: month ? parseInt(month) : null,
      year: parseInt(year),
      // Paged reads only; `null` means the last page (or an unpaged read). Month filters apply per page.
      nextCursor: limit ? nextCursor : null,
    }, { headers: { 'Cache-Control': OWNER_DATA_CACHE_CONTROL } });

  } catch (error) {
    console.error('Error in transactions API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}