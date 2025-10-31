export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';
import { adminDb, FieldValue } from '@/lib/firebase/admin';
import { analyzeTransactionWithRetry, TransactionInput, UserContext, convertToEnhancedContext, findMissingUserFields } from '@/lib/ai/analyzeTransaction';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';

type JobDoc = {
  userId: string;
  accountId: string;
  status: 'running' | 'done' | 'failed' | 'canceled';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  batchSize: number;
  startedAt: any;
  completedAt: any;
  avgMs: number;
  lastUpdate: any;
};

// Atomic progress update with exponential moving average
async function updateProgress(jobRef: any, ok: boolean, ms: number) {
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    const data = snap.data()!;
    const processed = (data.processed ?? 0) + 1;
    const succeeded = (data.succeeded ?? 0) + (ok ? 1 : 0);
    const failed = (data.failed ?? 0) + (ok ? 0 : 1);
    const prevAvg = data.avgMs ?? 0;
    const alpha = 0.2; // smoothness factor
    const avgMs = prevAvg === 0 ? ms : Math.round(alpha * ms + (1 - alpha) * prevAvg);

    tx.update(jobRef, {
      processed,
      succeeded,
      failed,
      avgMs,
      lastUpdate: FieldValue.serverTimestamp(),
    });
  });
}

export async function POST(request: NextRequest) {
  try {
    const { uid } = await getUserFromReqOrThrow(request);
    const body = await request.json().catch(() => ({}));
    const { accountId } = body;
    
    const userId = uid;

    console.log('🔍 [Auto-Analyze] Request received:', { userId, accountId, body });

    if (!accountId) {
      console.error('❌ [Auto-Analyze] Missing accountId in request body:', body);
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
    }

    // Ensure the account belongs to the user
    const accRef = adminDb.doc(`user_profiles/${uid}/accounts/${accountId}`);
    const accSnap = await accRef.get();
    console.log('🔍 [Auto-Analyze] Account lookup:', { 
      accountPath: `user_profiles/${uid}/accounts/${accountId}`, 
      exists: accSnap.exists,
      accountData: accSnap.exists ? accSnap.data() : null 
    });
    
    if (!accSnap.exists) {
      console.error('❌ [Auto-Analyze] Account not found:', { userId: uid, accountId });
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Deterministic job ID: one job per (user, account)
    const jobId = `${userId}_${accountId}`;
    const jobRef = adminDb.collection('analysis_jobs').doc(jobId);

    // Check if job already exists and is running
    const existing = await jobRef.get();
    if (existing.exists) {
      const d = existing.data() as JobDoc;
      if (d.status === 'running') {
        // Already in progress – return quickly, do not start again
        console.log(`📊 [Auto-Analyze] Job ${jobId} already running, returning existing job`);
        return NextResponse.json({ jobId }, { status: 200 });
      }
    }

    console.log(`🚀 [Auto-Analyze] Starting analysis for user: ${userId}, account: ${accountId}`);

    // Get user profile for context
    const { data: userProfile, error: profileError } = await getUserProfileServer(uid);
    
    if (profileError || !userProfile) {
      console.error('❌ [Auto-Analyze] User profile not found:', profileError);
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Get pending transactions ONCE
    const txs = await getPendingTransactions(userId, accountId);
    const total = txs.length;

    console.log(`📊 [Auto-Analyze] Found ${total} pending transactions for analysis`);
    console.log('🔍 [Auto-Analyze] Transaction details:', { 
      total, 
      firstFew: txs.slice(0, 3).map(tx => ({ id: tx.id, merchant: tx.merchant_name, status: tx.analysis_status }))
    });

    // Check if there are any transactions to analyze
    if (total === 0) {
      console.warn(`⚠️ [Auto-Analyze] No pending transactions found for account ${accountId}`);
      
      // Check if ANY transactions exist for this account (not just pending)
      const allTxsRef = adminDb
        .collection(`user_profiles/${uid}/accounts/${accountId}/transactions`)
        .limit(10);
      const allTxsSnap = await allTxsRef.get();
      
      if (allTxsSnap.empty) {
        console.error(`❌ [Auto-Analyze] No transactions found at all for account ${accountId}`);
        console.error(`❌ [Auto-Analyze] Collection path: user_profiles/${uid}/accounts/${accountId}/transactions`);
        
        // Additional debugging: Check if the account document exists
        const accRef = adminDb.doc(`user_profiles/${uid}/accounts/${accountId}`);
        const accSnap = await accRef.get();
        console.error(`❌ [Auto-Analyze] Account document exists:`, accSnap.exists);
        
        return NextResponse.json({ 
          error: 'No transactions found for this account. Please reconnect your bank or try importing transactions again.',
          details: 'The account was connected but no transactions were imported.',
          debug: {
            accountPath: `user_profiles/${uid}/accounts/${accountId}`,
            accountExists: accSnap.exists,
            transactionPath: `user_profiles/${uid}/accounts/${accountId}/transactions`,
            transactionCount: 0
          }
        }, { status: 400 });
      } else {
        // Log details about existing transactions to help debug
        const sampleTxs = allTxsSnap.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            analysis_status: data.analysis_status,
            analysisStatus: data.analysisStatus,
            analyzed: data.analyzed,
            merchant_name: data.merchant_name
          };
        });
        
        console.log(`ℹ️ [Auto-Analyze] Found ${allTxsSnap.size} transactions but none are pending:`, sampleTxs);
        
        // All transactions are already analyzed, mark as done
        await jobRef.set({
          userId,
          accountId,
          status: 'done',
          total: allTxsSnap.size,
          processed: allTxsSnap.size,
          succeeded: allTxsSnap.size,
          failed: 0,
          startedAt: FieldValue.serverTimestamp(),
          completedAt: FieldValue.serverTimestamp(),
        });
        return NextResponse.json({ 
          jobId, 
          message: 'All transactions already analyzed',
          totalTransactions: allTxsSnap.size
        }, { status: 200 });
      }
    }

    // Initialize the job doc exactly once
    await jobRef.set({
      userId,
      accountId,
      status: 'running',
      total,
      processed: 0,
      succeeded: 0,
      failed: 0,
      batchSize: 10,
      avgMs: 0,
      startedAt: FieldValue.serverTimestamp(),
      completedAt: null,
      lastUpdate: FieldValue.serverTimestamp(),
    } as JobDoc, { merge: false });

    // If no transactions, mark as done immediately
    if (total === 0) {
      await jobRef.update({
        status: 'done',
        completedAt: FieldValue.serverTimestamp(),
        lastUpdate: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ jobId }, { status: 200 });
    }

    // Kick off the work WITHOUT holding the HTTP request
    void processTransactions(jobRef, txs, userId, accountId, userProfile);

    return NextResponse.json({ jobId }, { status: 200 });

  } catch (error) {
    console.error('❌ [Auto-Analyze] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Helper function to get pending transactions
async function getPendingTransactions(userId: string, accountId: string) {
  const collectionPath = `user_profiles/${userId}/accounts/${accountId}/transactions`;
  console.log('🔍 [Auto-Analyze] Querying transactions from:', collectionPath);
  
  // First, try to get all transactions to see what's actually in the database
  const allTxsSnap = await adminDb
    .collection(collectionPath)
    .limit(10)
    .get();

  console.log('🔍 [Auto-Analyze] All transactions sample:', { 
    totalDocs: allTxsSnap.docs.length,
    empty: allTxsSnap.empty,
    sampleDocs: allTxsSnap.docs.map(doc => ({ 
      id: doc.id, 
      analysis_status: doc.data().analysis_status,
      analysisStatus: doc.data().analysisStatus,
      analyzed: doc.data().analyzed,
      merchant_name: doc.data().merchant_name
    }))
  });

  // Try multiple queries to find pending transactions
  let pendingTransactions: any[] = [];

  // Query 1: Look for analysis_status = 'pending'
  try {
    const snap1 = await adminDb
      .collection(collectionPath)
      .where('analysis_status', '==', 'pending')
      .limit(500)
      .get();
    pendingTransactions = snap1.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log('🔍 [Auto-Analyze] Query 1 (analysis_status=pending):', pendingTransactions.length);
  } catch (e) {
    console.warn('⚠️ [Auto-Analyze] Query 1 failed:', e);
  }

  // Query 2: Look for analysisStatus = 'pending' (camelCase)
  if (pendingTransactions.length === 0) {
    try {
      const snap2 = await adminDb
        .collection(collectionPath)
        .where('analysisStatus', '==', 'pending')
        .limit(500)
        .get();
      pendingTransactions = snap2.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log('🔍 [Auto-Analyze] Query 2 (analysisStatus=pending):', pendingTransactions.length);
    } catch (e) {
      console.warn('⚠️ [Auto-Analyze] Query 2 failed:', e);
    }
  }

  // Query 3: Look for analyzed = false (fallback)
  if (pendingTransactions.length === 0) {
    try {
      const snap3 = await adminDb
        .collection(collectionPath)
        .where('analyzed', '==', false)
        .limit(500)
        .get();
      pendingTransactions = snap3.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log('🔍 [Auto-Analyze] Query 3 (analyzed=false):', pendingTransactions.length);
    } catch (e) {
      console.warn('⚠️ [Auto-Analyze] Query 3 failed:', e);
    }
  }

  // Query 4: Get all transactions and filter manually (last resort)
  if (pendingTransactions.length === 0) {
    try {
      const snap4 = await adminDb
        .collection(collectionPath)
        .limit(500)
        .get();
      
      pendingTransactions = snap4.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(tx => {
          const analysisStatus = tx.analysis_status || tx.analysisStatus;
          const analyzed = tx.analyzed;
          return analysisStatus === 'pending' || analyzed === false;
        });
      console.log('🔍 [Auto-Analyze] Query 4 (manual filter):', pendingTransactions.length);
    } catch (e) {
      console.warn('⚠️ [Auto-Analyze] Query 4 failed:', e);
    }
  }

  console.log('🔍 [Auto-Analyze] Final pending transactions:', { 
    count: pendingTransactions.length,
    firstFew: pendingTransactions.slice(0, 3).map(tx => ({
      id: tx.id,
      merchant_name: tx.merchant_name,
      analysis_status: tx.analysis_status,
      analysisStatus: tx.analysisStatus,
      analyzed: tx.analyzed
    }))
  });

  return pendingTransactions;
}

// Background processor with batch processing and atomic updates
async function processTransactions(
  jobRef: any,
  txs: Array<{ id: string; [key: string]: any }>,
  userId: string,
  accountId: string,
  userProfile: any
) {
  if (!txs.length) return;

  console.log(`🔄 [Auto-Analyze] Processing ${txs.length} transactions in background`);

  const BATCH_SIZE = 10;
  
  // Process in batches of 10
  for (let i = 0; i < txs.length; i += BATCH_SIZE) {
    const batch = txs.slice(i, i + BATCH_SIZE);
    
    // Process batch in parallel
    await Promise.all(batch.map(async (tx) => {
      const start = Date.now();
      try {
        await analyzeOneTransaction(tx, userId, accountId, userProfile);
        await updateProgress(jobRef, true, Date.now() - start);
        console.log(`✅ [Auto-Analyze] Successfully analyzed: ${tx.merchant_name}`);
      } catch (err: any) {
        await updateProgress(jobRef, false, Date.now() - start);
        console.error(`❌ [Auto-Analyze] Failed to analyze ${tx.merchant_name}:`, err);
      }
    }));
  }

  // Mark job as completed
  await jobRef.update({
    status: 'done',
    completedAt: FieldValue.serverTimestamp(),
    lastUpdate: FieldValue.serverTimestamp(),
  });

  console.log(`🎉 [Auto-Analyze] Analysis complete for job ${jobRef.id}`);
}

// Analyze a single transaction
async function analyzeOneTransaction(
  tx: { id: string; [key: string]: any },
  userId: string,
  accountId: string,
  userProfile: any
) {
  const txRef = adminDb.doc(`user_profiles/${userId}/accounts/${accountId}/transactions/${tx.id}`);
  
  // Mark as running
  await txRef.update({
    analysis_status: 'running',
    analysisStatus: 'running',
    analysisStartedAt: new Date()
  });

  // Convert user profile to enhanced context
  const userContext = convertToEnhancedContext(userProfile, tx.date);

  // Check for required user profile fields before calling the model
  const missingFields = findMissingUserFields(userContext);
  if (missingFields.length > 0) {
    console.warn(`⚠️ [Auto-Analyze] Missing required user fields for transaction ${tx.id}:`, missingFields);
    // Continue with analysis but log the missing fields
  }

  // Prepare transaction input with enhanced format
  const transactionInput: TransactionInput = {
    tx_id: tx.id,
    merchant: tx.merchant_name,
    amount_usd: tx.amount,
    date_iso: tx.date,
    datetime_iso: tx.datetime, // Include datetime from Plaid
    note: tx.description,
    // Legacy fields for backward compatibility
    merchant_name: tx.merchant_name,
    amount: tx.amount,
    category: tx.category,
    date: tx.date,
    datetime: tx.datetime, // Legacy datetime field
    account_id: tx.account_id,
    description: tx.description,
  };

  // Analyze with the new improved system
  const analysisResult = await analyzeTransactionWithRetry(transactionInput, userContext);
  
  if (!analysisResult.success) {
    console.error(`❌ [Auto-Analyze] Analysis failed for transaction ${tx.id}:`, analysisResult.error);
    throw new Error(`Analysis failed: ${analysisResult.error}`);
  }
  
  const result = analysisResult.result;

  // Update transaction with analysis results using new schema
  await txRef.set({
    // Legacy fields for backward compatibility
    deduction_score: result.confidence || 0,
    deductible_reason: result.customized_reason || result.reasoning_summary || 'Analysis pending',
    is_deductible: result.is_deductible || false,
    
    // New enhanced analysis fields
    ai: {
      status_label: result.is_deductible ? 'Likely Deductible' : 'Unlikely Deductible',
      score_pct: typeof result.confidence === 'number' ? Math.round(result.confidence * 100) : 0,
      reasoning: result.customized_reason || result.reasoning_summary || 'Analysis pending',
      irs: { 
        publication: result.irs_refs?.[0] || 'IRS Pub 535 (Business Expenses)', 
        section: null 
      },
      required_docs: [], // Removed as per user request
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      last_analyzed_at: Date.now(),
      key_analysis_factors: {
        business_purpose: result.key_analysis_factor || 'Analysis pending',
        ordinary_necessary: result.customized_reason || result.reasoning_summary || 'Analysis pending',
        documentation_required: [],
        audit_risk: result.audit_risk || 'medium',
        specific_rules: result.irs_refs || ['IRS Pub 535 (Business Expenses)'],
        limitations: [],
        deduction_status: result.is_deductible ? 'Likely Deductible' : 'Unlikely Deductible',
        deduction_percentage: typeof result.confidence === 'number' ? Math.round(result.confidence * 100) : 0,
        reasoning_summary: result.reasoning_summary || result.key_analysis_factor,
        irs_reference: result.irs_refs?.[0] || '',
      },
    },
    analyzed: true,
    analysis_status: 'completed',
    analysisStatus: 'completed',
    updatedAt: Date.now(),
  }, { merge: true });
}