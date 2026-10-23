import { readStoredScheduleCLine } from './other-expenses-line';

/**
 * Line printed on a Schedule C export.
 * Stored 27a and 27b both mean other expenses. The printed line follows the tax year.
 * Every other line is unchanged. User amounts never stay on the Form 7205 line.
 */
export function scheduleCExportLine(internalLine: string, taxYear: number): string {
  return readStoredScheduleCLine(internalLine, taxYear);
}
