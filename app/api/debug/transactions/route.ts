export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb } from '@/lib/firebase/admin';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');
    const userId = searchParams.get('userId');
    
    // Allow passing userId directly for debugging (unsafe for production)
    let uid = userId;
    
    if (!uid) {
      try {
        const authResult = await getUserFromReqOrThrow(request);
        uid = authResult.uid;
      } catch (authError) {
        return NextResponse.json({ 
          error: 'Authentication required. Provide userId parameter for debugging.',
          hint: 'Add ?userId=YOUR_UID to the URL'
        }, { status: 401 });
      }
    }
    
    console.log(`🔍 [DEBUG] Checking transactions for user: ${uid}`);
    
    // Check accounts
    const accountsSnap = await adminDb
      .collection(`user_profiles/${uid}/accounts`)
      .get();
      
    console.log(`📊 [DEBUG] Found ${accountsSnap.size} accounts`);
    
    // Check transactions for each account
    const results: any = {};
    for (const accDoc of accountsSnap.docs) {
      const txSnap = await adminDb
        .collection(`user_profiles/${uid}/accounts/${accDoc.id}/transactions`)
        .get();
      
      console.log(`📊 [DEBUG] Account ${accDoc.id}: ${txSnap.size} transactions`);
      
      results[accDoc.id] = {
        accountName: accDoc.data().name,
        accountId: accDoc.id,
        transactionCount: txSnap.size,
        sampleTransaction: txSnap.docs[0]?.data() || null,
        firstFewTransactions: txSnap.docs.slice(0, 3).map(doc => ({
          id: doc.id,
          data: doc.data()
        }))
      };
    }
    
    // If specific account requested, also check collectionGroup query
    if (accountId) {
      console.log(`🔍 [DEBUG] Checking collectionGroup query for account: ${accountId}`);
      
      try {
        const cgSnap = await adminDb
          .collectionGroup('transactions')
          .where('user_id', '==', uid)
          .where('account_id', '==', accountId)
          .limit(10)
          .get();
        
        console.log(`📊 [DEBUG] CollectionGroup query found ${cgSnap.size} transactions`);
        
        results.collectionGroupQuery = {
          found: cgSnap.size,
          sample: cgSnap.docs[0]?.data() || null
        };
      } catch (cgError: any) {
        console.error('❌ [DEBUG] CollectionGroup query failed:', cgError);
        results.collectionGroupQuery = {
          error: cgError.message,
          code: cgError.code
        };
      }
    }
    
    return NextResponse.json({ 
      success: true,
      userId: uid,
      totalAccounts: accountsSnap.size,
      details: results 
    });
    
  } catch (error: any) {
    console.error('❌ [DEBUG] Error checking transactions:', error);
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
}

