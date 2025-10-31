import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { receiptProcessor } from '@/lib/ocr/receipt-processor';
import { createTransactionServer } from '@/lib/firebase/transactions-server';

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Receipt OCR] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const accountId = formData.get('accountId') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!accountId) {
      return NextResponse.json({ error: 'No account ID provided' }, { status: 400 });
    }

    console.log('🔄 [Receipt OCR] Processing receipt:', file.name);

    // Process the receipt with OCR
    const ocrResult = await receiptProcessor.processReceipt(file);

    if (!ocrResult.success || !ocrResult.data) {
      console.error('❌ [Receipt OCR] OCR failed:', ocrResult.error);
      return NextResponse.json({ 
        error: 'OCR processing failed', 
        details: ocrResult.error 
      }, { status: 500 });
    }

    const receiptData = ocrResult.data;

    // Create transaction from receipt data
    const transactionData = {
      trans_id: `receipt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      merchant_name: receiptData.merchant,
      amount: -Math.abs(receiptData.amount), // Negative for expense
      category: receiptData.category || 'other',
      date: receiptData.date,
      description: `Receipt: ${receiptData.merchant}`,
      notes: `OCR processed from receipt. Confidence: ${Math.round(receiptData.confidence * 100)}%`,
      analysis_status: 'pending',
      analyzed: false,
      receipt_url: null, // Will be set after file upload
      receipt_filename: file.name,
      ocr_data: {
        confidence: receiptData.confidence,
        raw_text: receiptData.rawText,
        items: receiptData.items || []
      }
    };

    // Save transaction to database
    const { data: savedTransaction, error: saveError } = await createTransactionServer(
      user.uid,
      accountId,
      transactionData
    );

    if (saveError || !savedTransaction) {
      console.error('❌ [Receipt OCR] Failed to save transaction:', saveError);
      return NextResponse.json({ 
        error: 'Failed to save transaction', 
        details: saveError 
      }, { status: 500 });
    }

    console.log('✅ [Receipt OCR] Successfully processed and saved receipt');

    return NextResponse.json({
      success: true,
      transaction: savedTransaction,
      ocrResult: {
        merchant: receiptData.merchant,
        amount: receiptData.amount,
        date: receiptData.date,
        category: receiptData.category,
        confidence: receiptData.confidence,
        processingTime: ocrResult.processingTime
      }
    });

  } catch (error) {
    console.error('❌ [Receipt OCR] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Receipt OCR] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { transactionId, updates } = await request.json();

    if (!transactionId || !updates) {
      return NextResponse.json({ error: 'Missing transaction ID or updates' }, { status: 400 });
    }

    // Update transaction with user corrections
    const { updateTransactionServerWithUserId } = await import('@/lib/firebase/transactions-server');
    const { data, error } = await updateTransactionServerWithUserId(user.uid, transactionId, updates);

    if (error) {
      console.error('❌ [Receipt OCR] Update failed:', error);
      return NextResponse.json({ 
        error: 'Update failed', 
        details: error.message 
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      transaction: data
    });

  } catch (error) {
    console.error('❌ [Receipt OCR] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error },
      { status: 500 }
    );
  }
}
