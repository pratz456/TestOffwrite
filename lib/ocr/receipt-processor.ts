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

  async processReceipt(imageFile: File): Promise<OCRResult> {
    const startTime = Date.now();
    
    try {
      await this.initialize();
      
      if (!this.worker) {
        throw new Error('OCR worker not initialized');
      }

      // Perform OCR
      const { data: { text, confidence } } = await this.worker.recognize(imageFile);
      
      // Parse the extracted text
      const receiptData = this.parseReceiptText(text);
      
      const processingTime = Date.now() - startTime;
      
      return {
        success: true,
        data: {
          ...receiptData,
          confidence: confidence / 100, // Convert to 0-1 scale
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

  async processReceiptBatch(imageFiles: File[]): Promise<OCRResult[]> {
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

  async matchToExistingTransaction(receiptData: ReceiptData, transactions: any[]): Promise<any | null> {
    // Look for transactions that match the receipt data
    const matches = transactions.filter(tx => {
      const amountMatch = Math.abs(tx.amount - receiptData.amount) < 0.01;
      const merchantMatch = tx.merchant_name?.toLowerCase().includes(receiptData.merchant.toLowerCase()) ||
                           receiptData.merchant.toLowerCase().includes(tx.merchant_name?.toLowerCase() || '');
      const dateMatch = tx.date === receiptData.date;
      
      return amountMatch && (merchantMatch || dateMatch);
    });
    
    // Return the best match (prefer merchant match over date match)
    return matches.find(match => 
      match.merchant_name?.toLowerCase().includes(receiptData.merchant.toLowerCase())
    ) || matches[0] || null;
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
