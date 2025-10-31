export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

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

    // Fetch all transactions for the user
    const { data: allTransactions, error } = await getTransactionsServer(user.uid);

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
      year: parseInt(year)
    });

  } catch (error) {
    console.error('Error in transactions API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}