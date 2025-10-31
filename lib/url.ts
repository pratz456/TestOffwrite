export function buildTransactionDetailUrl(transaction: any, source = 'unknown') {
  const transactionIdForUrl = transaction?.trans_id || transaction?.id;
  if (!transactionIdForUrl) return null;
  return `/protected?screen=transaction-detail&transactionId=${encodeURIComponent(transactionIdForUrl)}&from=${encodeURIComponent(source)}`;
}
