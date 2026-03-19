import { NextRequest, NextResponse } from 'next/server';
import { analyzeTransactionWithRetry, TransactionInput, UserContext, convertToEnhancedContext } from '@/lib/ai/analyzeTransaction';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { transactionId, transaction } = await request.json();
    
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction data is required' }, { status: 400 });
    }

    // Get user profile for context
    const { data: userProfile, error: profileError } = await getUserProfileServer(user.uid);
    
    if (profileError || !userProfile) {
      console.error('❌ [Single Transaction Analysis] User profile not found:', profileError);
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Convert user profile to enhanced context
    const userContext = convertToEnhancedContext(userProfile, transaction.date);

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

    // Analyze with the new improved system
    const analysisResult = await analyzeTransactionWithRetry(transactionInput, userContext);
    
    if (!analysisResult.success) {
      console.error(`❌ [Single Transaction Analysis] Analysis failed:`, analysisResult.error);
      return NextResponse.json({ 
        error: 'Analysis failed', 
        details: analysisResult.error 
      }, { status: 500 });
    }
    
    const result = analysisResult.result;

    return NextResponse.json({
      success: true,
      analysis: {
        // Suggestion only: do not finalize categorization.
        is_deductible: null,
        deduction_reason: result.customized_reason,
        deduction_score: result.confidence,
        status_label: result.is_deductible ? 'Likely Deductible' : 'Unlikely Deductible',
        reasoning: result.key_analysis_factor,
        irs_publication: result.irs_refs?.[0] || null,
        irs_section: null,
        required_docs: [], // Removed as per user request
        category_hint: null, // Removed as per user request
        risk_flags: [], // Removed as per user request
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
      }
    });
  } catch (error) {
    console.error('Error in analyze-single-transaction:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}