import { shiftWeekendToBusinessDay } from '@/lib/tax-provider/payment-deadlines';
import { PENALTY_PERIOD_END_DAY, Q4_ALTERNATIVE_RETURN_DAY } from '@/lib/tax-rules/estimated-tax-safe-harbor';

export type PastDueWindow = 'open' | 'w1' | 'w2' | 'w3';

export interface PastDueInstallment {
  n: 1 | 2 | 3 | 4;
  dueDate: string;
  /** Unpaid balance at asOf, in dollars. */
  balance: number;
  /** Unpaid balance on this installment's own due date, in dollars. */
  shortAtDue: number;
  paidLate: boolean;
}

export interface PastDueAllocation {
  amount: number;
  passedDueDates: number;
  /** Strict unpaid balance of the next installment at asOf. */
  nextInstallmentBalance: number;
  /**
   * Amount on the Next payment line. This is the pre-split total minus the
   * past-due amount, so the two lines add up to the figure shown before the
   * split. It matches nextInstallmentBalance when no withholding is dated
   * after asOf.
   */
  nextOnly: number;
  remaining: number;
  nextDueDate: string | null;
  window: PastDueWindow;
  q4AltDate: string;
  lastDue: string;
  penaltyEnd: string;
  installments: PastDueInstallment[];
}

export interface OldestFirstInput {
  dueDates: readonly string[];
  installmentCents: readonly number[];
  /** Estimated payments and withholding shares, applied oldest-first. The recorded quarter is ignored. */
  credits: readonly { date: string; cents: number }[];
  asOf: string;
  /** Pre-split amount still due by the next date, in cents. Null after the last due date. */
  rolledForwardCents: number | null;
}

const pad = (value: number): string => String(value).padStart(2, '0');
const dollars = (cents: number): number => cents / 100;

export function q4AlternativeDueDate(taxYear: number): string {
  const shifted = shiftWeekendToBusinessDay(new Date(Date.UTC(
    taxYear + 1, Q4_ALTERNATIVE_RETURN_DAY.month - 1, Q4_ALTERNATIVE_RETURN_DAY.day, 12,
  )));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function penaltyPeriodEndDate(taxYear: number): string {
  return `${taxYear + 1}-${pad(PENALTY_PERIOD_END_DAY.month)}-${pad(PENALTY_PERIOD_END_DAY.day)}`;
}

export function pastDueWindow(asOf: string, lastDue: string, q4AltDate: string, penaltyEnd: string): PastDueWindow {
  if (asOf <= lastDue) return 'open';
  if (asOf <= q4AltDate) return 'w1';
  if (asOf <= penaltyEnd) return 'w2';
  return 'w3';
}

function balancesAt(date: string, installmentCents: readonly number[], credits: readonly { date: string; cents: number }[]): number[] {
  const remaining = installmentCents.slice();
  const applicable = credits.filter(credit => credit.cents > 0 && credit.date <= date)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const credit of applicable) {
    let left = credit.cents;
    for (let index = 0; index < remaining.length && left > 0; index += 1) {
      const applied = Math.min(remaining[index], left);
      remaining[index] -= applied;
      left -= applied;
    }
  }
  return remaining;
}

/**
 * Credits each payment and withholding share to the oldest installment that still
 * has a balance, ignoring the quarter the payment was stored under.
 */
export function allocateOldestFirst(input: OldestFirstInput): PastDueAllocation {
  const dueDates = input.dueDates.slice(0, 4);
  const lastDue = dueDates[3];
  const taxYear = Number(dueDates[0].slice(0, 4));
  const q4AltDate = q4AlternativeDueDate(taxYear);
  const penaltyEnd = penaltyPeriodEndDate(taxYear);
  const atAsOf = balancesAt(input.asOf, input.installmentCents, input.credits);
  const shortAt = dueDates.map(dueDate => balancesAt(dueDate, input.installmentCents, input.credits));
  const passedCount = dueDates.filter(dueDate => dueDate < input.asOf).length;
  const pastDueCents = atAsOf.slice(0, passedCount).reduce((sum, cents) => sum + cents, 0);
  const nextBalanceCents = passedCount < 4 ? atAsOf[passedCount] : 0;
  const remainingCents = atAsOf.reduce((sum, cents) => sum + cents, 0);
  const nextOnlyCents = input.rolledForwardCents == null ? 0 : Math.max(0, input.rolledForwardCents - pastDueCents);
  return {
    amount: dollars(pastDueCents),
    passedDueDates: passedCount,
    nextInstallmentBalance: dollars(nextBalanceCents),
    nextOnly: dollars(nextOnlyCents),
    remaining: dollars(remainingCents),
    nextDueDate: passedCount < 4 ? dueDates[passedCount] : null,
    window: pastDueWindow(input.asOf, lastDue, q4AltDate, penaltyEnd),
    q4AltDate,
    lastDue,
    penaltyEnd,
    installments: dueDates.map((dueDate, index) => ({
      n: (index + 1) as 1 | 2 | 3 | 4,
      dueDate,
      balance: dollars(atAsOf[index]),
      shortAtDue: dollars(shortAt[index][index]),
      paidLate: dueDate < input.asOf && shortAt[index][index] > 0 && atAsOf[index] === 0,
    })),
  };
}
