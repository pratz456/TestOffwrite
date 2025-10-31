import { NextRequest, NextResponse } from 'next/server'
import { getTransactionsServer, updateTransactionServerWithUserId, createTransactionServer } from '@/lib/firebase/transactions-server'
import { getAuthenticatedUser } from '@/lib/firebase/api-auth'

export async function GET(request: NextRequest) {
  try {
    console.log('🔄 [Database Transactions API] Starting GET request...');
    
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Database Transactions API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ [Database Transactions API] User authenticated:', user.uid);

    const result = await getTransactionsServer(user.uid);
    
    if (result.error) {
      console.error('❌ [Database Transactions API] Error fetching transactions:', result.error);
      return NextResponse.json({ 
        error: 'Failed to fetch transactions',
        details: result.error.message || result.error
      }, { status: 500 })
    }

    console.log(`✅ [Database Transactions API] Successfully fetched ${result.data.length} transactions`);
    return NextResponse.json({ transactions: result.data })
  } catch (error) {
    console.error('❌ [Database Transactions API] Unexpected error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 [Database Transactions API] Starting POST request...');
    
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Database Transactions API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ [Database Transactions API] User authenticated:', user.uid);

    const transactionData = await request.json()
    
    if (!transactionData.trans_id || !transactionData.account_id) {
      console.error('❌ [Database Transactions API] Missing required fields:', { 
        has_trans_id: !!transactionData.trans_id, 
        has_account_id: !!transactionData.account_id 
      });
      return NextResponse.json({ error: 'Transaction ID and Account ID are required' }, { status: 400 })
    }

    console.log('📝 [Database Transactions API] Creating transaction:', {
      trans_id: transactionData.trans_id,
      account_id: transactionData.account_id,
      merchant_name: transactionData.merchant_name
    });

    const result = await createTransactionServer(user.uid, transactionData.account_id, transactionData)
    
    if (result.error) {
      console.error('❌ [Database Transactions API] Error creating transaction:', result.error);
      return NextResponse.json({ 
        error: 'Failed to create transaction',
        details: result.error.message || result.error
      }, { status: 500 })
    }

    console.log('✅ [Database Transactions API] Successfully created transaction');
    return NextResponse.json({ success: true, transaction: result.data })
  } catch (error) {
    console.error('❌ [Database Transactions API] Unexpected error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    console.log('🔄 [Database Transactions API] Starting PUT request...');
    
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Database Transactions API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ [Database Transactions API] User authenticated:', user.uid);

    const { transactionId, updates } = await request.json()
    
    if (!transactionId) {
      console.error('❌ [Database Transactions API] Missing transaction ID');
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 })
    }

    console.log('📝 [Database Transactions API] Updating transaction:', {
      transactionId,
      updates
    });

    const result = await updateTransactionServerWithUserId(user.uid, transactionId, updates)
    
    if (result.error) {
      console.error('❌ [Database Transactions API] Error updating transaction:', result.error);
      return NextResponse.json({ 
        error: 'Failed to update transaction',
        details: result.error.message || result.error
      }, { status: 500 })
    }

    console.log('✅ [Database Transactions API] Successfully updated transaction');
    return NextResponse.json({ success: true, transaction: result.data })
  } catch (error) {
    console.error('❌ [Database Transactions API] Unexpected error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
} 