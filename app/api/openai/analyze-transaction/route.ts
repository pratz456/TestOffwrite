export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server'
import { analyzeTransactionWithRetry, TransactionInput, UserContext, convertToEnhancedContext } from '@/lib/ai/analyzeTransaction'
import { getAuthenticatedUser } from '@/lib/firebase/api-auth'
import { getUserProfileServer } from '@/lib/firebase/profiles-server'

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { transaction } = await request.json()
    
    if (!transaction) {
      return NextResponse.json({ error: 'Transaction data is required' }, { status: 400 })
    }

    // Validate required fields
    if (!transaction.merchant_name || !transaction.amount) {
      return NextResponse.json({ 
        error: 'Transaction must include merchant_name and amount' 
      }, { status: 400 })
    }

    // Get user profile for context
    const { data: userProfile, error: profileError } = await getUserProfileServer(user.uid);
    
    if (profileError || !userProfile) {
      console.error('❌ [OpenAI Analysis] User profile not found:', profileError);
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    console.log('🤖 Analyzing transaction with OpenAI:', {
      merchant: transaction.merchant_name,
      amount: transaction.amount,
      category: transaction.category,
      date: transaction.date,
      userProfile: {
        profession: userProfile.profession,
        income: userProfile.income,
        state: userProfile.state,
        filing_status: userProfile.filing_status
      }
    })

    // Convert user profile to enhanced context
    const userContext = convertToEnhancedContext(userProfile, transaction.date);

    // Prepare transaction input with enhanced format
    const transactionInput: TransactionInput = {
      tx_id: transaction.id || '',
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

    // Analyze with the new improved system
    const analysisResult = await analyzeTransactionWithRetry(transactionInput, userContext);
    
    if (!analysisResult.success) {
      console.error(`❌ [OpenAI Analysis] Analysis failed:`, analysisResult.error);
      throw new Error(`Analysis failed: ${analysisResult.error}`);
    }
    
    const result = analysisResult.result;
    
    console.log('✅ Analysis complete:', {
      deductible: result.is_deductible,
      reason: result.customized_reason,
      confidence: `${Math.round((result.confidence || 0) * 100)}%`,
      status: result.status
    })

    return NextResponse.json({
      success: true,
      analysis: {
        is_deductible: result.is_deductible,
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
    })
  } catch (error) {
    console.error('Error in OpenAI analysis API:', error)
    return NextResponse.json(
      { error: 'Internal server error during analysis' },
      { status: 500 }
    )
  }
}
