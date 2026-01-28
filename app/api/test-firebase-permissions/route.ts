export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';

export async function POST(req: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(req);
    
    console.log(`🧪 [Test Firebase] Testing Firebase Admin SDK permissions for user: ${uid}`);
    
    // Test 1: Create a test account
    const testAccountId = `test_account_${Date.now()}`;
    const testAccountRef = adminDb.doc(`user_profiles/${uid}/accounts/${testAccountId}`);
    
    try {
      await testAccountRef.set({
        id: testAccountId,
        name: 'Test Account',
        type: 'test',
        createdAt: Date.now(),
        user_id: uid,
      });
      console.log(`✅ [Test Firebase] Successfully created test account: ${testAccountId}`);
    } catch (accountError) {
      console.error(`❌ [Test Firebase] Failed to create test account:`, accountError);
      return NextResponse.json({ 
        error: 'Failed to create test account',
        details: accountError.message,
        code: accountError.code
      }, { status: 500 });
    }
    
    // Test 2: Create a test transaction
    const testTransactionId = `test_transaction_${Date.now()}`;
    const testTransactionRef = adminDb.doc(`user_profiles/${uid}/accounts/${testAccountId}/transactions/${testTransactionId}`);
    
    try {
      await testTransactionRef.set({
        id: testTransactionId,
        analysis_status: 'pending',
        analysisStatus: 'pending',
        user_id: uid,
        userId: uid,
        account_id: testAccountId,
        accountId: testAccountId,
        trans_id: testTransactionId,
        date: '2024-01-01',
        amount: 100.00,
        merchant_name: 'Test Merchant',
        category: 'Test Category',
        description: 'Test Transaction',
        is_deductible: null,
        analyzed: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      console.log(`✅ [Test Firebase] Successfully created test transaction: ${testTransactionId}`);
    } catch (transactionError) {
      console.error(`❌ [Test Firebase] Failed to create test transaction:`, transactionError);
      return NextResponse.json({ 
        error: 'Failed to create test transaction',
        details: transactionError.message,
        code: transactionError.code
      }, { status: 500 });
    }
    
    // Test 3: Verify we can read the data
    try {
      const accountSnap = await testAccountRef.get();
      const transactionSnap = await testTransactionRef.get();
      
      console.log(`✅ [Test Firebase] Successfully read test data:`, {
        accountExists: accountSnap.exists,
        transactionExists: transactionSnap.exists
      });
    } catch (readError) {
      console.error(`❌ [Test Firebase] Failed to read test data:`, readError);
      return NextResponse.json({ 
        error: 'Failed to read test data',
        details: readError.message,
        code: readError.code
      }, { status: 500 });
    }
    
    // Clean up test data
    try {
      await testTransactionRef.delete();
      await testAccountRef.delete();
      console.log(`✅ [Test Firebase] Successfully cleaned up test data`);
    } catch (cleanupError) {
      console.warn(`⚠️ [Test Firebase] Failed to clean up test data:`, cleanupError);
    }
    
    return NextResponse.json({ 
      success: true,
      message: 'Firebase Admin SDK permissions are working correctly',
      userId: uid,
      tests: {
        createAccount: 'success',
        createTransaction: 'success',
        readData: 'success',
        cleanup: 'success'
      }
    });
    
  } catch (err: any) {
    console.error('❌ [Test Firebase] Test failed:', err);
    return NextResponse.json({ 
      error: 'Firebase permissions test failed',
      details: err.message,
      code: err.code
    }, { status: 500 });
  }
}

