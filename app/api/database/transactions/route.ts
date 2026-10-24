import { NextRequest, NextResponse } from 'next/server'
import { getTransactionServer, getTransactionsServer, updateTransactionServerWithUserId, createTransactionServer } from '@/lib/firebase/transactions-server'
import { getAuthenticatedUser } from '@/lib/firebase/api-auth'
import { filledAmountUpdate, transactionCreateInput, transactionIdInput, transactionUpdatesInput } from '@/lib/transactions/client-updates'
import { NULL_AMOUNT_DEDUCTION_MESSAGE } from '@/lib/transactions/tax-decision'

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
        error: 'Failed to fetch transactions'
      }, { status: 500 })
    }

    console.log(`✅ [Database Transactions API] Successfully fetched ${result.data.length} transactions`);
    return NextResponse.json({ transactions: result.data })
  } catch (error) {
    console.error('❌ [Database Transactions API] Unexpected error:', error);
    return NextResponse.json({ 
      error: 'Internal server error'
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

    const parsed = transactionCreateInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Provide valid transaction fields. Ownership is assigned by the server.' }, { status: 400 });
    const transactionData = parsed.data;

    console.log('📝 [Database Transactions API] Creating transaction:', {
      trans_id: transactionData.trans_id,
      account_id: transactionData.account_id,
      merchant_name: transactionData.merchant_name
    });

    const result = await createTransactionServer(user.uid, transactionData.account_id, transactionData)
    
    if (result.error) {
      console.error('❌ [Database Transactions API] Error creating transaction:', result.error);
      return NextResponse.json({ 
        error: 'Failed to create transaction'
      }, { status: 500 })
    }

    console.log('✅ [Database Transactions API] Successfully created transaction');
    return NextResponse.json({ success: true, transaction: result.data })
  } catch (error) {
    console.error('❌ [Database Transactions API] Unexpected error:', error);
    return NextResponse.json({ 
      error: 'Internal server error'
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

    const body = await request.json().catch(() => null);
    const parsedId = transactionIdInput.safeParse(body?.transactionId);
    const parsed = transactionUpdatesInput.safeParse(body?.updates);
    if (!parsedId.success || !parsed.success) return NextResponse.json({ error: 'Provide a valid transaction ID and editable transaction fields. Ownership, amounts and AI fields cannot be changed here.' }, { status: 400 });
    const transactionId = parsedId.data;
    let updates = parsed.data;
    if (parsed.data.amount !== undefined) {
      const existing = await getTransactionServer(user.uid, transactionId);
      const filled = filledAmountUpdate(existing.data?.amount, parsed.data);
      if (!filled) return NextResponse.json({ error: 'An amount can be entered only while the saved amount is blank.' }, { status: 400 });
      updates = filled;
    }

    console.log('📝 [Database Transactions API] Updating transaction:', {
      transactionId,
      updates
    });

    const result = await updateTransactionServerWithUserId(user.uid, transactionId, updates)
    
    if (result.error) {
      console.error('❌ [Database Transactions API] Error updating transaction:', result.error);
      if (result.error instanceof Error && result.error.message === NULL_AMOUNT_DEDUCTION_MESSAGE) {
        return NextResponse.json({ error: result.error.message }, { status: 400 });
      }
      return NextResponse.json({ 
        error: 'Failed to update transaction'
      }, { status: 500 })
    }

    console.log('✅ [Database Transactions API] Successfully updated transaction');
    return NextResponse.json({ success: true, transaction: result.data })
  } catch (error) {
    console.error('❌ [Database Transactions API] Unexpected error:', error);
    return NextResponse.json({ 
      error: 'Internal server error'
    }, { status: 500 })
  }
} 