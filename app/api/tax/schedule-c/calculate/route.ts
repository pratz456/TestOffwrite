import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get current year
    const currentYear = new Date().getFullYear();
    
    // Fetch all transactions for the user with timeout
    const fetchPromise = getTransactionsServer(user.uid);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Transaction fetch timeout')), 5000)
    );
    
    const { data: transactions, error } = await Promise.race([fetchPromise, timeoutPromise]) as any;
    
    if (error) {
      console.error('Error fetching transactions:', error);
      return NextResponse.json({ 
        data: { 
          netProfit: 0,
          totalIncome: 0,
          totalExpenses: 0,
          message: 'Could not fetch transactions'
        } 
      });
    }

    if (!transactions || transactions.length === 0) {
      return NextResponse.json({ 
        data: { 
          netProfit: 0,
          totalIncome: 0,
          totalExpenses: 0,
          message: 'No transactions found'
        } 
      });
    }

    // Filter transactions for current year
    const currentYearTransactions = transactions.filter(transaction => {
      const transactionDate = new Date(transaction.date);
      return transactionDate.getFullYear() === currentYear;
    });

    // Calculate Schedule C line items
    let totalIncome = 0;
    let totalExpenses = 0;
    
    const scheduleCLineItems: { [key: string]: number } = {
      // Income
      'gross_receipts': 0,
      'returns_allowances': 0,
      
      // Expenses
      'advertising': 0,
      'car_truck_expenses': 0,
      'commissions_fees': 0,
      'contract_labor': 0,
      'depletion': 0,
      'depreciation': 0,
      'employee_benefit_programs': 0,
      'insurance': 0,
      'interest_mortgage': 0,
      'legal_professional_services': 0,
      'office_expenses': 0,
      'pension_profit_sharing': 0,
      'rent_lease_vehicles': 0,
      'rent_lease_other': 0,
      'repairs_maintenance': 0,
      'supplies': 0,
      'taxes_licenses': 0,
      'travel': 0,
      'meals': 0,
      'utilities': 0,
      'wages': 0,
      'other_expenses': 0,
    };

    // Process each transaction
    currentYearTransactions.forEach(transaction => {
      const amount = Math.abs(transaction.amount); // Use absolute value
      
      if (transaction.category === 'income' || transaction.category === 'revenue') {
        totalIncome += amount;
        scheduleCLineItems['gross_receipts'] += amount;
      } else if (transaction.category && scheduleCLineItems.hasOwnProperty(transaction.category)) {
        totalExpenses += amount;
        
        // Apply 50% rule for meals
        if (transaction.category === 'meals') {
          scheduleCLineItems['meals'] += amount * 0.5;
        } else {
          scheduleCLineItems[transaction.category] += amount;
        }
      } else {
        // Uncategorized transactions go to other expenses
        totalExpenses += amount;
        scheduleCLineItems['other_expenses'] += amount;
      }
    });

    // Calculate net profit (Line 31 on Schedule C)
    const netProfit = totalIncome - totalExpenses;

    return NextResponse.json({
      data: {
        netProfit: Math.round(netProfit * 100) / 100, // Round to 2 decimal places
        totalIncome: Math.round(totalIncome * 100) / 100,
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        scheduleCLineItems,
        transactionCount: currentYearTransactions.length,
        year: currentYear
      }
    });

  } catch (error) {
    console.error('Error calculating Schedule C:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to calculate Schedule C' 
    }, { status: 500 });
  }
}
