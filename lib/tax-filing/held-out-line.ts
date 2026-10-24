import { readOwnedTransactions } from '@/lib/reports/export-records';
import { summarizeHeldOutDuplicates, type HeldOutDuplicates } from '@/lib/transactions/held-out-duplicates';

/** Year-scoped held-out line for a filing session. Flagged rows are not sent to the provider. */
export async function filingHeldOutDuplicates(uid: string, taxYear: number): Promise<HeldOutDuplicates> {
  return summarizeHeldOutDuplicates(await readOwnedTransactions(uid), taxYear);
}
