/**
 * Bank Statement & Expense Document Import API
 * 
 * Accepts:
 *   - Bank/credit card statement images — extracts transactions
 *   - Receipt images — extracts merchant, amount, date, category
 *
 * Uses GPT-4o vision to parse documents and saves transactions to Firestore
 * in the same format as Plaid-imported transactions.
 *
 * POST /api/tax/import-bank-statement
 * Body (multipart/form-data):
 *   file: PNG, JPEG, or WebP image
 *   docType: 'bank_statement' | 'credit_card' | 'receipt' | 'auto'
 *   year: number (tax year, e.g. 2025)
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb } from '@/lib/firebase/admin';
import { getOpenAIClientOrThrow, getOpenAIModel } from '@/lib/openai/client';
import { z } from 'zod';
import { MAX_RECEIPT_BYTES, ReceiptRequestError, receiptFormData, receiptSignatureMatches } from '@/lib/firebase/receipt-security';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';

const BANK_STATEMENT_PROMPT = `You are a financial document parser specializing in bank and credit card statements.

Extract ALL transactions from this bank/credit card statement. For each transaction extract:
- date (YYYY-MM-DD format)
- description (merchant name or transaction description, cleaned up)
- amount (positive = debit, negative = credit)
- category (best guess: Food & Drink, Travel, Software, Office Supplies, Advertising, Professional Services, Utilities, Health, Entertainment, Shopping, Other)
- transaction_type: "debit" | "credit"

Rules:
- Extract EVERY transaction, even recurring ones
- Clean up merchant names (e.g. "AMZN MKTP US*2A3B4C" → "Amazon")
- For credits/deposits: make amount negative
- For debits/purchases: make amount positive
- A credit is only a cash direction: do not assume it is taxable income. It may be a refund or transfer.
- Extract currency as a three-letter ISO code only when the document explicitly identifies it. A dollar sign alone is insufficient; use null if unclear.
- Skip balance carry-forward rows and summary totals
- Date format MUST be YYYY-MM-DD

Return ONLY valid JSON:
{
  "docType": "bank_statement",
  "bankName": string or null,
  "accountLast4": string or null,
  "currency": "USD" or another explicit three-letter ISO code or null,
  "statementPeriod": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } or null,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": string,
      "amount": number,
      "category": string,
      "transaction_type": "debit" | "credit"
    }
  ],
  "transactionCount": number,
  "confidence": "high" | "medium" | "low"
}`;

const RECEIPT_PROMPT = `You are a receipt parser. Extract the key details from this receipt or invoice image.

Return ONLY valid JSON:
{
  "docType": "receipt",
  "merchant": string,
  "date": "YYYY-MM-DD" or null,
  "total": number,
  "currency": "USD" or another explicit three-letter ISO code or null,
  "subtotal": number or null,
  "tax": number or null,
  "items": [{ "description": string, "amount": number }],
  "category": string (best guess for Schedule C category),
  "businessPurpose": string or null (if visible on receipt),
  "confidence": "high" | "medium" | "low"
}

Only identify currency from an explicit ISO code or currency name on the document. A dollar sign alone is insufficient; use null if unclear.`;

const AUTO_DETECT_PROMPT = `You are a financial document classifier. Look at this document and determine what type it is.

Return ONLY valid JSON:
{
  "detectedType": "bank_statement" | "credit_card" | "receipt" | "expense_report" | "w2" | "1099" | "unknown",
  "confidence": "high" | "medium" | "low",
  "reason": string
}`;

async function callGPT4Vision(base64: string, mimeType: string, prompt: string): Promise<string> {
  const openai = getOpenAIClientOrThrow();

  const response = await openai.chat.completions.create({
    model: getOpenAIModel('document'),
    max_tokens: 4000,
    store: false,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: 'high',
            },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const choice = response.choices[0];
  if (choice?.finish_reason !== 'stop' || choice.message.refusal || !choice.message.content) {
    throw new ReceiptRequestError('Document extraction could not finish. Try a clearer image with fewer rows.', 422);
  }
  return choice.message.content;
}

const validDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value =>
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const importedTransaction = z.object({
  date: validDate,
  description: z.string().trim().min(1).max(500),
  amount: z.number().finite(),
  category: z.string().trim().max(200).optional(),
  transaction_type: z.enum(['debit', 'credit']),
});
const statementData = z.object({
  currency: z.literal('USD'),
  bankName: z.string().trim().max(200).nullable().optional(),
  accountLast4: z.string().regex(/^\d{4}$/).nullable().optional(),
  statementPeriod: z.object({ start: validDate, end: validDate }).nullable().optional(),
  transactions: z.array(importedTransaction).min(1).max(2000),
  confidence: z.enum(['high', 'medium', 'low']),
});
const receiptData = z.object({
  currency: z.literal('USD'),
  merchant: z.string().trim().min(1).max(500),
  date: validDate,
  total: z.number().finite().nonnegative(),
  category: z.string().trim().max(200).optional(),
  businessPurpose: z.string().trim().max(2000).nullable().optional(),
  items: z.array(z.object({ description: z.string().trim().max(500), amount: z.number().finite() })).max(500).optional(),
  confidence: z.enum(['high', 'medium', 'low']),
});
const IMPORT_ACCOUNT_ID = 'statement-imports';

type ImportedTransaction = z.infer<typeof importedTransaction>;

function parseJSON(raw: string): unknown {
  try { return JSON.parse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()); }
  catch { throw new ReceiptRequestError('Could not read this document reliably. Try a clearer image.', 422); }
}

function requireReadable<T extends { confidence: string }>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success || result.data.confidence === 'low') {
    throw new ReceiptRequestError('No transactions were saved. Provide a clear image with complete dates, amounts, debit/credit direction, and explicit USD currency.', 422);
  }
  return result.data;
}

/** Validate the entire extraction before creating the account or any transaction. */
async function saveTransactions(uid: string, rows: ImportedTransaction[], metadata: Record<string, unknown>) {
  const account = adminDb.collection('user_profiles').doc(uid).collection('accounts').doc(IMPORT_ACCOUNT_ID);
  await adminDb.runTransaction(async transaction => {
    const existing = await transaction.get(account);
    if (existing.exists) {
      if (existing.data()?.userId !== uid) throw new ReceiptRequestError('Import account is unavailable.', 409);
    } else {
      transaction.create(account, {
        userId: uid, account_id: IMPORT_ACCOUNT_ID, name: 'Document Imports',
        type: 'manual', usageType: 'unknown', source: 'manual', createdAt: new Date(),
      });
    }
  });

  for (let offset = 0; offset < rows.length; offset += 400) {
    const batch = adminDb.batch();
    for (const row of rows.slice(offset, offset + 400)) {
      const ref = account.collection('transactions').doc();
      const now = new Date();
      batch.set(ref, {
        ...metadata,
        trans_id: ref.id, userId: uid, account_id: IMPORT_ACCOUNT_ID,
        merchant_name: row.description, name: row.description,
        // Direction is not a tax classification: refunds and transfers remain credits.
        amount: row.transaction_type === 'credit' ? -Math.abs(row.amount) : Math.abs(row.amount),
        iso_currency_code: 'USD', date: row.date,
        category: row.category || 'Other', transaction_type: row.transaction_type,
        is_deductible: null, deduction_score: null, analyzed: false,
        analysis_status: 'pending', analysisStatus: 'pending', pending: false,
        created_at: now, updated_at: now, taxYear: Number(row.date.slice(0, 4)),
      });
    }
    await batch.commit();
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Up to two vision-model calls per upload; bound them per owner before the body is read.
    const limit = await enforceRateLimit({ ...RATE_LIMITS.taxStatementImport, key: user.uid });
    if (!limit.allowed) return rateLimitResponse(limit, { error: 'Too many document scans. Please wait a few minutes and try again.' });
    const formData = await receiptFormData(request);
    const file = formData.get('file');
    const hint = String(formData.get('docType') || 'auto');
    const year = Number(formData.get('year') || new Date().getFullYear());
    if (!['auto', 'bank_statement', 'credit_card', 'receipt'].includes(hint) || !Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'Choose a bank statement, credit card statement, or receipt and a valid tax year.' }, { status: 400 });
    }
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    if (!file.size || file.size > MAX_RECEIPT_BYTES) return NextResponse.json({ error: 'Upload a nonempty file under 10 MB.' }, { status: 413 });
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      return NextResponse.json({ error: 'Upload a PNG, JPEG, or WebP image of this document.' }, { status: 415 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!receiptSignatureMatches(bytes, file.type)) return NextResponse.json({ error: 'The file contents do not match its image type.' }, { status: 415 });
    const base64 = bytes.toString('base64');

    let docType = hint;
    if (docType === 'auto') {
      const detected = parseJSON(await callGPT4Vision(base64, file.type, AUTO_DETECT_PROMPT));
      const parsed = z.object({ detectedType: z.enum(['bank_statement', 'credit_card', 'receipt', 'expense_report', 'w2', '1099', 'unknown']), confidence: z.enum(['high', 'medium', 'low']) }).safeParse(detected);
      if (!parsed.success || parsed.data.confidence === 'low') throw new ReceiptRequestError('Could not identify this document reliably. Choose its type and try again.', 422);
      docType = parsed.data.detectedType;
      if (docType === 'w2' || docType === '1099') {
        return NextResponse.json({ redirect: true, message: `This looks like a ${docType.toUpperCase()} tax form. Please use the Tax Document Import feature instead.`, detectedType: docType });
      }
    }
    if (!['bank_statement', 'credit_card', 'receipt'].includes(docType)) {
      return NextResponse.json({ error: 'This document type is not supported. Upload a bank statement or receipt image.' }, { status: 422 });
    }

    if (docType === 'bank_statement' || docType === 'credit_card') {
      const parsed = requireReadable(statementData, parseJSON(await callGPT4Vision(base64, file.type, BANK_STATEMENT_PROMPT)));
      if (parsed.transactions.some(row => Math.abs(Number(row.date.slice(0, 4)) - year) > 1)) {
        throw new ReceiptRequestError('No transactions were saved. The document dates do not match the selected tax year.', 422);
      }
      await saveTransactions(user.uid, parsed.transactions, {
        source: 'manual', import_source: 'manual_statement', importedFromStatement: true,
        statementBank: parsed.bankName || 'Unknown', accountLast4: parsed.accountLast4 || null,
      });
      return NextResponse.json({
        success: true, docType: 'bank_statement', bankName: parsed.bankName, accountLast4: parsed.accountLast4,
        statementPeriod: parsed.statementPeriod, transactionsImported: parsed.transactions.length,
        totalFound: parsed.transactions.length, confidence: parsed.confidence,
        message: `Imported ${parsed.transactions.length} transactions for AI analysis. Review and confirm their categories when analysis finishes.`,
      });
    }

    const parsed = requireReadable(receiptData, parseJSON(await callGPT4Vision(base64, file.type, RECEIPT_PROMPT)));
    if (Math.abs(Number(parsed.date.slice(0, 4)) - year) > 1) {
      throw new ReceiptRequestError('No transactions were saved. The receipt date does not match the selected tax year.', 422);
    }
    await saveTransactions(user.uid, [{ date: parsed.date, description: parsed.merchant, amount: parsed.total, category: parsed.category, transaction_type: 'debit' }], {
      source: 'receipt', importedFromReceipt: true, receiptItems: parsed.items || [], business_purpose: parsed.businessPurpose || '',
    });
    return NextResponse.json({
      success: true, docType: 'receipt', merchant: parsed.merchant, amount: parsed.total, date: parsed.date,
      category: parsed.category, transactionsImported: 1, confidence: parsed.confidence,
    });
  } catch (error) {
    if (error instanceof ReceiptRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    // Provider errors may contain document bytes or credentials; do not echo or log them.
    return NextResponse.json({ error: 'Failed to process document' }, { status: 500 });
  }
}
