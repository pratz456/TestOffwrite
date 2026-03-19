import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { receiptProcessor } from '@/lib/ocr/receipt-processor';
import {
  createTransactionServer,
  getTransactionServer,
  getTransactionsServer,
  updateTransactionServerWithUserId,
  type Transaction
} from '@/lib/firebase/transactions-server';
import { adminDb } from '@/lib/firebase/admin';
import { v4 as uuidv4 } from 'uuid';

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
    const mode = String(formData.get('mode') ?? 'commit'); // 'ocr' | 'commit'
    const receiptType = String(formData.get('receiptType') ?? 'expense'); // 'expense' | 'income'
    const attachTransactionId = (formData.get('attachTransactionId') as string | null) ?? null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    console.log(`🔄 [Receipt OCR] (${mode}) Processing receipt:`, file.name);

    const ocrResult = await receiptProcessor.processReceipt(file);

    if (!ocrResult.success || !ocrResult.data) {
      console.error('❌ [Receipt OCR] OCR failed:', ocrResult.error);
      return NextResponse.json(
        {
          error: 'OCR processing failed',
          details: ocrResult.error
        },
        { status: 500 }
      );
    }

    const receiptData = ocrResult.data;

    const receiptDirectionSuggestion = receiptProcessor.inferReceiptDirectionFromText(receiptData.rawText);

    // OCR-only: return extracted data + match candidates, but do not write anything.
    if (mode === 'ocr') {
      const { data: existingTransactions, error: txErr } = await getTransactionsServer(user.uid);
      const matchCandidates = txErr
        ? []
        : await receiptProcessor.findMatchingTransactions(receiptData, existingTransactions, 3);

      return NextResponse.json({
        success: true,
        mode: 'ocr',
        suggestedReceiptType: receiptDirectionSuggestion.direction,
        suggestedReceiptConfidence: receiptDirectionSuggestion.confidence,
        ocrResult: {
          merchant: receiptData.merchant,
          amount: receiptData.amount, // positive only; sign decided at commit time
          date: receiptData.date,
          category: receiptData.category || 'other',
          confidence: receiptData.confidence,
          items: receiptData.items || [],
          processingTime: ocrResult.processingTime
        },
        matchCandidates
      });
    }

    // Commit: create new transaction OR attach receipt to an existing one.
    if (mode !== 'commit') {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
    }

    if (receiptType !== 'expense' && receiptType !== 'income') {
      return NextResponse.json({ error: 'Invalid receiptType' }, { status: 400 });
    }

    const receiptAmountAbs = Math.abs(Number(receiptData.amount || 0));
    const signedAmount = receiptType === 'income' ? -receiptAmountAbs : receiptAmountAbs; // app expects expenses positive

    const ocr_data = {
      confidence: receiptData.confidence,
      raw_text: receiptData.rawText,
      items: receiptData.items || []
    };

    const storeReceiptInReceiptsCollection = async (transactionId: string) => {
      const fileExtension = (file.name || '').split('.').pop() || 'jpg';
      const uniqueFilename = `${user.uid}/${transactionId}/${uuidv4()}.${fileExtension}`;

      // Convert file to base64 data URL (legacy Firestore storage approach)
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const base64Data = buffer.toString('base64');
      const dataUrl = `data:${file.type};base64,${base64Data}`;

      await adminDb.collection('receipts').doc(uniqueFilename).set({
        transactionId,
        userId: user.uid,
        filename: file.name,
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        dataUrl,
        uploadedAt: new Date(),
      });

      return {
        receiptUrl: `/api/receipts/${uniqueFilename}`,
        receiptFilename: file.name
      };
    };

    const appendReceiptToNotes = (existingNotes: string | undefined | null, previousReceiptLabel: string | null) => {
      const ocrConfidencePct = Math.round(receiptData.confidence * 100);
      const newChunk =
        previousReceiptLabel
          ? `\nReceipt OCR updated (prev: ${previousReceiptLabel}). Merchant: ${receiptData.merchant}. OCR confidence: ${ocrConfidencePct}%.`
          : `\nReceipt OCR saved. Merchant: ${receiptData.merchant}. OCR confidence: ${ocrConfidencePct}%.`;

      return `${existingNotes || ''}${newChunk}`.trim();
    };

    if (attachTransactionId) {
      const { data: existingTransaction, error: txErr } = await getTransactionServer(user.uid, attachTransactionId);

      if (txErr || !existingTransaction) {
        return NextResponse.json(
          {
            error: 'Transaction not found for attachment',
            details: txErr?.message || txErr
          },
          { status: 404 }
        );
      }

      const { receiptUrl } = await storeReceiptInReceiptsCollection(attachTransactionId);

      const previousReceiptLabel =
        existingTransaction.receipt_filename || existingTransaction.receipt_url || null;

      const updatedNotes = appendReceiptToNotes(existingTransaction.notes, previousReceiptLabel);

      await updateTransactionServerWithUserId(
        user.uid,
        attachTransactionId,
        {
          receipt_url: receiptUrl,
          receipt_filename: file.name,
          ocr_data,
          notes: updatedNotes
        } as any
      );

      const { data: refreshedTx } = await getTransactionServer(user.uid, attachTransactionId);

      return NextResponse.json({
        success: true,
        mode: 'commit',
        transaction: refreshedTx,
        receiptUrl
      });
    }

    // Create new transaction
    const accountsSnap = await adminDb
      .collection('user_profiles')
      .doc(user.uid)
      .collection('accounts')
      .limit(1)
      .get();

    if (accountsSnap.empty) {
      return NextResponse.json(
        { error: 'No linked accounts found. Please connect a bank account first.' },
        { status: 400 }
      );
    }

    const accountId = accountsSnap.docs[0].id;
    const newTransId = `receipt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const { receiptUrl } = await storeReceiptInReceiptsCollection(newTransId);

    const transactionData: Partial<Transaction> = {
      trans_id: newTransId,
      merchant_name: receiptData.merchant,
      amount: signedAmount,
      category: receiptType === 'income' ? 'income' : receiptData.category || 'other',
      date: receiptData.date,
      description: `Receipt: ${receiptData.merchant}`,
      notes: `Receipt created from OCR. OCR confidence: ${Math.round(receiptData.confidence * 100)}%.`,
      analysis_status: 'pending',
      analyzed: false,
      receipt_filename: file.name,
      receipt_url: receiptUrl,
      ocr_data
    };

    const { data: savedTransaction, error: saveError } = await createTransactionServer(
      user.uid,
      accountId,
      transactionData
    );

    if (saveError || !savedTransaction) {
      console.error('❌ [Receipt OCR] Failed to save transaction:', saveError);
      return NextResponse.json(
        { error: 'Failed to save transaction', details: saveError },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      mode: 'commit',
      transaction: savedTransaction,
      receiptUrl
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
