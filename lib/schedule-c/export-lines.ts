/** Internal27a stays stable; the published Other expenses line changed in2025. */
export function scheduleCExportLine(internalLine: string, taxYear: number): string {
  return internalLine === '27a' && taxYear >= 2025 ? '27b' : internalLine;
}
