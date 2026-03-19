import Tesseract from 'tesseract.js';

export interface ReceiptData {
  merchant: string;
  amount: number;
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
      
      return {
        success: true,
        data: {
          merchant: receiptData.merchant || 'Unknown Merchant',
          amount: receiptData.amount || 0,
          date: receiptData.date || new Date().toISOString().split('T')[0],
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
    const amount = this.extractAmount(text);
    
    // Extract date (look for date patterns)
    const date = this.extractDate(text);
    
    // Extract category based on merchant and items
    const category = this.extractCategory(merchant, text);
    
    // Extract individual items
    const items = this.extractItems(lines);
    
    return {
      merchant,
      amount,
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

  private extractAmount(text: string): number {
    // Look for currency patterns: $X.XX, X.XX, $X,XX (European format)
    const currencyPatterns = [
      /\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g, // $1,234.56
      /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*USD/g, // 1234.56 USD
      /TOTAL[:\s]*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi, // TOTAL: $1234.56
      /AMOUNT[:\s]*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi, // AMOUNT: $1234.56
      /SUBTOTAL[:\s]*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi, // SUBTOTAL: $1234.56
    ];
    
    let maxAmount = 0;
    
    for (const pattern of currencyPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const amount = parseFloat(match[1].replace(/,/g, ''));
        if (amount > maxAmount) {
          maxAmount = amount;
        }
      }
    }
    
    return maxAmount;
  }

  private extractDate(text: string): string {
    // Look for various date patterns
    const datePatterns = [
      /(\d{1,2}\/\d{1,2}\/\d{2,4})/g, // MM/DD/YYYY or MM/DD/YY
      /(\d{1,2}-\d{1,2}-\d{2,4})/g, // MM-DD-YYYY
      /(\d{4}-\d{1,2}-\d{1,2})/g, // YYYY-MM-DD
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
    const receiptAmountAbs = Math.abs(Number(receiptData.amount || 0));

    const candidates: ReceiptMatchCandidate[] = [];

    for (const tx of transactions) {
      const txTransId = String(tx.trans_id ?? tx.id ?? '');
      if (!txTransId) continue;

      const txMerchantName = String(tx.merchant_name ?? '');
      const txMerchantNorm = this.normalizeMerchant(txMerchantName);
      if (!txMerchantNorm) continue;

      const txDateIso = this.normalizeDateToISO(tx.date);
      const txAmountAbs = Math.abs(Number(tx.amount || 0));

      const amountDiff = Math.abs(txAmountAbs - receiptAmountAbs);
      const amountTol = receiptAmountAbs >= 100 ? 2 : receiptAmountAbs >= 10 ? 1 : 0.25;

      const amountScore = amountDiff <= amountTol
        ? 1
        : Math.max(0, 1 - amountDiff / (amountTol * 3));

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
