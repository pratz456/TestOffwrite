/** A recorded bank amount is not USD unless the record says so. */
export function formatRecordedTransactionAmount(record: { amount?: unknown; iso_currency_code?: unknown; unofficial_currency_code?: unknown }): string {
  if (typeof record.amount !== 'number' || !Number.isFinite(record.amount) || !Number.isSafeInteger(Math.round(record.amount * 100))) return 'Amount needs review';
  const amount = Math.abs(record.amount);
  const currency = typeof record.iso_currency_code === 'string' ? record.iso_currency_code.trim().toUpperCase() : '';
  if (!record.unofficial_currency_code && /^[A-Z]{3}$/.test(currency)) {
    return amount.toLocaleString('en-US', { style: 'currency', currency, currencyDisplay: currency === 'USD' ? 'symbol' : 'code', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const label = typeof record.unofficial_currency_code === 'string' && record.unofficial_currency_code.trim()
    ? record.unofficial_currency_code.trim() : 'currency unknown';
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${label})`;
}
