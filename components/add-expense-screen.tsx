"use client";

import React from 'react';
import { TransactionDetailScreen } from '@/components/transaction-detail-screen';
import { AddManualTransactionScreen } from '@/components/add-manual-transaction-screen';

type DetailProps = React.ComponentProps<typeof TransactionDetailScreen>;
interface EditExpenseScreenProps {
  user: { id: string; email?: string };
  onBack: () => void;
  onSave: DetailProps['onSave'];
  editingExpense?: DetailProps['transaction'] | null;
}

/** Legacy navigation shares the saved-record editor; drafts never call an AI endpoint. */
export function AddExpenseScreen({ user, onBack, onSave, editingExpense }: EditExpenseScreenProps) {
  if (editingExpense?.id || editingExpense?.trans_id) {
    return <TransactionDetailScreen key={editingExpense.trans_id || editingExpense.id} transaction={editingExpense} onBack={onBack} onSave={onSave} />;
  }
  return (
    <div>
      <p className="mx-auto max-w-4xl px-4 pt-3 text-xs text-muted-foreground sm:px-6">Save your expense first. Open it from Transactions to request an AI suggestion when available.</p>
      <AddManualTransactionScreen user={user} onBack={onBack} />
    </div>
  );
}
