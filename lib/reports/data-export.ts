import { adminDb } from '@/lib/firebase/admin';

export interface UserDataExport {
  exportInfo: {
    exportDate: string;
    userId: string;
    exportId: string;
    dataVersion: string;
  };
  userProfile: any;
  accounts: any[];
  transactions: any[];
  receipts: any[];
  aiAnalysis: any[];
}

/**
 * Generate a complete data export for a user
 * @param userId - The user ID to export data for
 * @returns Promise with complete user data export
 */
export async function generateUserDataExport(userId: string): Promise<UserDataExport> {
  try {
    console.log(`📊 [Data Export] Starting export for user: ${userId}`);
    
    const exportId = `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 1. Get user profile
    const userProfileDoc = await adminDb.collection('user_profiles').doc(userId).get();
    const userProfile = userProfileDoc.exists ? userProfileDoc.data() : null;
    
    // 2. Get all accounts for the user
    const accountsQuery = adminDb
      .collection('user_profiles')
      .doc(userId)
      .collection('accounts');
    const accountsSnapshot = await accountsQuery.get();
    const accounts = accountsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    // 3. Get all transactions for the user
    const transactionsQuery = adminDb
      .collectionGroup('transactions')
      .where('user_id', '==', userId);
    const transactionsSnapshot = await transactionsQuery.get();
    const transactions = transactionsSnapshot.docs.map(doc => ({
      id: doc.id,
      path: doc.ref.path,
      ...doc.data()
    }));
    
    // 4. Get receipt metadata (from transaction documents)
    const receipts = transactions
      .filter(tx => tx.receipt_url || tx.receipt_filename)
      .map(tx => ({
        transactionId: tx.trans_id || tx.id,
        receiptUrl: tx.receipt_url,
        receiptFilename: tx.receipt_filename,
        receiptStoragePath: tx.receipt_storage_path,
        receiptSize: tx.receipt_size,
        receiptMimeType: tx.receipt_mime_type,
        receiptUploadedAt: tx.receipt_uploaded_at,
        merchantName: tx.merchant_name,
        amount: tx.amount,
        date: tx.date
      }));
    
    // 5. Get AI analysis data (from transaction documents)
    const aiAnalysis = transactions
      .filter(tx => tx.ai_analysis || tx.analyzed)
      .map(tx => ({
        transactionId: tx.trans_id || tx.id,
        isDeductible: tx.is_deductible,
        deductionScore: tx.deduction_score,
        deductibleReason: tx.deductible_reason,
        confidence: tx.confidence,
        reasoning: tx.reasoning,
        irsPublication: tx.irsPublication,
        analysisStatus: tx.analysis_status || tx.analysisStatus,
        analyzed: tx.analyzed,
        analysisCompletedAt: tx.analysisCompletedAt,
        aiAnalysis: tx.ai_analysis ? JSON.parse(tx.ai_analysis) : null,
        merchantName: tx.merchant_name,
        amount: tx.amount,
        date: tx.date
      }));
    
    const exportData: UserDataExport = {
      exportInfo: {
        exportDate: new Date().toISOString(),
        userId,
        exportId,
        dataVersion: '1.0'
      },
      userProfile,
      accounts,
      transactions,
      receipts,
      aiAnalysis
    };
    
    console.log(`✅ [Data Export] Generated export for user ${userId}:`, {
      accounts: accounts.length,
      transactions: transactions.length,
      receipts: receipts.length,
      aiAnalysis: aiAnalysis.length
    });
    
    return exportData;
  } catch (error) {
    console.error('❌ [Data Export] Failed to generate export:', error);
    throw new Error(`Failed to generate data export: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Convert transaction data to CSV format
 * @param transactions - Array of transaction objects
 * @returns CSV string
 */
export function convertTransactionsToCSV(transactions: any[]): string {
  if (transactions.length === 0) {
    return 'No transactions found';
  }
  
  // Define CSV headers
  const headers = [
    'Transaction ID',
    'Date',
    'Amount',
    'Merchant Name',
    'Category',
    'Description',
    'Is Deductible',
    'Deduction Score',
    'Deductible Reason',
    'Analysis Status',
    'Receipt Filename',
    'Receipt URL',
    'Created At',
    'Updated At'
  ];
  
  // Convert transactions to CSV rows
  const rows = transactions.map(tx => [
    tx.trans_id || tx.id || '',
    tx.date || '',
    tx.amount || '',
    tx.merchant_name || '',
    tx.category || '',
    tx.description || '',
    tx.is_deductible || '',
    tx.deduction_score || '',
    tx.deductible_reason || '',
    tx.analysis_status || tx.analysisStatus || '',
    tx.receipt_filename || '',
    tx.receipt_url || '',
    tx.createdAt || tx.created_at || '',
    tx.updatedAt || tx.updated_at || ''
  ]);
  
  // Escape CSV values (handle commas, quotes, newlines)
  const escapeCsvValue = (value: any): string => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  
  // Build CSV
  const csvRows = [
    headers.join(','),
    ...rows.map(row => row.map(escapeCsvValue).join(','))
  ];
  
  return csvRows.join('\n');
}

/**
 * Generate a data package with multiple formats
 * @param userData - Complete user data export
 * @returns Object with different data formats
 */
export function generateDataPackage(userData: UserDataExport) {
  const csvTransactions = convertTransactionsToCSV(userData.transactions);
  
  return {
    // JSON format (complete data)
    json: {
      exportInfo: userData.exportInfo,
      userProfile: userData.userProfile,
      accounts: userData.accounts,
      transactions: userData.transactions,
      receipts: userData.receipts,
      aiAnalysis: userData.aiAnalysis
    },
    
    // CSV format (transactions only)
    csv: csvTransactions,
    
    // Summary format
    summary: {
      exportInfo: userData.exportInfo,
      counts: {
        accounts: userData.accounts.length,
        transactions: userData.transactions.length,
        receipts: userData.receipts.length,
        aiAnalysis: userData.aiAnalysis.length
      },
      dateRange: {
        earliest: userData.transactions.length > 0 
          ? Math.min(...userData.transactions.map(tx => new Date(tx.date).getTime()))
          : null,
        latest: userData.transactions.length > 0 
          ? Math.max(...userData.transactions.map(tx => new Date(tx.date).getTime()))
          : null
      }
    },
    
    // Readme text
    readme: generateReadmeText(userData)
  };
}

/**
 * Generate a README text file for the export
 * @param userData - Complete user data export
 * @returns README text
 */
function generateReadmeText(userData: UserDataExport): string {
  return `WriteOff Data Export
========================

Export Information:
- Export Date: ${userData.exportInfo.exportDate}
- Export ID: ${userData.exportInfo.exportId}
- Data Version: ${userData.exportInfo.dataVersion}

Data Summary:
- User Profile: ${userData.userProfile ? 'Included' : 'Not found'}
- Bank Accounts: ${userData.accounts.length}
- Transactions: ${userData.transactions.length}
- Receipts: ${userData.receipts.length}
- AI Analysis Records: ${userData.aiAnalysis.length}

File Descriptions:
- profile.json: Complete user profile information
- accounts.json: Bank account details (no sensitive credentials)
- transactions.json: Complete transaction history with all fields
- transactions.csv: Transaction data in CSV format for Excel
- receipts.json: Receipt metadata and download URLs
- ai_analysis.json: AI analysis results and deductions
- summary.json: Export summary and statistics

Data Privacy:
- This export contains your personal financial data
- Receipt URLs are included but files are not downloaded
- No bank credentials or sensitive authentication tokens are included
- All data is from your WriteOff account as of the export date

For questions about this export, contact WriteOff support.
`;
}

/**
 * Validate export data for completeness
 * @param userData - User data export to validate
 * @returns Validation result
 */
export function validateExportData(userData: UserDataExport): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check required fields
  if (!userData.exportInfo.userId) {
    errors.push('Missing user ID in export info');
  }
  
  if (!userData.exportInfo.exportDate) {
    errors.push('Missing export date');
  }
  
  // Check data consistency
  if (userData.transactions.length === 0) {
    warnings.push('No transactions found for user');
  }
  
  if (userData.accounts.length === 0) {
    warnings.push('No bank accounts found for user');
  }
  
  // Check for missing user profile
  if (!userData.userProfile) {
    warnings.push('User profile not found');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}
