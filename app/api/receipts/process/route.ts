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
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
  assertReceiptUploadOrigin, MAX_RECEIPT_BYTES, PRIVATE_RECEIPT_HEADERS,
  receiptBucket, receiptFormData, receiptMimeType, ReceiptRequestError,
  receiptSignatureMatches, safeReceiptName,
} from '@/lib/firebase/receipt-security';
import { transactionIdInput, transactionUpdatesInput } from '@/lib/transactions/client-updates';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const manualReceiptInput = z.object({
  merchant: z.string().trim().min(1).max(500),
  amount: z.number().finite().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value),
  category: z.string().trim().max(200).default('other'),
  iso_currency_code: z.literal('USD').optional(),
}).strict();

function receiptResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_RECEIPT_HEADERS });
}

function stagingReceiptFailure(step: string, error: unknown) {
  if (process.env.WRITEOFF_ENV !== 'staging') return;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const allowedCodes = [3, 5, 6, 7, 9, 13, 14, 16, 400, 401, 403, 404, 409, 412, 413, 429, 500, 502, 503, 504,
    'permission-denied', 'not-found', 'unavailable', 'already-exists', 'unauthenticated', 'invalid-argument',
    'failed-precondition', 'resource-exhausted', 'internal', 'unknown'];
  // Production compilation strips console calls. Keep staging diagnostics useful
  // without logging raw exceptions, receipt text, filenames or account identifiers.
  process.stderr.write(`${JSON.stringify({ event: 'receipt-processing-failed', step,
    code: allowedCodes.includes(code as string | number) ? code : 'unclassified' })}\n`);
}

async function storeReceipt(userId: string, transactionId: string, bytes: Buffer, mimeType: string, originalName: string, setStep: (step: string) => void) {
  const receiptId = uuidv4();
  const storagePath = `receipts/${userId}/${transactionId}/${receiptId}`;
  setStep('storage-configuration');
  const storedFile = receiptBucket().file(storagePath);
  const metadataRef = adminDb.collection('receipts').doc(receiptId);
  setStep('storage-save');
  await storedFile.save(bytes, {
    resumable: false,
    validation: 'crc32c',
    metadata: { contentType: mimeType, cacheControl: PRIVATE_RECEIPT_HEADERS['Cache-Control'] },
  });
  try {
    setStep('receipt-metadata');
    await metadataRef.create({
      transactionId, userId, filename: originalName, originalName,
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
}

export async function POST(request: NextRequest) {
  let step = 'authentication';
  const setStep = (next: string) => { step = next; };
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Receipt OCR] Authentication failed:', authError);
      return receiptResponse({ error: 'Unauthorized' }, 401);
    }

    assertReceiptUploadOrigin(request);
    // OCR and Storage are the costly steps; bound them per owner across instances
    // before the multipart body is read.
    setStep('rate-limit');
    const limit = await enforceRateLimit({ ...RATE_LIMITS.receiptProcess, key: user.uid });
    if (!limit.allowed) return rateLimitResponse(limit, { headers: PRIVATE_RECEIPT_HEADERS, error: 'Too many receipt scans. Please wait a few minutes and try again.' });
    setStep('multipart-validation');
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
    setStep('image-validation');
    const mimeType = receiptMimeType(file.type);
    if (!mimeType || mimeType === 'application/pdf') throw new ReceiptRequestError('Scan a JPG, PNG, GIF or WebP receipt image', 400);
    if (!file.size || file.size > MAX_RECEIPT_BYTES) throw new ReceiptRequestError('Upload a non-empty receipt of at most 10 MB', file.size ? 413 : 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!receiptSignatureMatches(bytes, mimeType)) throw new ReceiptRequestError('The receipt content does not match its file type', 400);
    const originalName = safeReceiptName(file.name);

    if (mode === 'commit' && typeof attachTransactionId === 'string') {
      // Existing bank details are authoritative. Attaching documentation needs
      // ownership and file validation, not OCR or a newly entered amount.
      setStep('attachment-ownership');
      const { data: existingTransaction, error: txErr } = await getTransactionServer(user.uid, attachTransactionId);
      if (txErr) throw new ReceiptRequestError('Unable to verify the transaction. Please retry.', 503);
      if (!existingTransaction) throw new ReceiptRequestError('Transaction not found for attachment', 404);

      const storedReceipt = await storeReceipt(user.uid, attachTransactionId, bytes, mimeType, originalName, setStep);
      const receiptUpdates = {
        receipt_url: storedReceipt.receiptUrl,
        receipt_filename: originalName,
        notes: `${existingTransaction.notes || ''}\nReceipt attached: ${originalName}.`.trim(),
      };
      let transaction: Transaction;
      try {
        setStep('attachment-update');
        const updated = await updateTransactionServerWithUserId(user.uid, attachTransactionId, receiptUpdates);
        if (updated.error) throw new ReceiptRequestError('Unable to attach this receipt. Please retry.', 503);
        const returned = Array.isArray(updated.data) ? updated.data[0] : updated.data;
        // The helper already verifies its write. Use that record or the known
        // owner record plus saved fields; another read can fail after success.
        transaction = { ...existingTransaction, ...returned, ...receiptUpdates, trans_id: attachTransactionId };
      } catch (error) {
        await storedReceipt.cleanup();
        throw error;
      }
      return receiptResponse({ success: true, mode: 'commit', transaction, receiptUrl: storedReceipt.receiptUrl });
    }

    let manualReceipt: z.infer<typeof manualReceiptInput> | undefined;
    setStep('receipt-field-validation');
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
    setStep(manualReceipt ? 'manual-confirmation' : 'ocr');
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
    if (attachTransactionId === null && !/^\d{4}-\d{2}-\d{2}$/.test(receiptData.date || '')) {
      throw new ReceiptRequestError('Enter the receipt date before saving', 422);
    }
    const signedAmount = receiptType === 'income' ? -receiptAmountAbs : receiptAmountAbs; // app expects expenses positive

    const ocr_data = {
      confidence: receiptData.confidence,
      raw_text: receiptData.rawText,
      items: receiptData.items || []
    };

    // A receipt that was not matched to a bank transaction is a manual entry.
    // Use the same owner-scoped account as manual transactions so onboarding
    // never requires a bank connection or assigns receipts to an unrelated bank.
    const accountId = 'manual';
    setStep('manual-account');
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
          user_id: user.uid,
          name: 'Manual Entries',
          type: 'manual',
          usageType: 'business',
          createdAt: new Date(),
        });
      }
    });

    const newTransId = `receipt_${uuidv4()}`;

    const storedReceipt = await storeReceipt(user.uid, newTransId, bytes, mimeType, originalName, setStep);
    const { receiptUrl } = storedReceipt;

    const transactionData: Partial<Transaction> & { source: 'receipt' } = {
      trans_id: newTransId,
      merchant_name: receiptData.merchant,
      amount: signedAmount,
      ...(manualReceipt?.iso_currency_code ? { iso_currency_code: manualReceipt.iso_currency_code } : {}),
      category: receiptType === 'income' ? 'income' : receiptData.category || 'other',
      date: receiptData.date,
      description: `Receipt: ${receiptData.merchant}`,
      notes: manualReceipt ? 'Receipt details confirmed manually.' : `Receipt created from OCR. OCR confidence: ${Math.round(receiptData.confidence * 100)}%.`,
      is_deductible: null,
      analysis_status: 'pending',
      source: 'receipt',
      analyzed: false,
      receipt_filename: originalName,
      receipt_url: receiptUrl,
      ocr_data
    };

    let savedTransaction: Transaction;
    try {
      setStep('transaction-save');
      const result = await createTransactionServer(user.uid, accountId, transactionData);
      if (result.error || !result.data) throw new Error('Transaction save failed');
      savedTransaction = result.data;
    } catch {
      await storedReceipt.cleanup();
      throw new ReceiptRequestError('Failed to save transaction. Please retry.', 503);
    }

    // The durable Firestore worker analyzes saved expenses after creation.

    return receiptResponse({
      success: true,
      mode: 'commit',
      transaction: savedTransaction,
      receiptUrl
    });

  } catch (error) {
    if (!(error instanceof ReceiptRequestError) || error.status >= 500) stagingReceiptFailure(step, error);
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
