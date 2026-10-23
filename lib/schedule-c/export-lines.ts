import { readStoredScheduleCLine } from './other-expenses-line';

/** Published Other expenses line for every tax year this export prints. */
export function scheduleCExportLine(internalLine: string, _taxYear: number): string {
  return readStoredScheduleCLine(internalLine);
}
