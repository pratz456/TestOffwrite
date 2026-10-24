import Tesseract from 'tesseract.js';

export interface ReceiptData {
  merchant: string;
  amount: number | null;
  /** True when the total was missing, unreadable, or ambiguous. The amount is then blank. */
  amountNeedsReview?: boolean;
  date: string;
  category?: string;
  confidence: number;
  rawText: string;
  items?: ReceiptItem[];
}

export interface ReceiptMatchCandidate {
  trans_id: string;
  merchant_name: string;
  amount: number;
  category?: string;
  date: string;
  confidence: number; // 0..1
  hasReceipt: boolean;
  matchReasons: string[];
}

export interface ReceiptItem {
  description: string;
  amount: number;
  quantity?: number;
}

export interface OCRResult {
  success: boolean;
  data?: ReceiptData;
  error?: string;
  processingTime: number;
}

type TotalRead = { amount: number | null; amountNeedsReview: boolean };

const TOTAL_LABELS: ReadonlyArray<{ rank: number; source: string }> = [
  { rank: 1, source: String.raw`grand\s+total` },
  { rank: 2, source: String.raw`(?:balance|amount|total)\s+due` },
  { rank: 3, source: String.raw`total` },
  { rank: 4, source: String.raw`amount` },
];

const CURRENCY_CODES = 'USD|EUR|GBP|INR|CAD|AUD|CHF|JPY|CNY';

function blankTotal(): TotalRead {
  return { amount: null, amountNeedsReview: true };
}

function confidentTotal(value: number): TotalRead {
  if (!Number.isFinite(value) || value <= 0) return blankTotal();
  const rounded = Math.round(value * 100) / 100;
  if (!(rounded > 0)) return blankTotal();
  return { amount: rounded, amountNeedsReview: false };
}

/** Drop one exact copy of the total token so other amounts can act as format clues. */
function hideToken(text: string, raw: string): string {
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(String.raw`(?:^|[^\d.,])${escaped}(?![\d.,])`), ' ');
}

function hasGroupedAmount(text: string, body: string): boolean {
  return new RegExp(String.raw`(?:^|[^\d.,])(?:${body})(?![\d.,])`).test(text);
}

function hasUsMoneyClue(text: string, raw: string): boolean {
  const rest = hideToken(text, raw);
  if (/\$\s*\d/.test(rest)) return true;
  return hasGroupedAmount(rest, String.raw`\d{1,3}(?:,\d{3})*\.\d{2}`)
    || hasGroupedAmount(rest, String.raw`\d+\.\d{2}`);
}

function hasEuMoneyClue(text: string, raw: string): boolean {
  const rest = hideToken(text, raw);
  return hasGroupedAmount(rest, String.raw`\d{1,3}(?:\.\d{3})*,\d{2}`)
    || hasGroupedAmount(rest, String.raw`\d+,\d{2}`);
}

/**
 * Read one numeric token. A comma and exactly two digits, with no dot, is a decimal.
 * A thousands group with no decimal part is used only when another amount on the
 * receipt shows the same format. Otherwise the total is left blank.
 */
function interpretNumber(raw: string, leadingDollar: boolean, receiptText: string): TotalRead {
  if (!/^\d+(?:[.,]\d+)*$/.test(raw)) return blankTotal();
  const comma = raw.includes(',');
  const dot = raw.includes('.');
  if (comma && dot) {
    if (raw.lastIndexOf('.') > raw.lastIndexOf(',')) {
      if (!/^\d{1,3}(?:,\d{3})*\.\d{2}$/.test(raw)) return blankTotal();
      return confidentTotal(Number(raw.replace(/,/g, '')));
    }
    if (!/^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(raw)) return blankTotal();
    return confidentTotal(Number(raw.replace(/\./g, '').replace(',', '.')));
  }
  if (comma) {
    if (/^\d+,\d{2}$/.test(raw)) return confidentTotal(Number(raw.replace(',', '.')));
    if (/^\d{1,3}(?:,\d{3})+$/.test(raw) && (leadingDollar || (hasUsMoneyClue(receiptText, raw) && !hasEuMoneyClue(receiptText, raw)))) {
      return confidentTotal(Number(raw.replace(/,/g, '')));
    }
    return blankTotal();
  }
  if (dot) {
    if (/^\d+\.\d{2}$/.test(raw)) return confidentTotal(Number(raw));
    if (/^\d{1,3}(?:\.\d{3})+$/.test(raw) && !leadingDollar && hasEuMoneyClue(receiptText, raw) && !hasUsMoneyClue(receiptText, raw)) {
      return confidentTotal(Number(raw.replace(/\./g, '')));
    }
    return blankTotal();
  }
  if (/^\d+$/.test(raw)) return confidentTotal(Number(raw));
  return blankTotal();
}

/**
 * The amount sits on the total line, with an optional currency code, or a dollar
 * sign, on either side. Other currency symbols before the number are not read here.
 */
function readAmountAfterLabel(rest: string, receiptText: string): TotalRead {
  const cleaned = rest.replace(/^[\s:.#\-]+/, '');
  const match = cleaned.match(new RegExp(
    String.raw`^(?:(?:${CURRENCY_CODES})\s+|(\$)\s*)?(\d[\d.,]*)(.*)$`,
    'i',
  ));
  if (!match) return blankTotal();
  const raw = match[2].replace(/\.$/, '');
  const trailing = match[3] ?? '';
  const tail = trailing.match(new RegExp(String.raw`^\s*(?:(?:${CURRENCY_CODES})|[$€£¥₹])?\s*(.*)$`, 'i'));
  if (/\d/.test(tail?.[1] ?? '')) return blankTotal();
  return interpretNumber(raw, match[1] === '$', receiptText);
}

function findTotalLine(lines: string[]): string | null {
  let best: { rank: number; lineIndex: number; rest: string } | null = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (/\bsub[\s-]?total\b/i.test(line)) continue;
    const hits: { rank: number; end: number }[] = [];
    for (const label of TOTAL_LABELS) {
      const pattern = new RegExp(String.raw`\b(?:${label.source})\b`, 'gi');
      for (const match of line.matchAll(pattern)) {
        hits.push({ rank: label.rank, end: (match.index ?? 0) + match[0].length });
      }
    }
    if (hits.length === 0) continue;
    const rank = Math.min(...hits.map(hit => hit.rank));
    if (rank > 3 && /\b(?:tax|tip|gratuity|discount|change|tender)\b/i.test(line)) continue;
    const end = Math.max(...hits.map(hit => hit.end));
    if (!best || rank < best.rank || (rank === best.rank && lineIndex > best.lineIndex)) {
      best = { rank, lineIndex, rest: line.slice(end) };
    }
  }
  return best?.rest ?? null;
}

/** Prefer the labeled total. Subtotal, tax, and tip never supply the saved amount. */
function readReceiptTotal(text: string): TotalRead {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const rest = findTotalLine(lines);
  if (rest == null) return blankTotal();
  return readAmountAfterLabel(rest, text);
}

export class ReceiptProcessor {
  private static instance: ReceiptProcessor;
  private worker: Tesseract.Worker | null = null;

  private constructor() {}

  public static getInstance(): ReceiptProcessor {
    if (!ReceiptProcessor.instance) {
      ReceiptProcessor.instance = new ReceiptProcessor();
    }
    return ReceiptProcessor.instance;
  }

  async initialize(): Promise<void> {
    if (!this.worker) {
      this.worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      });
    }
  }

  async processReceipt(imageFile: File | Buffer): Promise<OCRResult> {
    const startTime = Date.now();
    
    try {
      await this.initialize();
      
      if (!this.worker) {
        throw new Error('OCR worker not initialized');
      }

      // Convert File/Blob to Buffer for Node.js Tesseract worker compatibility
      let imageInput: Buffer;
      if (Buffer.isBuffer(imageFile)) {
        imageInput = imageFile;
      } else {
        const arrayBuffer = await imageFile.arrayBuffer();
        imageInput = Buffer.from(arrayBuffer);
      }

      // Perform OCR
      const { data: { text, confidence } } = await this.worker.recognize(imageInput);
      
      // Parse the extracted text
      const receiptData = this.parseReceiptText(text);
      
      const processingTime = Date.now() - startTime;
      
      const amountNeedsReview = receiptData.amountNeedsReview === true
        || !(typeof receiptData.amount === 'number' && Number.isFinite(receiptData.amount) && receiptData.amount > 0);
      return {
        success: true,
        data: {
          merchant: receiptData.merchant || 'Unknown Merchant',
          // A missing or uncertain total stays blank. Zero would be a false expense.
          amount: amountNeedsReview ? null : receiptData.amount ?? null,
          amountNeedsReview,
          // An unreadable date must be entered by the user, never defaulted to today.
          date: this.normalizeDateToISO(receiptData.date) || '',
          category: receiptData.category,
          items: receiptData.items,
          confidence: confidence / 100,
          rawText: text
        },
        processingTime
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime
      };
    }
  }

  async processReceiptBatch(imageFiles: (File | Buffer)[]): Promise<OCRResult[]> {
    const results: OCRResult[] = [];
    
    for (const file of imageFiles) {
      const result = await this.processReceipt(file);
      results.push(result);
    }
    
    return results;
  }

  private parseReceiptText(text: string): Partial<ReceiptData> {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // Extract merchant name (usually first line or line with business indicators)
    const merchant = this.extractMerchant(lines);
    
    // Extract total amount (look for currency patterns)
    const total = this.extractAmount(text);
    
    // Extract date (look for date patterns)
    const date = this.extractDate(text);
    
    // Extract category based on merchant and items
    const category = this.extractCategory(merchant, text);
    
    // Extract individual items
    const items = this.extractItems(lines);
    
    return {
      merchant,
      amount: total.amount,
      amountNeedsReview: total.amountNeedsReview,
      date,
      category,
      items
    };
  }

  private extractMerchant(lines: string[]): string {
    // Look for common business indicators
    const businessIndicators = ['LLC', 'INC', 'CORP', 'LTD', 'CO', 'STORE', 'RESTAURANT', 'CAFE'];
    
    for (const line of lines.slice(0, 5)) { // Check first 5 lines
      if (businessIndicators.some(indicator => line.toUpperCase().includes(indicator))) {
        return line;
      }
    }
    
    // If no business indicators, use first non-empty line
    return lines[0] || 'Unknown Merchant';
  }

  private extractAmount(text: string): { amount: number | null; amountNeedsReview: boolean } {
    return readReceiptTotal(text);
  }

  private extractDate(text: string): string {
    // Look for various date patterns
    const datePatterns = [
      /\b(\d{4}-\d{1,2}-\d{1,2})\b/g, // YYYY-MM-DD before short hyphenated dates
      /(\d{1,2}\/\d{1,2}\/\d{2,4})/g, // MM/DD/YYYY or MM/DD/YY
      /(\d{1,2}-\d{1,2}-\d{2,4})/g, // MM-DD-YYYY
      /(\w{3,9}\s+\d{1,2},?\s+\d{2,4})/g, // Month DD, YYYY
    ];
    
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0];
      }
    }
    
    // Default to today's date if no date found
    return new Date().toISOString().split('T')[0];
  }

  private extractCategory(merchant: string, text: string): string {
    const merchantLower = merchant.toLowerCase();
    const textLower = text.toLowerCase();
    
    // Category mapping based on keywords
    const categoryMap = {
      'meals_50': ['restaurant', 'cafe', 'coffee', 'food', 'dining', 'starbucks', 'mcdonalds', 'subway'],
      'gas': ['gas', 'fuel', 'shell', 'exxon', 'chevron', 'bp', 'mobil'],
      'office_supplies': ['office', 'staples', 'office depot', 'supplies', 'paper', 'pen'],
      'software_subscriptions': ['software', 'subscription', 'adobe', 'microsoft', 'google'],
      'travel': ['hotel', 'airline', 'flight', 'travel', 'uber', 'lyft', 'taxi'],
      'utilities_phone_internet': ['phone', 'internet', 'electric', 'gas', 'water', 'utility'],
      'vehicle_expense': ['auto', 'car', 'vehicle', 'repair', 'maintenance', 'oil change'],
      'home_office': ['home depot', 'lowes', 'furniture', 'desk', 'chair', 'monitor']
    };
    
    for (const [category, keywords] of Object.entries(categoryMap)) {
      if (keywords.some(keyword => 
        merchantLower.includes(keyword) || textLower.includes(keyword)
      )) {
        return category;
      }
    }
    
    return 'other';
  }

  private extractItems(lines: string[]): ReceiptItem[] {
    const items: ReceiptItem[] = [];
    
    // Look for lines that might be items (contain amounts but aren't totals)
    const itemPattern = /^(.+?)\s+(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)$/;
    
    for (const line of lines) {
      const match = line.match(itemPattern);
      if (match) {
        const description = match[1].trim();
        const amount = parseFloat(match[2].replace(/,/g, ''));
        
        // Skip if it looks like a total or tax line
        if (!description.toLowerCase().includes('total') && 
            !description.toLowerCase().includes('tax') &&
            !description.toLowerCase().includes('subtotal')) {
          items.push({
            description,
            amount
          });
        }
      }
    }
    
    return items;
  }

  /**
   * Finds the best transaction matches for a scanned receipt.
   * Matching is intentionally sign-agnostic (we compare absolute amounts),
   * because expenses may be stored as positive and income/refunds as negative.
   */
  async findMatchingTransactions(
    receiptData: ReceiptData,
    transactions: any[],
    limit = 5
  ): Promise<ReceiptMatchCandidate[]> {
    const receiptDateIso = this.normalizeDateToISO(receiptData.date);
    const receiptMerchantNorm = this.normalizeMerchant(receiptData.merchant);
    const receiptAmountAbs = receiptData.amountNeedsReview || !(typeof receiptData.amount === 'number' && receiptData.amount > 0)
      ? null
      : Math.abs(receiptData.amount);

    const candidates: ReceiptMatchCandidate[] = [];

    for (const tx of transactions) {
      const txTransId = String(tx.trans_id ?? tx.id ?? '');
      if (!txTransId) continue;

      const txMerchantName = String(tx.merchant_name ?? '');
      const txMerchantNorm = this.normalizeMerchant(txMerchantName);
      if (!txMerchantNorm) continue;

      const txDateIso = this.normalizeDateToISO(tx.date);
      const txAmountAbs = Math.abs(Number(tx.amount || 0));

      // A blank total is not zero, so it must not match nearby amounts.
      let amountScore = 0;
      if (receiptAmountAbs != null) {
        const amountDiff = Math.abs(txAmountAbs - receiptAmountAbs);
        const amountTol = receiptAmountAbs >= 100 ? 2 : receiptAmountAbs >= 10 ? 1 : 0.25;
        amountScore = amountDiff <= amountTol
          ? 1
          : Math.max(0, 1 - amountDiff / (amountTol * 3));
      }

      const merchantScore = this.scoreMerchants(receiptMerchantNorm, txMerchantNorm);

      const dateScore = txDateIso && receiptDateIso && txDateIso === receiptDateIso ? 1 : 0;

      // If category is available, use it as a soft boost only.
      const categoryScore = this.scoreStringsOptional(receiptData.category, tx.category);

      // Base weights: amount dominates, then merchant, then date.
      const confidence = this.clamp01(0.45 * amountScore + 0.35 * merchantScore + 0.20 * dateScore) +
        0.05 * categoryScore;

      if (confidence < 0.35) continue;

      const matchReasons: string[] = [];
      if (amountScore >= 0.9) matchReasons.push('amount');
      if (merchantScore >= 0.8) matchReasons.push('merchant');
      if (dateScore >= 0.9) matchReasons.push('date');
      if (categoryScore >= 0.9) matchReasons.push('category');

      candidates.push({
        trans_id: txTransId,
        merchant_name: txMerchantName,
        amount: Number(tx.amount || 0),
        category: tx.category,
        date: tx.date,
        confidence: this.clamp01(confidence),
        hasReceipt: Boolean(tx.receipt_url || tx.receipt_filename),
        matchReasons,
      });
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates.slice(0, Math.max(1, limit));
  }

  /**
   * Simple OCR heuristic: detect whether the receipt looks like a refund/credit.
   * Returns 'income' because credits/refunds are stored as negative amounts in this app.
   */
  inferReceiptDirectionFromText(rawText: string): { direction: 'expense' | 'income' | 'unknown'; confidence: number } {
    const text = (rawText || '').toLowerCase();

    const refundKeywords = ['refund', 'credited', 'credit', 'returned', 'return', 'money back', 'amount credited'];
    const depositKeywords = ['deposit', 'payout', 'payment received', 'received payment', 'earned', 'interest'];

    if (refundKeywords.some((k) => text.includes(k))) {
      return { direction: 'income', confidence: 0.85 };
    }

    if (depositKeywords.some((k) => text.includes(k))) {
      return { direction: 'income', confidence: 0.65 };
    }

    // Most receipts we scan are expense receipts (default).
    return { direction: 'expense', confidence: 0.55 };
  }

  private normalizeDateToISO(dateLike: any): string | null {
    try {
      if (!dateLike) return null;
      if (typeof dateLike === 'string') {
        const d = new Date(dateLike);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        // If it's already YYYY-MM-DD-ish, just grab the prefix.
        if (/^\d{4}-\d{2}-\d{2}/.test(dateLike)) return dateLike.slice(0, 10);
        return null;
      }
      if (dateLike instanceof Date) return dateLike.toISOString().split('T')[0];
      if (typeof dateLike === 'number') return new Date(dateLike).toISOString().split('T')[0];
      return null;
    } catch {
      return null;
    }
  }

  private normalizeMerchant(merchant: string): string {
    return String(merchant || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private scoreStringsOptional(a?: string, b?: string): number {
    const aNorm = this.normalizeMerchant(a || '');
    const bNorm = this.normalizeMerchant(b || '');
    if (!aNorm || !bNorm) return 0.3;

    if (aNorm === bNorm) return 1;
    if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return 0.7;
    return 0.3;
  }

  private scoreMerchants(receiptMerchantNorm: string, txMerchantNorm: string): number {
    if (!receiptMerchantNorm || !txMerchantNorm) return 0;

    // Direct substring match is a strong signal.
    if (txMerchantNorm.includes(receiptMerchantNorm) || receiptMerchantNorm.includes(txMerchantNorm)) {
      return 1;
    }

    const receiptTokens = receiptMerchantNorm.split(' ').filter((t) => t.length >= 3);
    const txTokens = txMerchantNorm.split(' ').filter((t) => t.length >= 3);
    if (!receiptTokens.length || !txTokens.length) return 0;

    const receiptSet = new Set(receiptTokens);
    const overlap = [...receiptSet].filter((t) => txTokens.includes(t)).length;
    const jaccard = overlap / Math.max(receiptTokens.length, txTokens.length);

    return this.clamp01(jaccard);
  }

  private clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

// Export singleton instance
export const receiptProcessor = ReceiptProcessor.getInstance();
