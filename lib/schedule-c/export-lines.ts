/** Internal27a stays stable; the published Other expenses line changed in2025. */
export function scheduleCExportLine(internalLine: string, taxYear: number): string {
  return internalLine === '27a' && taxYear >= 2025 ? '27b' : internalLine;
}

/** Printed when Other expenses has no usable charge date. Today's year is never a substitute. */
export const OTHER_EXPENSES_YEAR_FREE_LINE =
  'Schedule C line 27b (other expenses; line 27a on 2024 returns)';

/**
 * Printed Schedule C line. Stored 27a stays the internal Other expenses code.
 * A stored code 27b is the same expense: WriteOff has no Form 7205 category, so it is not the 2024 energy-efficient buildings line.
 * 2025 and later print 27b. 2024 prints 27a.
 * A null year means the charge date is missing or invalid.
 */
export function printedScheduleCLine(internalLine: string | null | undefined, taxYear: number | null): string | null {
  if (internalLine == null) return null;
  if (internalLine === '') return '';
  const code = internalLine === '27b' ? '27a' : internalLine;
  if (code === '27a' && taxYear === null) return OTHER_EXPENSES_YEAR_FREE_LINE;
  return scheduleCExportLine(code, taxYear ?? 2024);
}
