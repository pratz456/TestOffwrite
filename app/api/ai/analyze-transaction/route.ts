export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { analyzeTransactionWithRetry, TransactionInput, findMissingUserFields, convertToEnhancedContext } from '@/lib/ai/analyzeTransaction';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { getTransactionServer } from '@/lib/firebase/transactions-server';
import { adminDb } from '@/lib/firebase/admin';

// ── Per-user rate limit: max 60 AI analysis calls per hour ──────────────────
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(uid);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(uid, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

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

    // User-added transaction context fields
    business_purpose: z.string().optional(),
    attendees: z.array(z.string()).optional(),
    travel_destination: z.string().optional(),
    equipment_details: z.object({
      make: z.string().optional(),
      model: z.string().optional(),
      year: z.number().optional(),
      business_use_percentage: z.number().optional(),
      depreciation_method: z.enum(['straight_line', 'declining_balance', 'section_179']).optional()
    }).optional(),
    client_project: z.string().optional(),
    documentation_status: z.enum(['complete', 'partial', 'missing']).optional(),
    meeting_notes: z.string().optional(),
    mileage_details: z.object({
      start_location: z.string().optional(),
      end_location: z.string().optional(),
      miles: z.number().optional(),
      business_purpose: z.string().optional()
    }).optional(),

    city: z.string().optional(),
    state: z.string().optional(),
  }),
});

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit: 60 AI calls per user per hour
    if (!checkRateLimit(user.uid)) {
      return NextResponse.json({ error: 'Rate limit exceeded. Max 60 AI analyses per hour.' }, { status: 429 });
    }

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

    // Preserve tax treatment only when the user explicitly recorded a classification reason (detail save, swipe, etc.).
    // Old AI-only `is_deductible` values must not block re-analysis from updating suggestions.
    const { data: existingTransaction } = await getTransactionServer(user.uid, transactionId);
    const userReason =
      existingTransaction?.user_classification_reason != null
        ? String(existingTransaction.user_classification_reason).trim()
        : '';
    const shouldPreserveClassification = userReason.length > 0;

    // Prepare transaction input with enhanced format
    const transactionInput: TransactionInput = {
      tx_id: transactionId,
      merchant: transaction.merchant_name,
      amount_usd: transaction.amount,
      date_iso: transaction.date,
      datetime_iso: transaction.datetime, // Include datetime from Plaid
      // Prefer user-added context (`notes`) over original transaction description.
      note: transaction.notes || transaction.description,
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

    // Save analysis results to Firestore with flat, queryable fields
    // IMPORTANT: AI suggests only — is_deductible stays null until the user confirms.
    const analysisData = {
      is_deductible: shouldPreserveClassification ? undefined : null,
      expense_type: shouldPreserveClassification ? undefined : null,
      deductible_reason: result.customized_reason,
      deduction_score: result.confidence,
      analyzed: true,
      analysisStatus: 'completed' as const,
      analysisCompletedAt: new Date(),
      analysisUpdatedAt: new Date().toISOString(),

      // Flat AI fields — all queryable in Firestore, no JSON blob
      ai_status: result.status,
      ai_category: result.category,
      ai_deductible_percent: result.deductible_percent ?? null,
      ai_key_analysis_factor: result.key_analysis_factor ?? null,
      ai_customized_reason: result.customized_reason ?? null,
      ai_reasoning_summary: result.reasoning_summary ?? null,
      ai_irs_refs: result.irs_refs ?? [],
      ai_audit_risk: result.audit_risk ?? null,
      ai_audit_risk_rationale: result.audit_risk_rationale ?? null,
      ai_confidence: result.confidence ?? null,
      ai_missing_fields: result.missing_fields ?? [],
      ai_questions: result.questions ?? [],
      ai_documentation_required: result.documentation_required ?? [],
      ai_reason_hash: result.reason_hash ?? null,
      ai_model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      ai_last_analyzed_at: Date.now(),

      // Legacy shape kept for backward-compatible UI reads
      deductionStatus: result.is_deductible ? 'Likely Deductible' as const : 'Non-Deductible' as const,
      confidence: result.confidence,
      reasoning: result.reasoning_summary || result.key_analysis_factor,
      irsPublication: result.irs_refs?.[0] || undefined,
    };

    // Direct Firestore lookup — queries both field name variants to cover
    // legacy transactions written with user_id (snake_case) and new ones with userId (camelCase)
    let updateError: any = null;
    try {
      let snap = await adminDb
        .collectionGroup('transactions')
        .where('userId', '==', user.uid)
        .where('trans_id', '==', transactionId)
        .limit(1)
        .get();

      // Fallback: try snake_case user_id for older transactions
      if (snap.empty) {
        snap = await adminDb
          .collectionGroup('transactions')
          .where('user_id', '==', user.uid)
          .where('trans_id', '==', transactionId)
          .limit(1)
          .get();
      }

      if (!snap.empty) {
        const updateData = Object.fromEntries(
          Object.entries({ ...analysisData, updated_at: new Date() }).filter(([, v]) => v !== undefined)
        );
        await snap.docs[0].ref.update(updateData);
      } else {
        updateError = new Error(`Transaction ${transactionId} not found for user ${user.uid}`);
      }
    } catch (err) {
      updateError = err;
    }

    if (updateError) {
      console.error(`❌ [AI Analysis API] Failed to save analysis:`, updateError?.message);
      return NextResponse.json({
        error: 'Analysis completed but failed to save results',
        details: updateError?.message || 'Unknown database error',
      }, { status: 500 });
    }

    console.log(`💾 [AI Analysis API] Saved analysis: ${transaction.merchant_name} (${transactionId})`);

    return NextResponse.json({
      success: true,
      analysis: {
        deductionStatus: analysisData.deductionStatus,
        confidence: result.confidence,
        reasoning: result.reasoning_summary || result.key_analysis_factor,
        irsReference: {
          publication: result.irs_refs?.[0] || null,
          section: null,
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