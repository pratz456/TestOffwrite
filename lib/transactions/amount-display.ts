export const AMOUNT_NEEDED_LABEL = 'Amount needed';

/** A blank saved amount is a prompt. It is never shown as $0.00. */
export function formatListAmount(amount: unknown): string {
  if (amount === null) return AMOUNT_NEEDED_LABEL;
  const value = typeof amount === 'number' ? amount : Number.NaN;
  if (!Number.isFinite(value)) return AMOUNT_NEEDED_LABEL;
  return `$${Math.abs(value).toFixed(2)}`;
}

export function formatSignedListAmount(amount: unknown, received: boolean): string {
  if (amount === null) return AMOUNT_NEEDED_LABEL;
  const value = typeof amount === 'number' ? amount : Number.NaN;
  if (!Number.isFinite(value)) return AMOUNT_NEEDED_LABEL;
  return `${received ? '+' : '-'}$${Math.abs(value).toFixed(2)}`;
}

/** A recorded bank amount is not USD unless the record says so. */
export function formatRecordedTransactionAmount(record: { amount?: unknown; iso_currency_code?: unknown; unofficial_currency_code?: unknown }): string {
  if (record.amount === null) return AMOUNT_NEEDED_LABEL;
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
