/** Normalize the manual W-2 API and imported W-2 document contracts in one place. */
export function summarizeW2Income(entries: ReadonlyArray<Record<string, unknown>>) {
  const amount = (entry: Record<string, unknown>, ...fields: string[]): number | undefined => {
    for (const field of fields) {
      const value = entry[field];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new RangeError(`Invalid W-2 amount: ${field}`);
      }
      return value;
    }
    return undefined;
  };

  const normalized = entries.map(entry => {
    const wages = amount(entry, 'box1Wages', 'wages') ?? 0;
    return {
      wages,
      federalWithheld: amount(entry, 'box2FederalWithheld', 'federalWithheld') ?? 0,
      // Preserve explicit zero (for example, wages exempt from Social Security). Schedule SE
      // line 8a is the total of boxes 3 and 7, so reported tips count toward the wage base when a record carries them.
      socialSecurityWages: (amount(entry, 'box3SocialSecurityWages', 'socialSecurityWages') ?? wages) + (amount(entry, 'box7SocialSecurityTips', 'socialSecurityTips') ?? 0),
      medicareWages: amount(entry, 'box5MedicareWages', 'medicareWages'),
      // Box 6 is Form 8959 line 19. A missing amount is zero withholding, not a review stop.
      medicareWithheld: amount(entry, 'box6MedicareWithheld', 'medicareWithheld') ?? 0,
      stateWithheld: amount(entry, 'stateWithheld') ?? 0,
    };
  });
  const sum = (field: 'wages' | 'federalWithheld' | 'socialSecurityWages' | 'medicareWithheld' | 'stateWithheld') =>
    normalized.reduce((total, entry) => total + entry[field], 0);
  const hasMedicareWages = normalized.every(entry => entry.medicareWages !== undefined);
  return {
    wages: sum('wages'),
    federalWithheld: sum('federalWithheld'),
    socialSecurityWages: sum('socialSecurityWages'),
    // Keep the existing missing-Box-5 warning in the 1040 engine for legacy records.
    medicareWages: hasMedicareWages ? normalized.reduce((total, entry) => total + entry.medicareWages!, 0) : undefined,
    medicareWagesForSE: normalized.reduce((total, entry) => total + (entry.medicareWages ?? entry.wages), 0),
    medicareWithheld: sum('medicareWithheld'),
    stateWithheld: sum('stateWithheld'),
  };
}
