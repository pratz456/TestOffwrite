/** Saved deduction choice. Legacy storage used a different spelling for the same choice. */
export type { ItemizationStatus } from '@/functions-analysis/src/itemization-status';
export { normalizeItemizationStatus } from '@/functions-analysis/src/itemization-status';

/** PLACEHOLDER pending approval. */
export const ITEMIZATION_ESTIMATE_WARNING =
  'You chose to itemize. This estimate only counts the charitable gifts you entered in Tax Deductions. Mortgage interest, state and local taxes and medical costs are not in this estimate yet, so it may use the standard deduction and may not match your return.';

/** PLACEHOLDER pending approval. */
export const ITEMIZATION_ESTIMATE_NOTE =
  'Your itemized deductions are not fully counted yet. See the note below.';
