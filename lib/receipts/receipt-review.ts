export type ReceiptDraft = { merchant: string; amount: string; date: string; category: string };

export function reviewedReceiptData(draft: ReceiptDraft) {
  const merchant = draft.merchant.trim();
  const amount = Number(draft.amount);
  const category = draft.category.trim() || 'other';
  if (!merchant || merchant.length > 500) throw new Error('Enter a merchant name of 1 to 500 characters.');
  if (!draft.amount.trim() || !Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(Date.parse(draft.date)) || new Date(draft.date).toISOString().slice(0, 10) !== draft.date) {
    throw new Error('Enter a valid receipt date.');
  }
  if (category.length > 200) throw new Error('Keep the category under 200 characters.');
  return { merchant, amount, date: draft.date, category };
}

export function receiptCommitForm(file: File, draft: ReceiptDraft, receiptType: 'expense' | 'income', attachTransactionId?: string | null) {
  const form = new FormData();
  form.append('file', file);
  form.append('mode', 'commit');
  form.append('receiptType', receiptType);
  if (attachTransactionId) form.append('attachTransactionId', attachTransactionId);
  else form.append('receiptData', JSON.stringify(reviewedReceiptData(draft)));
  return form;
}
