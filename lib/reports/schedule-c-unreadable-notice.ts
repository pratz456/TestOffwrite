/**
 * Placeholder awaiting copy approval. Customer-facing wording is not final.
 * An unreadable charge date belongs to no tax year, so every selected year uses this same sentence.
 */
function exportMoney(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('Export amounts must be finite.');
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Sum of absolute amounts for charges whose dates could not be read. */
export function unreadableChargeAbsoluteTotal(rows: readonly { amount?: unknown }[]): number {
  return rows.reduce((sum, row) => {
    const amount = typeof row.amount === 'number' ? row.amount : Number(row.amount);
    return Number.isFinite(amount) ? sum + Math.abs(amount) : sum;
  }, 0);
}

export const SCHEDULE_C_UNREADABLE_DATE_NOTICE = (count: number, absoluteAmount: number): string => {
  const noun = count === 1 ? 'charge' : 'charges';
  return `These totals leave out ${count} ${noun} (${exportMoney(absoluteAmount)}) because their dates couldn't be read, so they aren't assigned to any year. Fix the dates in WriteOff and export again to include them.`;
};
