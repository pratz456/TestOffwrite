/** Keep post-login navigation inside the app, including for untrusted query strings. */
export function getSafeAuthRedirect(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) {
    return '/protected';
  }
  return value;
}

export function buildTransactionDetailUrl(transaction: any, source = 'unknown') {
  const transactionIdForUrl = transaction?.trans_id || transaction?.id;
  if (!transactionIdForUrl) return null;
  return `/protected?screen=transaction-detail&transactionId=${encodeURIComponent(transactionIdForUrl)}&from=${encodeURIComponent(source)}`;
}
