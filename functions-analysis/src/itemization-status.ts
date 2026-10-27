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
