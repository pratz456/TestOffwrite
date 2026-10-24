/**
 * Which row of an unresolved duplicate pair stays out of tax totals.
 * The earliest imported row counts. The later row is held out.
 * A statement row has no separate rule: a receipt imported first still counts, and a statement imported first still counts.
 * Return 'existing' or 'both' from duplicateHoldOutMember to change that choice in one place.
 */
export type DuplicateHoldOut = 'incoming' | 'existing' | 'both';

export function duplicateHoldOutMember(_pair: { incomingIsReceipt: boolean; existingIsReceipt: boolean }): DuplicateHoldOut {
  return 'incoming';
}

export type DuplicateResolution = 'both_real' | 'duplicate';

/** Unresolved flags and rows marked duplicate stay out of tax totals. A cleared flag with both_real counts. */
export function isExcludedFromTaxTotals(record: { possibleDuplicate?: unknown; duplicateResolution?: unknown } | null | undefined): boolean {
  return record?.possibleDuplicate === true || record?.duplicateResolution === 'duplicate';
}

/** Clears the unresolved flag. Duplicate keeps the later row saved and marked. Nothing is deleted. */
export function duplicateResolutionUpdate(outcome: DuplicateResolution): {
  possibleDuplicate: false;
  possibleDuplicateReason: null;
  duplicateResolution: DuplicateResolution;
} {
  if (outcome !== 'both_real' && outcome !== 'duplicate') throw new Error('PLACEHOLDER: Choose both real or duplicate.');
  return { possibleDuplicate: false, possibleDuplicateReason: null, duplicateResolution: outcome };
}
