/**
 * Draft, awaiting copy approval.
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

export interface UnreadableChargeTotals {
  out: number;
  in: number;
  outCount: number;
  inCount: number;
}

/**
 * Charges out and credits in, each with its own count and its own cent total.
 * A refund is not called a charge. The two groups are not netted and not added together.
 */
export function unreadableChargeOutAndIn(rows: readonly { amount?: unknown }[]): UnreadableChargeTotals {
  let outCents = 0;
  let inCents = 0;
  let outCount = 0;
  let inCount = 0;
  for (const row of rows) {
    const cents = amountCents(row.amount);
    if (cents === null || cents === 0) continue;
    if (cents < 0) {
      inCents += -cents;
      inCount += 1;
    } else {
      outCents += cents;
      outCount += 1;
    }
  }
  return { out: outCents / 100, in: inCents / 100, outCount, inCount };
}

export const SCHEDULE_C_UNREADABLE_DATE_NOTICE = (totals: UnreadableChargeTotals): string => {
  const { out, in: moneyIn, outCount, inCount } = totals;
  const totalCount = outCount + inCount;
  if (totalCount === 0) return '';
  const singular = totalCount === 1;
  const because = `because ${singular ? 'its' : 'their'} date${singular ? '' : 's'} couldn't be read, so ${singular ? "it isn't" : "they aren't"} counted in any year. ${singular ? "It's" : "They're"} listed under Needs more information below.`;
  if (outCount > 0 && inCount === 0) {
    const noun = outCount === 1 ? 'charge' : 'charges';
    return `These totals leave out ${outCount} ${noun} (${exportMoney(out)}) ${because}`;
  }
  if (inCount > 0 && outCount === 0) {
    const noun = inCount === 1 ? 'refund or other credit' : 'refunds or other credits';
    return `These totals leave out ${inCount} ${noun} (${exportMoney(moneyIn)}) ${because}`;
  }
  const chargeNoun = outCount === 1 ? 'charge' : 'charges';
  const creditNoun = inCount === 1 ? 'refund or other credit' : 'refunds or other credits';
  return `These totals leave out ${outCount} ${chargeNoun} (${exportMoney(out)}) and ${inCount} ${creditNoun} (${exportMoney(moneyIn)}) ${because}`;
};
