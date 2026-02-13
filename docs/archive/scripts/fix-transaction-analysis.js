#!/usr/bin/env node

/**
 * Fix Transaction Analysis Script
 * 
 * This script fixes existing transactions that have analysis data but it's not displaying
 * properly due to the field mapping bug in the bulk analysis APIs.
 * 
 * The issue: Some transactions were analyzed but the analysis was stored incorrectly
 * due to using `analysis.deductible_reason` instead of `analysis.deduction_reason`.
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, doc, updateDoc } = require('firebase/firestore');

// Firebase config - you'll need to add your config here
const firebaseConfig = {
  // Add your Firebase config here
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

async function fixTransactionAnalysis() {
  console.log('🔧 Starting transaction analysis fix...');
  
  try {
    // Initialize Firebase
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    
    // Get all transactions that have is_deductible = null (needs review)
    // but might have analysis data stored incorrectly
    console.log('📊 Fetching transactions that need analysis fix...');
    
    const transactionsRef = collection(db, 'transactions');
    const q = query(
      transactionsRef,
      where('is_deductible', '==', null)
    );
    
    const snapshot = await getDocs(q);
    const transactions = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      transactions.push({
        id: doc.id,
        ...data
      });
    });
    
    console.log(`📋 Found ${transactions.length} transactions that need review`);
    
    if (transactions.length === 0) {
      console.log('✅ No transactions need fixing. All transactions are properly analyzed or classified.');
      return;
    }
    
    // Check which transactions have analysis data but it's not displaying
    let fixedCount = 0;
    let needsReanalysisCount = 0;
    
    for (const transaction of transactions) {
      console.log(`\n🔍 Checking transaction: ${transaction.merchant_name} (${transaction.id})`);
      
      // Check if transaction has analysis data but it's not showing
      const hasAnalysisData = transaction.deduction_score !== undefined && transaction.deduction_score !== null;
      const hasReason = transaction.deductible_reason && transaction.deductible_reason.trim() !== '';
      
      console.log(`   - Has deduction_score: ${hasAnalysisData} (${transaction.deduction_score})`);
      console.log(`   - Has deductible_reason: ${hasReason} (${transaction.deductible_reason ? 'Yes' : 'No'})`);
      
      if (hasAnalysisData && !hasReason) {
        console.log(`   ⚠️  Transaction has analysis score but no reason - needs re-analysis`);
        needsReanalysisCount++;
        
        // For now, we'll mark it for re-analysis by clearing the analysis data
        // This will cause it to be picked up by the analysis system again
        try {
          const transactionRef = doc(db, 'transactions', transaction.id);
          await updateDoc(transactionRef, {
            deduction_score: null,
            deductible_reason: null,
            analysisStatus: 'pending' // Mark for re-analysis
          });
          
          console.log(`   ✅ Cleared analysis data for re-analysis`);
          fixedCount++;
        } catch (error) {
          console.error(`   ❌ Failed to update transaction ${transaction.id}:`, error);
        }
      } else if (hasAnalysisData && hasReason) {
        console.log(`   ✅ Transaction already has proper analysis data`);
      } else {
        console.log(`   ℹ️  Transaction has no analysis data - will be analyzed normally`);
      }
    }
    
    console.log(`\n📊 Fix Summary:`);
    console.log(`   - Total transactions checked: ${transactions.length}`);
    console.log(`   - Transactions fixed: ${fixedCount}`);
    console.log(`   - Transactions needing re-analysis: ${needsReanalysisCount}`);
    
    if (fixedCount > 0) {
      console.log(`\n🎉 Successfully fixed ${fixedCount} transactions!`);
      console.log(`   These transactions will now be re-analyzed and should display their analysis properly.`);
    } else {
      console.log(`\n✅ No transactions needed fixing. All analysis data is properly stored.`);
    }
    
  } catch (error) {
    console.error('❌ Error fixing transaction analysis:', error);
    process.exit(1);
  }
}

// Alternative approach: Re-analyze all transactions that need review
async function reanalyzeTransactions() {
  console.log('🔄 Starting transaction re-analysis...');
  
  try {
    // This would call the analysis API for all transactions that need review
    // For now, we'll just log what would happen
    
    console.log('📋 This would re-analyze all transactions with is_deductible = null');
    console.log('   You can trigger this by running the analysis from the dashboard');
    console.log('   or by calling the /api/openai/analyze-transactions endpoint');
    
  } catch (error) {
    console.error('❌ Error re-analyzing transactions:', error);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'fix';
  
  if (command === 'reanalyze') {
    await reanalyzeTransactions();
  } else {
    await fixTransactionAnalysis();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { fixTransactionAnalysis, reanalyzeTransactions };
