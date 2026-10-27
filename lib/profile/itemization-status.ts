/** Saved deduction choice. Legacy storage used a different spelling for the same choice. */

export type ItemizationStatus = 'itemize' | 'standard';

/**
 * Exact matches only.
 * 'itemize' and the legacy spelling return 'itemize'.
 * 'standard' returns 'standard'.
 * Empty, null, other strings, and other types return undefined.
 */
export function normalizeItemizationStatus(value: unknown): ItemizationStatus | undefined {
  if (value === 'itemize' || value === 'itemized') return 'itemize';
  if (value === 'standard') return 'standard';
  return undefined;
}

/** PLACEHOLDER pending approval. */
export const ITEMIZATION_ESTIMATE_WARNING =
  'You chose to itemize. This estimate only counts the charitable gifts you entered in Tax Deductions. Mortgage interest, state and local taxes and medical costs are not in this estimate yet, so it may use the standard deduction and may not match your return.';

/** PLACEHOLDER pending approval. */
export const ITEMIZATION_ESTIMATE_NOTE =
  'Your itemized deductions are not fully counted yet. See the note below.';
