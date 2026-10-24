/**
 * Which row of an unresolved duplicate pair stays out of tax totals.
 * Provisional: one row. Return 'both' from duplicateHoldOutMember to hold the pair out instead.
 */
export type DuplicateHoldOut = 'incoming' | 'existing' | 'both';

/** Receipt paired with a statement: hold out the statement. Otherwise hold out the later import. */
export function duplicateHoldOutMember(pair: { incomingIsReceipt: boolean; existingIsReceipt: boolean }): DuplicateHoldOut {
  if (pair.incomingIsReceipt !== pair.existingIsReceipt) return pair.incomingIsReceipt ? 'existing' : 'incoming';
  return 'incoming';
}
