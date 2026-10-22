/** Shown when a saved 1099-MISC blocks the estimate. The review that would place it on Schedule 1 is separate work. */
export const MISC_ESTIMATE_PAUSED_MESSAGE =
  "This 1099-MISC can't be counted automatically yet, so your tax estimate is paused. If this form was misread, remove it or change its type. If the money is real, enter the amount under Other income in your tax organizer before removing it, or your estimate will be too low.";

export function isMiscEstimatePaused(message: unknown): boolean {
  return typeof message === 'string' && message.includes('1099-MISC');
}

/** The pause sentence for a 1099-MISC hold. Other review errors keep their own text. */
export function reviewMessageForUser(code: unknown, message: unknown, fallback: string): string {
  if (code === 'INCOME_RECONCILIATION_REQUIRED' && isMiscEstimatePaused(message)) return MISC_ESTIMATE_PAUSED_MESSAGE;
  return typeof message === 'string' && message.trim() ? message : fallback;
}
