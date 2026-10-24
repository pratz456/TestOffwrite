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

import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { DocumentReference } from 'firebase-admin/firestore';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb } from '@/lib/firebase/admin';
import { getOpenAIClientOrThrow, getOpenAIModel } from '@/lib/openai/client';
import { overlapKey } from '@/lib/transactions/historical-overlap';
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
    max_completion_tokens: 4000,
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
const WRITE_CHUNK = 400;

type ImportedTransaction = z.infer<typeof importedTransaction>;
interface PlannedImport { ref: DocumentReference; data: Record<string, unknown>; legacyMatch: boolean }
interface ImportSaveCounts { imported: number; alreadyImported: number; flaggedLegacy: number }

function normalizedDescription(value: string): string {
  return value.toUpperCase().replace(/\s+/g, ' ').trim();
}

function storedAmount(row: ImportedTransaction): number {
  return row.transaction_type === 'credit' ? -Math.abs(row.amount) : Math.abs(row.amount);
}

function amountCents(amount: number): number {
  return Math.round(amount * 100);
}

function legacyMatchKey(date: string, cents: number, direction: string, description: string): string {
  return JSON.stringify([date, cents, direction, normalizedDescription(description)]);
}

type ImportNamespace = 'statement' | 'receipt';

/** Card last digits plus institution, when the model detected either. Never the shared import account id. */
function detectedAccountScope(bankName: string | null | undefined, accountLast4: string | null | undefined): string | null {
  const last4 = typeof accountLast4 === 'string' ? accountLast4.trim() : '';
  const bank = typeof bankName === 'string' ? bankName.trim() : '';
  if (!last4 && !bank) return null;
  return `account:${last4}:${normalizedDescription(bank)}`;
}

function importDocumentId(uid: string, namespace: ImportNamespace, scope: string, row: ImportedTransaction, occurrence: number): string {
  return createHash('sha256').update(JSON.stringify([
    uid, namespace, scope, row.date, amountCents(storedAmount(row)), row.transaction_type,
    normalizedDescription(row.description), occurrence,
  ])).digest('hex');
}

function isAlreadyExists(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

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

/** Bank purchases share one overlap key (date, signed cents, merchant, currency). See overlapKey. */
async function bankOverlapKeys(uid: string): Promise<Set<string>> {
  const accounts = await adminDb.collection('user_profiles').doc(uid).collection('accounts').get();
  const linked = accounts.docs.filter(accountDoc => {
    if (accountDoc.id === IMPORT_ACCOUNT_ID) return false;
    const data = accountDoc.data() ?? {};
    return data.source === 'plaid' || typeof data.plaid_item_id === 'string';
  });
  const snapshots = await Promise.all(linked.map(accountDoc => accountDoc.ref.collection('transactions')
    .select('date', 'amount', 'merchant_name', 'name', 'description', 'iso_currency_code', 'unofficial_currency_code').get()));
  const keys = new Set<string>();
  for (const snapshot of snapshots) {
    for (const transaction of snapshot.docs) {
      const key = overlapKey(transaction.data());
      if (key) keys.add(key);
    }
  }
  return keys;
}

function recordedMatchKey(data: Record<string, unknown>): string | null {
  const date = textValue(data.date).slice(0, 10);
  const direction = data.transaction_type === 'debit' || data.transaction_type === 'credit' ? data.transaction_type : '';
  const description = textValue(data.merchant_name) || textValue(data.name) || textValue(data.description);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !direction || !description.trim() || typeof data.amount !== 'number' || !Number.isFinite(data.amount)) return null;
  return legacyMatchKey(date, amountCents(data.amount), direction, description);
}

function isReceiptRecord(data: Record<string, unknown>): boolean {
  return data.source === 'receipt' || data.importedFromReceipt === true;
}

/** Older statement imports used a random document id and have no import_row_id. */
async function legacyImportKeys(account: DocumentReference): Promise<Set<string>> {
  const snapshot = await account.collection('transactions')
    .select('date', 'amount', 'transaction_type', 'merchant_name', 'name', 'description', 'import_row_id').get();
  const keys = new Set<string>();
  for (const transaction of snapshot.docs) {
    const data = transaction.data() ?? {};
    if (typeof data.import_row_id === 'string' && data.import_row_id.length > 0) continue;
    const key = recordedMatchKey(data);
    if (key) keys.add(key);
  }
  return keys;
}

/** Existing statement rows, stable or legacy, so a receipt can be flagged instead of dropped. */
async function statementImportKeys(account: DocumentReference): Promise<Set<string>> {
  const snapshot = await account.collection('transactions')
    .select('date', 'amount', 'transaction_type', 'merchant_name', 'name', 'description', 'source', 'importedFromReceipt').get();
  const keys = new Set<string>();
  for (const transaction of snapshot.docs) {
    const data = transaction.data() ?? {};
    if (isReceiptRecord(data)) continue;
    const key = recordedMatchKey(data);
    if (key) keys.add(key);
  }
  return keys;
}

async function createDocuments(items: PlannedImport[]): Promise<PlannedImport[]> {
  const created: PlannedImport[] = [];
  for (let offset = 0; offset < items.length; offset += WRITE_CHUNK) {
    const slice = items.slice(offset, offset + WRITE_CHUNK);
    const snaps = await adminDb.getAll(...slice.map(item => item.ref));
    const fresh = slice.filter((_, index) => snaps[index]?.exists !== true);
    if (!fresh.length) continue;
    const batch = adminDb.batch();
    for (const item of fresh) batch.create(item.ref, item.data);
    try {
      await batch.commit();
      created.push(...fresh);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (fresh.length === 1) continue;
      const mid = Math.ceil(fresh.length / 2);
      created.push(...await createDocuments(fresh.slice(0, mid)), ...await createDocuments(fresh.slice(mid)));
    }
  }
  return created;
}

/** Validate the entire extraction before creating the account or any transaction. */
async function saveTransactions(uid: string, rows: ImportedTransaction[], metadata: Record<string, unknown>, identity: { namespace: ImportNamespace; scope: string }): Promise<ImportSaveCounts> {
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

  const seen = new Map<string, number>();
  const planned: PlannedImport[] = rows.map(row => {
    const amount = storedAmount(row);
    const cents = amountCents(amount);
    const tuple = legacyMatchKey(row.date, cents, row.transaction_type, row.description);
    const occurrence = (seen.get(tuple) ?? 0) + 1;
    seen.set(tuple, occurrence);
    const id = importDocumentId(uid, identity.namespace, identity.scope, row, occurrence);
    const ref = account.collection('transactions').doc(id);
    const now = new Date();
    return {
      ref, legacyMatch: false,
      data: {
        ...metadata,
        trans_id: id, import_row_id: id, userId: uid, account_id: IMPORT_ACCOUNT_ID,
        merchant_name: row.description, name: row.description,
        // Direction is not a tax classification: refunds and transfers remain credits.
        amount, iso_currency_code: 'USD', date: row.date,
        category: row.category || 'Other', transaction_type: row.transaction_type,
        is_deductible: null, deduction_score: null, analyzed: false,
        analysis_status: 'pending', analysisStatus: 'pending', pending: false,
        created_at: now, updated_at: now, taxYear: Number(row.date.slice(0, 4)),
      },
    };
  });
  const [legacyKeys, linkedKeys, statementKeys] = await Promise.all([
    legacyImportKeys(account),
    bankOverlapKeys(uid),
    identity.namespace === 'receipt' ? statementImportKeys(account) : Promise.resolve(new Set<string>()),
  ]);
  for (const item of planned) {
    const key = legacyMatchKey(textValue(item.data.date), amountCents(Number(item.data.amount)), textValue(item.data.transaction_type), textValue(item.data.merchant_name));
    const statementMatch = statementKeys.has(key);
    const legacyMatch = identity.namespace === 'statement' && legacyKeys.has(key);
    const linked = overlapKey(item.data);
    const bankLinked = linked !== null && linkedKeys.has(linked);
    item.legacyMatch = legacyMatch;
    const reason = statementMatch ? 'statement_match' : legacyMatch ? 'legacy_match' : bankLinked ? 'bank_linked' : null;
    if (reason) {
      item.data.possibleDuplicate = true;
      item.data.possibleDuplicateReason = reason;
    }
  }
  const created = await createDocuments(planned);
  return { imported: created.length, alreadyImported: planned.length - created.length, flaggedLegacy: created.filter(item => item.legacyMatch).length };
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
    const fileHash = createHash('sha256').update(bytes).digest('hex');
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
      const saved = await saveTransactions(user.uid, parsed.transactions, {
        source: 'manual', import_source: 'manual_statement', importedFromStatement: true,
        statementBank: parsed.bankName || 'Unknown', accountLast4: parsed.accountLast4 || null,
      }, { namespace: 'statement', scope: detectedAccountScope(parsed.bankName, parsed.accountLast4) ?? `file:${fileHash}` });
      return NextResponse.json({
        success: true, docType: 'bank_statement', bankName: parsed.bankName, accountLast4: parsed.accountLast4,
        statementPeriod: parsed.statementPeriod, imported: saved.imported, alreadyImported: saved.alreadyImported,
        flaggedLegacy: saved.flaggedLegacy, transactionsImported: saved.imported,
        totalFound: parsed.transactions.length, confidence: parsed.confidence,
        message: `Imported ${saved.imported} transactions for AI analysis. ${saved.alreadyImported} were already imported. ${saved.flaggedLegacy} match an older import and were saved again for review. Review and confirm their categories when analysis finishes.`,
      });
    }

    const parsed = requireReadable(receiptData, parseJSON(await callGPT4Vision(base64, file.type, RECEIPT_PROMPT)));
    if (Math.abs(Number(parsed.date.slice(0, 4)) - year) > 1) {
      throw new ReceiptRequestError('No transactions were saved. The receipt date does not match the selected tax year.', 422);
    }
    const saved = await saveTransactions(user.uid, [{ date: parsed.date, description: parsed.merchant, amount: parsed.total, category: parsed.category, transaction_type: 'debit' }], {
      source: 'receipt', importedFromReceipt: true, receiptItems: parsed.items || [], business_purpose: parsed.businessPurpose || '',
    }, { namespace: 'receipt', scope: `file:${fileHash}` });
    return NextResponse.json({
      success: true, docType: 'receipt', merchant: parsed.merchant, amount: parsed.total, date: parsed.date,
      category: parsed.category, imported: saved.imported, alreadyImported: saved.alreadyImported,
      flaggedLegacy: saved.flaggedLegacy, transactionsImported: saved.imported, confidence: parsed.confidence,
    });
  } catch (error) {
    if (error instanceof ReceiptRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    // Provider errors may contain document bytes or credentials; do not echo or log them.
    return NextResponse.json({ error: 'Failed to process document' }, { status: 500 });
  }
}
