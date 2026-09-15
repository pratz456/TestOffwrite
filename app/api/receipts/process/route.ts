import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { receiptProcessor, type OCRResult } from '@/lib/ocr/receipt-processor';
import {
  createTransactionServer,
  getTransactionServer,
  getTransactionsServer,
  updateTransactionServerWithUserId,
  type Transaction
} from '@/lib/firebase/transactions-server';
import { adminDb } from '@/lib/firebase/admin';
import { getUserProfileServer } from '@/lib/firebase/profiles-server';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
  assertReceiptUploadOrigin, MAX_RECEIPT_BYTES, PRIVATE_RECEIPT_HEADERS,
  receiptBucket, receiptFormData, receiptMimeType, ReceiptRequestError,
  receiptSignatureMatches, safeReceiptName,
} from '@/lib/firebase/receipt-security';
import { transactionIdInput, transactionUpdatesInput } from '@/lib/transactions/client-updates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const manualReceiptInput = z.object({
  merchant: z.string().trim().min(1).max(500),
  amount: z.number().finite().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value),
  category: z.string().trim().max(200).default('other'),
}).strict();

function receiptResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_RECEIPT_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Receipt OCR] Authentication failed:', authError);
      return receiptResponse({ error: 'Unauthorized' }, 401);
    }

    assertReceiptUploadOrigin(request);
    const formData = await receiptFormData(request);
    const files = formData.getAll('file');
    if (files.length !== 1 || !(files[0] instanceof File)) {
      throw new ReceiptRequestError('Provide one receipt image', 400);
    }
    const file = files[0];
    const mode = String(formData.get('mode') ?? 'commit'); // 'ocr' | 'commit'
    const receiptType = String(formData.get('receiptType') ?? 'expense'); // 'expense' | 'income'
    const attachTransactionId = formData.get('attachTransactionId');
    if (!['ocr', 'commit'].includes(mode)) throw new ReceiptRequestError('Invalid mode', 400);
    if (!['expense', 'income'].includes(receiptType)) throw new ReceiptRequestError('Invalid receiptType', 400);
    if (attachTransactionId !== null && !transactionIdInput.safeParse(attachTransactionId).success) {
      throw new ReceiptRequestError('A valid transaction ID is required', 400);
    }
    const mimeType = receiptMimeType(file.type);
    if (!mimeType || mimeType === 'application/pdf') throw new ReceiptRequestError('Scan a JPG, PNG, GIF or WebP receipt image', 400);
    if (!file.size || file.size > MAX_RECEIPT_BYTES) throw new ReceiptRequestError('Upload a non-empty receipt of at most 10 MB', file.size ? 413 : 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!receiptSignatureMatches(bytes, mimeType)) throw new ReceiptRequestError('The receipt content does not match its file type', 400);
    const originalName = safeReceiptName(file.name);

    let manualReceipt: z.infer<typeof manualReceiptInput> | undefined;
    const manualData = formData.get('receiptData');
    if (mode === 'commit' && attachTransactionId === null && manualData !== null) {
      if (typeof manualData !== 'string' || manualData.length > 5000) throw new ReceiptRequestError('Provide valid receipt details', 400);
      let parsedJson: unknown;
      try { parsedJson = JSON.parse(manualData); }
      catch { throw new ReceiptRequestError('Provide valid receipt details', 400); }
      const parsed = manualReceiptInput.safeParse(parsedJson);
      if (!parsed.success) throw new ReceiptRequestError('Provide a merchant, positive amount, valid date and category', 400);
      manualReceipt = parsed.data;
    }
    // Manual confirmation must work even when OCR could not read the image.
    const ocrResult: OCRResult = manualReceipt
      ? { success: true, data: { ...manualReceipt, confidence: 0, rawText: '', items: [] }, processingTime: 0 }
      : await receiptProcessor.processReceipt(bytes);

    if (!ocrResult.success || !ocrResult.data) {
      console.error('❌ [Receipt OCR] OCR failed:', ocrResult.error);
      throw new ReceiptRequestError('Could not read this receipt. Please try a clearer image.', 422);
    }

    const receiptData = ocrResult.data;

    const receiptDirectionSuggestion = receiptProcessor.inferReceiptDirectionFromText(receiptData.rawText);

    // OCR-only: return extracted data + match candidates, but do not write anything.
    if (mode === 'ocr') {
      const { data: existingTransactions, error: txErr } = await getTransactionsServer(user.uid);
      const matchCandidates = txErr
        ? []
        : await receiptProcessor.findMatchingTransactions(receiptData, existingTransactions, 3);

      return receiptResponse({
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
    const receiptAmountAbs = Math.abs(Number(receiptData.amount || 0));
    if (attachTransactionId === null && (!Number.isFinite(receiptAmountAbs) || receiptAmountAbs <= 0)) {
      throw new ReceiptRequestError('Enter a positive receipt amount before saving', 422);
    }
    const signedAmount = receiptType === 'income' ? -receiptAmountAbs : receiptAmountAbs; // app expects expenses positive

    const ocr_data = {
      confidence: receiptData.confidence,
      raw_text: receiptData.rawText,
      items: receiptData.items || []
    };

    const storeReceipt = async (transactionId: string) => {
      const receiptId = uuidv4();
      const storagePath = `receipts/${user.uid}/${transactionId}/${receiptId}`;
      const storedFile = receiptBucket().file(storagePath);
      const metadataRef = adminDb.collection('receipts').doc(receiptId);
      await storedFile.save(bytes, {
        resumable: false,
        validation: 'crc32c',
        metadata: { contentType: mimeType, cacheControl: PRIVATE_RECEIPT_HEADERS['Cache-Control'] },
      });
      try {
        await metadataRef.create({
          transactionId, userId: user.uid, filename: originalName, originalName,
          mimeType, size: bytes.length, storagePath, uploadedAt: new Date(),
        });
      } catch (error) {
        await storedFile.delete({ ignoreNotFound: true }).catch(() => undefined);
        throw error;
      }
      return {
        receiptUrl: `/api/receipts/${receiptId}`,
        cleanup: async () => {
          await Promise.allSettled([metadataRef.delete(), storedFile.delete({ ignoreNotFound: true })]);
        },
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

    if (typeof attachTransactionId === 'string') {
      const { data: existingTransaction, error: txErr } = await getTransactionServer(user.uid, attachTransactionId);

      if (txErr) throw new ReceiptRequestError('Unable to verify the transaction. Please retry.', 503);
      if (!existingTransaction) throw new ReceiptRequestError('Transaction not found for attachment', 404);

      const storedReceipt = await storeReceipt(attachTransactionId);
      const { receiptUrl } = storedReceipt;

      const previousReceiptLabel =
        existingTransaction.receipt_filename || existingTransaction.receipt_url || null;

      const updatedNotes = appendReceiptToNotes(existingTransaction.notes, previousReceiptLabel);

      try {
        const receiptUpdates = {
          receipt_url: receiptUrl, receipt_filename: originalName, ocr_data, notes: updatedNotes,
        };
        const updated = await updateTransactionServerWithUserId(user.uid, attachTransactionId, receiptUpdates);
        if (updated.error || !updated.data) throw new ReceiptRequestError('Unable to attach this receipt. Please retry.', 503);
      } catch (error) {
        await storedReceipt.cleanup();
        throw error;
      }

      const { data: refreshedTx } = await getTransactionServer(user.uid, attachTransactionId);

      return receiptResponse({
        success: true,
        mode: 'commit',
        transaction: refreshedTx,
        receiptUrl
      });
    }

    // A receipt that was not matched to a bank transaction is a manual entry.
    // Use the same owner-scoped account as manual transactions so onboarding
    // never requires a bank connection or assigns receipts to an unrelated bank.
    const accountId = 'manual';
    const accountRef = adminDb
      .collection('user_profiles')
      .doc(user.uid)
      .collection('accounts')
      .doc(accountId);
    await adminDb.runTransaction(async transaction => {
      const account = await transaction.get(accountRef);
      if (!account.exists) {
        transaction.create(accountRef, {
          userId: user.uid,
          name: 'Manual Entries',
          type: 'manual',
          usageType: 'business',
          createdAt: new Date(),
        });
      }
    });

    const newTransId = `receipt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const storedReceipt = await storeReceipt(newTransId);
    const { receiptUrl } = storedReceipt;

    const transactionData: Partial<Transaction> = {
      trans_id: newTransId,
      merchant_name: receiptData.merchant,
      amount: signedAmount,
      category: receiptType === 'income' ? 'income' : receiptData.category || 'other',
      date: receiptData.date,
      description: `Receipt: ${receiptData.merchant}`,
      notes: manualReceipt ? 'Receipt details confirmed manually.' : `Receipt created from OCR. OCR confidence: ${Math.round(receiptData.confidence * 100)}%.`,
      is_deductible: null,
      analysis_status: 'pending',
      analyzed: false,
      receipt_filename: originalName,
      receipt_url: receiptUrl,
      ocr_data
    };

    let savedTransaction: Transaction;
    try {
      const result = await createTransactionServer(user.uid, accountId, transactionData);
      if (result.error || !result.data) throw new Error('Transaction save failed');
      savedTransaction = result.data;
    } catch {
      await storedReceipt.cleanup();
      throw new ReceiptRequestError('Failed to save transaction. Please retry.', 503);
    }

    // Match the manual-entry analysis contract; an income receipt is not a deduction.
    if (receiptType === 'expense') {
      void (async () => {
        try {
          const { analyzeTransactionWithRetry, convertToEnhancedContext } = await import('@/lib/ai/analyzeTransaction');
          const { data: profile } = await getUserProfileServer(user.uid);
          if (!profile) return;
          const result = await analyzeTransactionWithRetry({
            tx_id: savedTransaction.trans_id, merchant: receiptData.merchant,
            amount_usd: receiptAmountAbs, date_iso: receiptData.date,
            category: receiptData.category || 'other', account_usage_type: 'business',
          }, convertToEnhancedContext(profile, receiptData.date));
          if (result.success) {
            const analysisUpdates = {
              analyzed: true, analysis_status: 'completed' as const, analysisStatus: 'completed' as const,
              ai_category: result.result.category, ai_audit_risk: result.result.audit_risk,
              ai_confidence: result.result.confidence, ai_customized_reason: result.result.customized_reason,
              ai_irs_refs: result.result.irs_refs,
            };
            await updateTransactionServerWithUserId(user.uid, savedTransaction.trans_id, analysisUpdates);
          }
        } catch { /* Non-fatal: the receipt and transaction remain saved for review. */ }
      })();
    }

    return receiptResponse({
      success: true,
      mode: 'commit',
      transaction: savedTransaction,
      receiptUrl
    });

  } catch (error) {
    console.error('❌ [Receipt OCR] Unexpected error:', error);
    return receiptResponse({ error: error instanceof ReceiptRequestError ? error.message : 'Failed to process receipt. Please retry.' }, error instanceof ReceiptRequestError ? error.status : 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Receipt OCR] Authentication failed:', authError);
      return receiptResponse({ error: 'Unauthorized' }, 401);
    }

    assertReceiptUploadOrigin(request);
    const body = await request.json().catch(() => null);
    const transactionId = transactionIdInput.safeParse(body?.transactionId);
    const updates = transactionUpdatesInput.safeParse(body?.updates);
    if (!transactionId.success || !updates.success) return receiptResponse({ error: 'Provide a valid transaction and editable fields.' }, 400);

    // Update transaction with user corrections
    const { updateTransactionServerWithUserId } = await import('@/lib/firebase/transactions-server');
    const { data, error } = await updateTransactionServerWithUserId(user.uid, transactionId.data, updates.data);

    if (error) {
      console.error('❌ [Receipt OCR] Update failed:', error);
      return receiptResponse({ error: 'Unable to update receipt details. Please retry.' }, 503);
    }

    return receiptResponse({
      success: true,
      transaction: data
    });

  } catch (error) {
    console.error('❌ [Receipt OCR] Unexpected error:', error);
    return receiptResponse({ error: error instanceof ReceiptRequestError ? error.message : 'Unable to update receipt details. Please retry.' }, error instanceof ReceiptRequestError ? error.status : 500);
  }
}
