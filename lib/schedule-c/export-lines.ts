/** Internal27a stays stable; the published Other expenses line changed in2025. */
export function scheduleCExportLine(internalLine: string, taxYear: number): string {
  return internalLine === '27a' && taxYear >= 2025 ? '27b' : internalLine;
}

export {
  FILED_YEAR_COPY_MARKER,
  NEEDS_MORE_INFORMATION,
  chargeKey,
  comparisonScreenWording,
  currentCalendarYear,
  currentScheduleCRules,
  decideScheduleCExport,
  frozenScheduleCRules,
  loweringRuleSentence,
  registerScheduleCRules,
  scheduleCNow,
  shouldHoldYear,
} from './filed-year';
