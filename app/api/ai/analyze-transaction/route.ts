export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { analyzeTransactionWithRetry, TransactionInput, UserContext, findMissingUserFields, convertToEnhancedContext } from '@/lib/ai/analyzeTransaction';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { updateTransactionServerWithUserId } from '@/lib/firebase/transactions-server';

// Zod schema for request validation
const AnalyzeTransactionRequestSchema = z.object({
  transactionId: z.string().min(1, 'Transaction ID is required'),
  transaction: z.object({
    merchant_name: z.string().min(1, 'Merchant name is required'),
    amount: z.number(),
    category: z.string(),
    date: z.string(),
    datetime: z.string().optional(), // Full datetime from Plaid
    account_id: z.string().optional(),
    description: z.string().optional(),
    notes: z.string().optional(),
  }),
});

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`👤 [AI Analysis API] Analyzing transaction for user: ${user.uid}`);

    // Parse and validate request body
    const body = await request.json();
    const validationResult = AnalyzeTransactionRequestSchema.safeParse(body);
    
    if (!validationResult.success) {
      console.error('❌ [AI Analysis API] Validation error:', validationResult.error);
      return NextResponse.json({ 
        error: 'Invalid request data', 
        details: validationResult.error.errors 
      }, { status: 400 });
    }

    const { transactionId, transaction: validatedTransaction } = validationResult.data;
    const transaction = validatedTransaction as Record<string, any>;

    console.log(`🔍 [AI Analysis API] Received transaction ID: "${transactionId}" (type: ${typeof transactionId})`);
    console.log(`🔍 [AI Analysis API] Transaction data:`, {
      merchant_name: transaction.merchant_name,
      amount: transaction.amount,
      date: transaction.date,
      datetime: transaction.datetime,
      account_id: transaction.account_id
    });

    // Get user profile for context
    const { data: userProfile, error: profileError } = await getUserProfileServer(user.uid);

    if (profileError || !userProfile) {
      console.error('❌ [AI Analysis API] User profile not found:', profileError);
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    console.log(`👤 [AI Analysis API] Found user profile for ${user.uid}:`, {
      profession: userProfile.profession,
      income: userProfile.income,
      state: userProfile.state,
      filing_status: userProfile.filing_status,
      business_entity_type: userProfile.business_entity_type,
      primary_work_location: userProfile.primary_work_location,
      work_related_travel_pattern: userProfile.work_related_travel_pattern
    });

    // Convert user profile to enhanced context
    const userContext = convertToEnhancedContext(userProfile, transaction.date);

    console.log(`🔍 [AI Analysis API] User context for analysis:`, userContext);

    // Check for required user profile fields before calling the model
    const missingFields = findMissingUserFields(userContext);
    if (missingFields.length > 0) {
      console.warn(`⚠️ [AI Analysis API] Missing user profile fields: ${missingFields.join(', ')}`);
      return NextResponse.json({
        success: false,
        error: 'Missing required user profile fields for AI analysis',
        missing_user_fields: missingFields
      }, { status: 422 });
    }

    // Prepare transaction input with enhanced format
    const transactionInput: TransactionInput = {
      tx_id: transactionId,
      merchant: transaction.merchant_name,
      amount_usd: transaction.amount,
      date_iso: transaction.date,
      datetime_iso: transaction.datetime, // Include datetime from Plaid
      note: transaction.description || transaction.notes,
      // Additional Plaid fields
      mcc: transaction.merchant_category_code || transaction.mcc,
      location: transaction.location,
      payment_channel: transaction.payment_channel,
      authorized_date: transaction.authorized_date,
      iso_currency_code: transaction.iso_currency_code,
      unofficial_currency_code: transaction.unofficial_currency_code,
      personal_finance_category: transaction.personal_finance_category,
      pending: transaction.pending,
      pending_transaction_id: transaction.pending_transaction_id,
      account_owner: transaction.account_owner,
      transaction_code: transaction.transaction_code,
      merchant_category_code: transaction.merchant_category_code,
      // User-added context fields
      business_purpose: transaction.business_purpose,
      attendees: transaction.attendees,
      travel_destination: transaction.travel_destination,
      equipment_details: transaction.equipment_details,
      client_project: transaction.client_project,
      documentation_status: transaction.documentation_status,
      meeting_notes: transaction.meeting_notes,
      mileage_details: transaction.mileage_details,
      city: transaction.location?.city || transaction.city,
      state: transaction.location?.state || transaction.state,
      // Legacy fields for backward compatibility
      merchant_name: transaction.merchant_name,
      amount: transaction.amount,
      category: transaction.category,
      date: transaction.date,
      datetime: transaction.datetime, // Legacy datetime field
      account_id: transaction.account_id,
      description: transaction.description,
      notes: transaction.notes,
    };

    console.log(`🤖 [AI Analysis API] Starting analysis for transaction: ${transaction.merchant_name} - $${transaction.amount}`);

    // Analyze transaction with retry logic
    const analysisResult = await analyzeTransactionWithRetry(transactionInput, userContext);

    if (!analysisResult.success) {
      console.error('❌ [AI Analysis API] Analysis failed:', analysisResult.error);
      return NextResponse.json({ 
        error: 'Analysis failed', 
        details: analysisResult.error 
      }, { status: 500 });
    }

    const { result } = analysisResult;

    console.log(`✅ [AI Analysis API] Analysis complete for ${transaction.merchant_name}:`, {
      status: result.status,
      is_deductible: result.is_deductible,
      category: result.category,
      confidence: result.confidence,
      audit_risk: result.audit_risk,
    });

    // Determine expense_type from AI result or infer from is_deductible
    const expenseType = result.expense_type || (result.is_deductible ? 'business' : 'personal');

    // Save analysis results to Firestore with compatible schema
    const analysisData = {
      // Legacy fields for backward compatibility
      is_deductible: result.is_deductible ?? (expenseType === 'business'),
      expense_type: expenseType, // Explicit classification: business or personal
      deductible_reason: result.customized_reason,
      deduction_score: result.confidence,
      analyzed: true,
      analysisStatus: 'completed' as const,
      analysisCompletedAt: new Date(),
      
      // New AI Analysis Fields (matching the function's type definition)
      deductionStatus: result.is_deductible ? 'Likely Deductible' as const : 'Non-Deductible' as const,
      confidence: result.confidence,
      reasoning: result.reasoning_summary || result.key_analysis_factor, // Use reasoning_summary if available, fallback to key_analysis_factor
      irsPublication: result.irs_refs?.[0] || undefined,
      irsSection: undefined,
      analysisUpdatedAt: new Date().toISOString(),
      
      // Store additional data in ai_analysis field as JSON
      ai_analysis: JSON.stringify({
        status: result.status,
        category: result.category,
        deductible_percent: result.deductible_percent,
        key_analysis_factor: result.key_analysis_factor,
        customized_reason: result.customized_reason,
        irs_refs: result.irs_refs,
        audit_risk: result.audit_risk,
        audit_risk_rationale: result.audit_risk_rationale,
        missing_fields: result.missing_fields,
        questions: result.questions,
        reason: result.reason,
        reason_hash: result.reason_hash,
      }),
    };

    console.log(`💾 [AI Analysis API] Attempting to save analysis data:`, {
      transactionId,
      userId: user.uid,
      analysisDataKeys: Object.keys(analysisData),
      analysisDataTypes: Object.entries(analysisData).map(([key, value]) => ({
        key,
        type: typeof value,
        value: typeof value === 'object' ? JSON.stringify(value).substring(0, 100) : value
      }))
    });

    console.log(`🔄 [AI Analysis API] Calling updateTransactionServerWithUserId with:`, {
      userId: user.uid,
      transactionId,
      analysisDataKeys: Object.keys(analysisData)
    });

    // First, let's check if the transaction exists
    try {
      const { adminDb } = await import('@/lib/firebase/admin');
      
      // Try multiple approaches to find the transaction
      console.log(`🔍 [AI Analysis API] Searching for transaction with ID: "${transactionId}"`);
      
      // Approach 1: Collection group with user_id and trans_id
      const transactionsQuery1 = adminDb
        .collectionGroup('transactions')
        .where('user_id', '==', user.uid)
        .where('trans_id', '==', transactionId)
        .limit(1);
      
      const querySnapshot1 = await transactionsQuery1.get();
      console.log(`🔍 [AI Analysis API] Query 1 (user_id + trans_id) result:`, {
        found: !querySnapshot1.empty,
        size: querySnapshot1.size
      });
      
      if (!querySnapshot1.empty) {
        const doc = querySnapshot1.docs[0];
        const data = doc.data();
        console.log(`📄 [AI Analysis API] Found transaction data:`, {
          trans_id: data.trans_id,
          user_id: data.user_id,
          merchant_name: data.merchant_name,
          amount: data.amount,
          path: doc.ref.path
        });
      } else {
        // Approach 2: Try with just trans_id (in case user_id is missing)
        const transactionsQuery2 = adminDb
          .collectionGroup('transactions')
          .where('trans_id', '==', transactionId)
          .limit(5);
        
        const querySnapshot2 = await transactionsQuery2.get();
        console.log(`🔍 [AI Analysis API] Query 2 (trans_id only) result:`, {
          found: !querySnapshot2.empty,
          size: querySnapshot2.size
        });
        
        if (!querySnapshot2.empty) {
          querySnapshot2.docs.forEach((doc, index) => {
            const data = doc.data();
            console.log(`📄 [AI Analysis API] Transaction ${index + 1}:`, {
              trans_id: data.trans_id,
              user_id: data.user_id,
              merchant_name: data.merchant_name,
              amount: data.amount,
              path: doc.ref.path
            });
          });
        }
      }
    } catch (lookupError) {
      console.error(`❌ [AI Analysis API] Transaction lookup failed:`, lookupError);
    }

    // Try direct update approach first
    let updateError = null;
    try {
      const { adminDb } = await import('@/lib/firebase/admin');
      
      // Find the transaction document directly
      console.log(`🔍 [AI Analysis API] Direct update - Searching for:`, {
        userId: user.uid,
        transactionId,
        transactionIdType: typeof transactionId,
        transactionIdLength: transactionId?.length
      });
      
      const transactionsQuery = adminDb
        .collectionGroup('transactions')
        .where('user_id', '==', user.uid)
        .where('trans_id', '==', transactionId)
        .limit(1);
      
      const querySnapshot = await transactionsQuery.get();
      
      if (!querySnapshot.empty) {
        const docRef = querySnapshot.docs[0].ref;
        console.log(`📝 [AI Analysis API] Direct update - Found document at: ${docRef.path}`);
        
        // Filter out undefined values to prevent Firestore errors
        const updateData = Object.fromEntries(
          Object.entries({
            ...analysisData,
            updated_at: new Date(),
          }).filter(([_, value]) => value !== undefined)
        );
        
        await docRef.update(updateData);
        console.log(`✅ [AI Analysis API] Direct update successful`);
      } else {
        console.error(`❌ [AI Analysis API] Direct update - Transaction not found`);
        updateError = new Error('Transaction not found for direct update');
      }
    } catch (directUpdateError) {
      console.error(`❌ [AI Analysis API] Direct update failed:`, directUpdateError);
      updateError = directUpdateError;
    }

    // If direct update failed, try the original method as fallback
    if (updateError) {
      console.log(`🔄 [AI Analysis API] Direct update failed, trying original method...`);
      const { error: fallbackError } = await updateTransactionServerWithUserId(user.uid, transactionId, analysisData);
      updateError = fallbackError;
    }

    if (updateError) {
      console.error(`❌ [AI Analysis API] Failed to save analysis for transaction ${transactionId}:`, updateError);
      console.error(`❌ [AI Analysis API] Error details:`, {
        errorType: typeof updateError,
        errorCode: updateError?.code,
        errorMessage: updateError?.message,
        errorDetails: updateError?.details,
        transactionId,
        userId: user.uid,
        analysisDataKeys: Object.keys(analysisData)
      });
      return NextResponse.json({ 
        error: 'Analysis completed but failed to save results',
        details: updateError?.message || 'Unknown database error',
        transactionId,
        userId: user.uid,
        fullError: updateError
      }, { status: 500 });
    }

    console.log(`💾 [AI Analysis API] Successfully saved analysis for transaction: ${transaction.merchant_name} (${transactionId})`);

    // Return the full analyzer output to client
    return NextResponse.json({
      success: true,
      analysis: {
        deductionStatus: analysisData.deductionStatus,
        confidence: result.confidence,
        reasoning: result.key_analysis_factor,
        irsReference: {
          publication: result.irs_refs?.[0] || null,
          section: null
        },
        updatedAt: analysisData.analysisUpdatedAt,
      },
      updatedAt: analysisData.analysisUpdatedAt,
    });

  } catch (error) {
    console.error('❌ [AI Analysis API] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error during analysis' },
      { status: 500 }
    );
  }
}