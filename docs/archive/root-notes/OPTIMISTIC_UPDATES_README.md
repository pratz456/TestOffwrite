# Optimistic Updates & Realtime Sync Implementation

This document describes the implementation of optimistic updates and realtime sync for transaction edits in the WriteOff app.

## Overview

The implementation provides:
- **Immediate UI updates** when users toggle Business/Personal or change categories
- **Automatic rollback** if Firestore writes fail
- **Realtime synchronization** between list and detail views via Firestore onSnapshot
- **Instant KPI updates** from cached data with server reconciliation
- **Toast notifications** for success/error feedback

## Architecture

### 1. Firebase Hooks (`lib/firebase/hooks.ts`)

#### `useTransactions(uid: string)`
- Provides realtime list of all transactions for a user
- Uses Firestore `onSnapshot` for live updates
- Automatically processes and formats transaction data

#### `useTransaction(id: string, uid: string)`
- Provides realtime single transaction data
- Useful for detail pages that need live updates

#### `useUserStats(uid: string)`
- Calculates realtime statistics from transaction data
- Includes: total transactions, deductible count, needs review count, potential savings

### 2. Mutation Hooks (`lib/firebase/mutations.ts`)

#### `useUpdateTransaction()`
- Handles single transaction updates with optimistic updates
- **onMutate**: Updates React Query cache immediately, cancels outgoing queries
- **onError**: Rolls back all changes from snapshot
- **onSettled**: Invalidates queries to ensure consistency

#### `useBulkUpdateTransactions()`
- Handles bulk updates (e.g., batch categorization)
- Same optimistic update pattern for multiple transactions

### 3. Toast System (`components/ui/toast.tsx`)

- Provides user feedback for all operations
- Auto-dismissing with configurable duration
- Success, error, warning, and info message types
- Global availability through protected layout

## Usage Examples

### Basic Transaction Update

```tsx
import { useUpdateTransaction } from '@/lib/firebase/mutations';
import { useToasts } from '@/components/ui/toast';

function TransactionToggle({ transaction, userId }) {
  const updateTransaction = useUpdateTransaction();
  const { showSuccess, showError } = useToasts();

  const handleToggle = async () => {
    try {
      await updateTransaction.mutateAsync({
        transactionId: transaction.trans_id,
        userId,
        updates: {
          is_deductible: !transaction.is_deductible,
          deductible_reason: 'Toggled by user'
        }
      });
      
      showSuccess('Updated', 'Transaction status changed');
    } catch (error) {
      showError('Update Failed', 'Could not save changes');
    }
  };

  return (
    <button 
      onClick={handleToggle}
      disabled={updateTransaction.isPending}
    >
      {updateTransaction.isPending ? 'Updating...' : 'Toggle'}
    </button>
  );
}
```

### Using Realtime Data

```tsx
import { useTransactions, useUserStats } from '@/lib/firebase/hooks';

function Dashboard({ userId }) {
  const { transactions, isLoading, error } = useTransactions(userId);
  const { stats } = useUserStats(userId);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <h2>Total Transactions: {stats?.totalTransactions}</h2>
      <h3>Deductible: {stats?.deductibleTransactions}</h3>
      <h3>Needs Review: {stats?.needsReviewTransactions}</h3>
      <h3>Potential Savings: ${stats?.potentialSavings?.toFixed(2)}</h3>
      
      {transactions.map(transaction => (
        <div key={transaction.trans_id}>
          {transaction.merchant_name} - {transaction.is_deductible ? 'Business' : 'Personal'}
        </div>
      ))}
    </div>
  );
}
```

## Query Keys

Standardized React Query keys for consistent caching:

```tsx
export const queryKeys = {
  transactions: (uid: string) => ['transactions', uid],
  transaction: (id: string) => ['transaction', id],
  stats: (uid: string) => ['stats', uid],
};
```

## Optimistic Update Flow

1. **User Action**: User clicks toggle button
2. **onMutate**: 
   - Cancel outgoing queries
   - Snapshot current cache state
   - Update cache optimistically
   - Update related stats
3. **Firestore Write**: Attempt to write to database
4. **Success**: Invalidate queries to confirm state
5. **Error**: Rollback from snapshot, show error toast

## Error Handling

- **Network failures**: Automatic rollback with error toast
- **Permission errors**: Clear error messages
- **Validation errors**: Field-specific error handling
- **Firestore errors**: Automatic retry with exponential backoff

## Performance Considerations

- **Debounced updates**: Prevents rapid-fire API calls
- **Selective invalidation**: Only invalidate affected queries
- **Background sync**: Updates happen without blocking UI
- **Cache optimization**: Smart cache invalidation strategies

## Firestore Indexes

The following composite indexes are required for optimal performance:

### Required Indexes

1. **Transactions by User and Date**
   ```json
   {
     "collectionGroup": "transactions",
     "queryScope": "COLLECTION_GROUP",
     "fields": [
       {"fieldPath": "user_id", "order": "ASCENDING"},
       {"fieldPath": "date", "order": "DESCENDING"}
     ]
   }
   ```

2. **Transactions by ID and User**
   ```json
   {
     "collectionGroup": "transactions",
     "queryScope": "COLLECTION_GROUP",
     "fields": [
       {"fieldPath": "trans_id", "order": "ASCENDING"},
       {"fieldPath": "user_id", "order": "ASCENDING"}
     ]
   }
   ```

### Deploying Indexes

```bash
# Deploy all indexes
npx firebase deploy --only firestore:indexes

# Check index status
npx firebase firestore:indexes
```

### Index Creation Time

- **Small datasets**: 1-5 minutes
- **Large datasets**: 5-30 minutes
- **Very large datasets**: 30+ minutes

Indexes are created in the background and don't affect existing queries.

## Testing

### Test Pages

#### `/test-optimistic` - Test Optimistic Updates
1. Toggle transaction deductible status
2. Watch immediate UI updates
3. Observe realtime stats changes
4. Test error scenarios (disconnect network)
5. Verify automatic rollback

#### `/test-indexes` - Test Firestore Indexes
1. Verify transactions queries work
2. Check stats queries functionality
3. Validate data consistency
4. Debug any index-related errors
5. Monitor query performance

## Migration from Old System

The old system used API routes and manual state management. The new system:

- **Replaces**: `makeAuthenticatedRequest` calls
- **Adds**: Real-time updates via Firestore
- **Improves**: User experience with immediate feedback
- **Maintains**: Same data structure and validation

## Troubleshooting

### Common Issues

1. **"Transaction.update() called with invalid data"**
   - Solution: Filter out `undefined` values before sending to Firestore
   - Check: Update payload for undefined fields

2. **Toast not showing**
   - Solution: Ensure `ToastContainer` is in the component tree
   - Check: Protected layout includes toast container

3. **Stats not updating**
   - Solution: Verify `useUserStats` hook is being used
   - Check: User ID is being passed correctly

4. **Optimistic updates not working**
   - Solution: Ensure React Query provider is configured
   - Check: Query keys match between hooks and mutations

5. **"The query requires an index" error**
   - Solution: Deploy required Firestore indexes
   - Run: `npx firebase deploy --only firestore:indexes`
   - Check: `firestore.indexes.json` contains required indexes
   - Test: Visit `/test-indexes` to verify indexes are working

### Debug Mode

Enable debug logging by checking browser console for:
- `📊 [Dashboard] Transaction Counts`
- `🔄 [UPDATE→DB] Updating transaction`
- `✅ [READBACK←DB] Update verified`

## Future Enhancements

- **Offline support**: Queue updates when offline
- **Conflict resolution**: Handle concurrent edits
- **Batch operations**: Optimize multiple updates
- **Real-time collaboration**: Multi-user editing
- **Advanced caching**: Intelligent cache strategies
