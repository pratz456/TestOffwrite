import { 
  collection,
  doc, 
  getDoc,
  getDocs,
  setDoc, 
  updateDoc, 
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  DocumentData,
  QuerySnapshot,
  collectionGroup
} from "firebase/firestore";
import { db } from "./client";

export interface Transaction {
  id: string;
  trans_id: string;
  merchant_name: string;
  amount: number;
  category: string;
  date: string;
  datetime?: string; // Full datetime from Plaid (ISO format)
  type?: 'expense' | 'income';
  is_deductible?: boolean | null;
  deductible_reason?: string;
  deduction_score?: number;
  ai_analysis?: string; // Original AI analysis text - never overwritten
  user_classification_reason?: string; // User's reason for classification
  description?: string;
  notes?: string;
  receipt_url?: string; // URL to uploaded receipt image
  receipt_filename?: string; // Original filename of the receipt
  
  // Transaction-Specific Context Fields
  business_purpose?: string; // Why this expense was necessary for business
  attendees?: string[]; // For meal expenses - who attended
  travel_destination?: string; // For travel expenses - where and why
  equipment_details?: {
    make?: string;
    model?: string;
    year?: number;
    business_use_percentage?: number;
    depreciation_method?: 'straight_line' | 'declining_balance' | 'section_179';
  };
  client_project?: string; // Associated client or project name
  documentation_status?: 'complete' | 'partial' | 'missing'; // Receipt/documentation status
  meeting_notes?: string; // Notes about business meetings or discussions
  mileage_details?: {
    start_location?: string;
    end_location?: string;
    miles?: number;
    business_purpose?: string;
  };

  // AI Analysis Fields from initial analysis
  ai?: {
    status_label?: string;
    score_pct?: number;
    reasoning?: string;
    irs?: { publication?: string; section?: string };
    required_docs?: string[];
    category_hint?: string;
    risk_flags?: string[];
    model?: string;
    last_analyzed_at?: number;
    key_analysis_factors?: {
      business_purpose?: string;
      ordinary_necessary?: string;
      documentation_required?: string[];
      audit_risk?: 'Low' | 'Medium' | 'High';
      specific_rules?: string[];
      limitations?: string[];
      deduction_status?: 'Likely Deductible' | 'Possibly Deductible' | 'Unlikely Deductible' | 'Income';
      deduction_percentage?: number;
      reasoning_summary?: string;
      irs_reference?: string;
    };
  } | null;

  // Analysis status
  analyzed?: boolean;
  analysisStatus?: 'pending' | 'running' | 'completed' | 'failed';

  // New AI Analysis Fields (for re-run analysis)
  deductionStatus?: 'Likely Deductible' | 'Possibly Deductible' | 'Non-Deductible';
  confidence?: number; // 0-1 confidence score
  reasoning?: string; // Short IRS-aligned explanation (≤280 chars)
  irsPublication?: string; // IRS publication reference
  irsSection?: string; // IRS section reference
  analysisUpdatedAt?: string; // When the analysis was last updated

  account_id?: string;
  user_id?: string;
  created_at?: any;
  updated_at?: any;
}

// Client-side function (for use in components)
export async function getTransactions(userId: string): Promise<{ data: Transaction[]; error: any }> {
  try {
    console.log('🔍 [Firebase] Fetching transactions for user:', userId);
    
    // Get all transactions across all accounts for this user
    const transactionsQuery = query(
      collectionGroup(db, 'transactions'),
      where('userId', '==', userId)
    );
    
    const querySnapshot = await getDocs(transactionsQuery);
    console.log('📊 [Firebase] Query returned', querySnapshot.size, 'transactions');
    
    const transactions: Transaction[] = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data() as DocumentData;
      console.log('🔍 [Firebase] Processing transaction:', {
        id: data.trans_id || doc.id,
        merchant: data.merchant_name,
        category: data.category,
        is_deductible: data.is_deductible,
        is_deductible_type: typeof data.is_deductible,
      });
      
      transactions.push({
        id: data.trans_id || doc.id,
        trans_id: data.trans_id || doc.id,
        merchant_name: data.merchant_name || '',
        amount: data.amount || 0,
        category: data.category || '',
        date: data.date || '',
        type: data.amount < 0 ? 'income' : 'expense',
        is_deductible: data.is_deductible,
        deductible_reason: data.deductible_reason,
        deduction_score: data.deduction_score,
        ai_analysis: data.ai_analysis,
        user_classification_reason: data.user_classification_reason,
        description: data.description,
        notes: data.notes,
        receipt_url: data.receipt_url,
        receipt_filename: data.receipt_filename,

        // New AI Analysis Fields
        deductionStatus: data.deductionStatus,
        confidence: data.confidence,
        reasoning: data.reasoning,
        irsPublication: data.irsPublication,
        irsSection: data.irsSection,
        analysisUpdatedAt: data.analysisUpdatedAt,

        account_id: data.account_id,
        userId: data.userId || data.user_id,
        created_at: data.created_at,
        updated_at: data.updated_at,
      });
    });
    
    // Sort transactions by date in descending order
    transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    console.log('✅ [Firebase] Successfully processed', transactions.length, 'transactions');
    return { data: transactions, error: null };
  } catch (error: any) {
    console.error('❌ [Firebase] Error getting transactions:', error);
    
    // Handle specific Firebase errors
    if (error.code === 'permission-denied') {
      console.error('❌ [Firebase] Permission denied - check Firestore rules');
      return { data: [], error: { code: 'permission-denied', message: 'Permission denied. Check Firestore security rules.' } };
    } else if (error.code === 'unavailable') {
      console.error('❌ [Firebase] Firebase service unavailable');
      return { data: [], error: { code: 'unavailable', message: 'Database service temporarily unavailable.' } };
    } else if (error.code === 'failed-precondition') {
      console.error('❌ [Firebase] Query failed precondition - likely missing index');
      return { data: [], error: { code: 'failed-precondition', message: 'Database query failed. Missing required index.' } };
    }
    
    return { data: [], error };
  }
}

// Client-side function (for use in components)
export async function updateTransaction(
  transactionId: string,
  updates: {
    is_deductible?: boolean | null;
    deductible_reason?: string;
    deduction_score?: number;
    notes?: string;
    
    // New AI Analysis Fields
    deductionStatus?: 'Likely Deductible' | 'Possibly Deductible' | 'Non-Deductible';
    confidence?: number;
    reasoning?: string;
    irsPublication?: string;
    irsSection?: string;
    analysisUpdatedAt?: string;
  }
): Promise<{ data: any; error: any }> {
  try {
    console.log('🔄 [UPDATE→DB] Updating transaction:', transactionId, updates);
    
    // Filter updates to only allowed client-writable fields per Firestore rules
    const allowedKeys: (keyof typeof updates)[] = [
      'notes',
      // keep only user-controlled fields; AI fields must go through server APIs
    ];
    const filteredUpdates: any = {};
    for (const key of allowedKeys) {
      if (updates[key] !== undefined) filteredUpdates[key] = updates[key];
    }
    if (Object.keys(filteredUpdates).length === 0) {
      console.warn('⚠️ [UPDATE→DB] No allowed fields present in updates; skipping client write');
      return { data: null, error: null };
    }

    // Find the transaction document across all collections
    // Since we don't know which account it belongs to, we'll search in collectionGroup
    const transactionsQuery = query(
      collectionGroup(db, 'transactions'),
      where('trans_id', '==', transactionId),
      limit(1)
    );
    
    const querySnapshot = await getDocs(transactionsQuery);
    
    if (querySnapshot.empty) {
      console.error('❌ [UPDATE→DB] No transaction found with ID:', transactionId);
      return { data: null, error: new Error('Transaction not found') };
    }
    
    const docRef = querySnapshot.docs[0].ref;
    const updateData = {
      ...filteredUpdates,
      updated_at: serverTimestamp(),
    };
    
    await updateDoc(docRef, updateData);
    
    // Read back to verify the update
    const updatedDoc = await getDoc(docRef);
    if (updatedDoc.exists()) {
      const data = updatedDoc.data();
      console.log('✅ [READBACK←DB] Update verified:', {
        trans_id: data?.trans_id,
        is_deductible: data?.is_deductible,
        deductible_reason: data?.deductible_reason,
        deduction_score: data?.deduction_score
      });
      return { data: data, error: null };
    }
    
    return { data: null, error: new Error('Failed to verify update') };
  } catch (error) {
    console.error('❌ [UPDATE→DB] Update failed:', error);
    return { data: null, error };
  }
}

// Client-side function (for use in components)
export async function createTransaction(
  userId: string,
  accountId: string,
  transactionData: Partial<Transaction>
): Promise<{ data: Transaction | null; error: any }> {
  try {
    const transId = transactionData.trans_id || `trans_${Date.now()}`;
    const docRef = doc(db, "user_profiles", userId, "accounts", accountId, "transactions", transId);
    
    const newTransaction = {
      ...transactionData,
      trans_id: transId,
      userId: userId,
      account_id: accountId,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    };
    
    await setDoc(docRef, newTransaction);
    
    // Return the created transaction
    const createdDoc = await getDoc(docRef);
    if (createdDoc.exists()) {
      const data = createdDoc.data() as DocumentData;
              return {
          data: {
            id: data.trans_id || createdDoc.id,
            trans_id: data.trans_id || createdDoc.id,
            merchant_name: data.merchant_name || '',
            amount: data.amount || 0,
            category: data.category || '',
            date: data.date || '',
            type: data.amount < 0 ? 'income' : 'expense',
            is_deductible: data.is_deductible,
            deductible_reason: data.deductible_reason,
            deduction_score: data.deduction_score,
            description: data.description,
            notes: data.notes,

            account_id: data.account_id,
            userId: data.userId || data.user_id,
            created_at: data.created_at,
            updated_at: data.updated_at,
          },
          error: null
        };
    }
    
    return { data: null, error: new Error('Failed to retrieve created transaction') };
  } catch (error) {
    console.error('Error creating transaction:', error);
    return { data: null, error };
  }
}
