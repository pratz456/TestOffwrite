/**
 * Bank Statement & Expense Document Import API
 * 
 * Accepts:
 *   - Bank/credit card statements (PDF or photo) — extracts transactions
 *   - Receipt images — extracts merchant, amount, date, category
 *   - Expense reports — extracts line items
 *
 * Uses GPT-4o vision to parse documents and saves transactions to Firestore
 * in the same format as Plaid-imported transactions.
 *
 * POST /api/tax/import-bank-statement
 * Body (multipart/form-data):
 *   file: image/pdf
 *   docType: 'bank_statement' | 'credit_card' | 'receipt' | 'expense_report' | 'auto'
 *   year: number (tax year, e.g. 2025)
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb } from '@/lib/firebase/admin';
import OpenAI from 'openai';

const BANK_STATEMENT_PROMPT = `You are a financial document parser specializing in bank and credit card statements.

Extract ALL transactions from this bank/credit card statement. For each transaction extract:
- date (YYYY-MM-DD format)
- description (merchant name or transaction description, cleaned up)
- amount (positive = expense/debit, negative = income/credit)
- category (best guess: Food & Drink, Travel, Software, Office Supplies, Advertising, Professional Services, Utilities, Health, Entertainment, Shopping, Other)
- transaction_type: "debit" | "credit"

Rules:
- Extract EVERY transaction, even recurring ones
- Clean up merchant names (e.g. "AMZN MKTP US*2A3B4C" → "Amazon")
- For credits/deposits: make amount negative
- For debits/purchases: make amount positive
- Skip balance carry-forward rows and summary totals
- Date format MUST be YYYY-MM-DD

Return ONLY valid JSON:
{
  "docType": "bank_statement",
  "bankName": string or null,
  "accountLast4": string or null,
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
  "subtotal": number or null,
  "tax": number or null,
  "items": [{ "description": string, "amount": number }],
  "category": string (best guess for Schedule C category),
  "businessPurpose": string or null (if visible on receipt),
  "confidence": "high" | "medium" | "low"
}`;

const AUTO_DETECT_PROMPT = `You are a financial document classifier. Look at this document and determine what type it is.

Return ONLY valid JSON:
{
  "detectedType": "bank_statement" | "credit_card" | "receipt" | "expense_report" | "w2" | "1099" | "unknown",
  "confidence": "high" | "medium" | "low",
  "reason": string
}`;

async function callGPT4Vision(base64: string, mimeType: string, prompt: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 4000,
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

  return response.choices[0]?.message?.content || '';
}

function parseJSON(raw: string): any {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const docTypeHint = (formData.get('docType') as string) || 'auto';
    const year = parseInt(formData.get('year') as string || String(new Date().getFullYear()), 10);

    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    // Convert to base64
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString('base64');
    const mimeType = file.type || 'image/jpeg';

    // Step 1: Auto-detect if needed
    let docType = docTypeHint;
    if (docType === 'auto') {
      const detected = await callGPT4Vision(base64, mimeType, AUTO_DETECT_PROMPT);
      const autoResult = parseJSON(detected);
      docType = autoResult.detectedType || 'bank_statement';
      
      // If it's a tax form, redirect to the existing import endpoint
      if (docType === 'w2' || docType === '1099') {
        return NextResponse.json({
          redirect: true,
          message: `This looks like a ${docType.toUpperCase()} tax form. Please use the Tax Document Import feature instead.`,
          detectedType: docType,
        });
      }
    }

    let savedCount = 0;
    let result: any = {};

    if (docType === 'bank_statement' || docType === 'credit_card') {
      // Parse all transactions from the statement
      const raw = await callGPT4Vision(base64, mimeType, BANK_STATEMENT_PROMPT);
      const parsed = parseJSON(raw);

      const transactions = parsed.transactions || [];
      const batch = adminDb.batch();
      savedCount = 0;

      for (const tx of transactions) {
        if (!tx.date || !tx.description || tx.amount === undefined) continue;

        const txDate = new Date(tx.date + 'T12:00:00');
        const txYear = txDate.getFullYear();
        if (txYear < year - 1 || txYear > year + 1) continue; // Filter to relevant year

        const docRef = adminDb.collection(`accounts/${user.uid}/transactions`).doc();
        batch.set(docRef, {
          userId: user.uid,
          merchant_name: tx.description,
          name: tx.description,
          amount: Math.abs(tx.amount),
          date: tx.date,
          category: [tx.category || 'Other'],
          transaction_type: tx.transaction_type || 'debit',
          is_deductible: null,          // Needs user review
          deduction_score: null,        // AI will analyze later
          source: 'manual_statement',   // Different from Plaid
          importedFromStatement: true,
          statementBank: parsed.bankName || 'Unknown',
          accountLast4: parsed.accountLast4 || null,
          pending: false,
          createdAt: new Date(),
          taxYear: txYear,
        });
        savedCount++;

        if (savedCount % 400 === 0) {
          await batch.commit();
        }
      }
      await batch.commit();

      result = {
        docType: 'bank_statement',
        bankName: parsed.bankName,
        accountLast4: parsed.accountLast4,
        statementPeriod: parsed.statementPeriod,
        transactionsImported: savedCount,
        totalFound: transactions.length,
        confidence: parsed.confidence,
        message: `Imported ${savedCount} transactions. Review and confirm which are business expenses.`,
      };

    } else if (docType === 'receipt') {
      const raw = await callGPT4Vision(base64, mimeType, RECEIPT_PROMPT);
      const parsed = parseJSON(raw);

      if (parsed.total && parsed.merchant) {
        const receiptDate = parsed.date || new Date().toISOString().split('T')[0];
        await adminDb.collection(`accounts/${user.uid}/transactions`).add({
          userId: user.uid,
          merchant_name: parsed.merchant,
          name: parsed.merchant,
          amount: Math.abs(parsed.total),
          date: receiptDate,
          category: [parsed.category || 'Other'],
          transaction_type: 'debit',
          is_deductible: null,
          deduction_score: null,
          source: 'receipt_scan',
          importedFromReceipt: true,
          receiptItems: parsed.items || [],
          businessPurpose: parsed.businessPurpose || null,
          pending: false,
          createdAt: new Date(),
          taxYear: parseInt(receiptDate.split('-')[0], 10),
        });
        savedCount = 1;
      }

      result = {
        docType: 'receipt',
        merchant: parsed.merchant,
        amount: parsed.total,
        date: parsed.date,
        category: parsed.category,
        transactionsImported: savedCount,
        confidence: parsed.confidence,
      };
    }

    return NextResponse.json({
      success: true,
      ...result,
    });

  } catch (error: any) {
    console.error('[import-bank-statement] error:', error);
    return NextResponse.json({
      error: error?.message || 'Failed to process document',
    }, { status: 500 });
  }
}
