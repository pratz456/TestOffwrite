/**
 * Server clock for disclosure consent. Production uses the real clock.
 * Tests replace it. The public filing consent API does not accept a time.
 */
let clock: () => Date = () => new Date();

export function filingConsentNow(): Date {
  const now = clock();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('The filing consent clock returned an unusable time.');
  }
  return now;
}

export function setFilingConsentClock(next: () => Date): void {
  clock = next;
}

export function resetFilingConsentClock(): void {
  clock = () => new Date();
}
