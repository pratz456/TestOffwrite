/**
 * Placeholder awaiting copy approval. Customer-facing wording is not final.
 * An unreadable charge date belongs to no tax year, so every selected year uses this same sentence.
 */
function exportMoney(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError('Export amounts must be finite.');
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function amountCents(amount: unknown): number | null {
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/**
 * Charges out and money in, summed separately in cents.
 * A refund is not netted against a charge and the two totals are not absolute-added.
 */
export function unreadableChargeOutAndIn(rows: readonly { amount?: unknown }[]): { out: number; in: number } {
  let outCents = 0;
  let inCents = 0;
  for (const row of rows) {
    const cents = amountCents(row.amount);
    if (cents === null) continue;
    if (cents < 0) inCents += -cents;
    else outCents += cents;
  }
  return { out: outCents / 100, in: inCents / 100 };
}

export const SCHEDULE_C_UNREADABLE_DATE_NOTICE = (count: number, outAmount: number, inAmount = 0): string => {
  const noun = count === 1 ? 'charge' : 'charges';
  const sentence = `These totals leave out ${count} ${noun} (${exportMoney(outAmount)}) because their dates couldn't be read, so they aren't counted in any year. They're listed under Needs more information below.`;
  return inAmount > 0 ? `${sentence} ${exportMoney(inAmount)} in.` : sentence;
};
