/**
 * Integration test to verify transaction updates persist correctly
 * Run with: npm test tests/transaction-update.test.ts
 */

import { updateTransaction, getTransaction } from '@/lib/database/transactions';

describe('Transaction Update Integration', () => {
  // This test requires a real transaction ID from your database
  const TEST_TRANSACTION_ID = 'test-transaction-id'; // Replace with actual ID
  
  test('should persist is_deductible changes to database', async () => {
    // Skip if no test transaction ID provided
    if (TEST_TRANSACTION_ID === 'test-transaction-id') {
      console.log('⚠️  Skipping test - no real transaction ID provided');
      return;
    }

    console.log('🧪 Testing transaction update persistence...');
    
    // 1. Update transaction to deductible
    const updateData = {
      is_deductible: true,
      deductible_reason: 'Test: Classified as business expense',
      deduction_score: 1.0
    };
    
    console.log('📝 Updating transaction to deductible...');
    const updateResult = await updateTransaction(TEST_TRANSACTION_ID, updateData);
    
    expect(updateResult.error).toBeNull();
    expect(updateResult.data).toBeTruthy();
    
    // 2. Read back and verify
    console.log('📖 Reading back transaction...');
    const readResult = await getTransaction(TEST_TRANSACTION_ID);
    
    expect(readResult.error).toBeNull();
    expect(readResult.data.is_deductible).toBe(true);
    expect(readResult.data.deductible_reason).toBe('Test: Classified as business expense');
    expect(readResult.data.deduction_score).toBe(1.0);
    
    // 3. Update transaction to personal
    console.log('📝 Updating transaction to personal...');
    const updateData2 = {
      is_deductible: false,
      deductible_reason: 'Test: Classified as personal expense',
      deduction_score: 0.0
    };
    
    const updateResult2 = await updateTransaction(TEST_TRANSACTION_ID, updateData2);
    expect(updateResult2.error).toBeNull();
    
    // 4. Read back and verify again
    console.log('📖 Reading back transaction again...');
    const readResult2 = await getTransaction(TEST_TRANSACTION_ID);
    
    expect(readResult2.error).toBeNull();
    expect(readResult2.data.is_deductible).toBe(false);
    expect(readResult2.data.deductible_reason).toBe('Test: Classified as personal expense');
    expect(readResult2.data.deduction_score).toBe(0.0);
    
    console.log('✅ Transaction update persistence test passed!');
  });
  
  test('should handle null is_deductible values correctly', async () => {
    // Skip if no test transaction ID provided
    if (TEST_TRANSACTION_ID === 'test-transaction-id') {
      console.log('⚠️  Skipping test - no real transaction ID provided');
      return;
    }

    console.log('🧪 Testing null is_deductible handling...');
    
    // Set transaction to null (needs review state)
    const updateData = {
      is_deductible: null,
      deductible_reason: null,
      deduction_score: 0.5 // Indicates needs review
    };
    
    const updateResult = await updateTransaction(TEST_TRANSACTION_ID, updateData);
    expect(updateResult.error).toBeNull();
    
    const readResult = await getTransaction(TEST_TRANSACTION_ID);
    expect(readResult.error).toBeNull();
    expect(readResult.data.is_deductible).toBeNull();
    
    console.log('✅ Null handling test passed!');
  });
});
