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
      stateWithheld: amount(entry, 'stateWithheld') ?? 0,
    };
  });
  const sum = (field: 'wages' | 'federalWithheld' | 'socialSecurityWages' | 'stateWithheld') =>
    normalized.reduce((total, entry) => total + entry[field], 0);
  const hasMedicareWages = normalized.every(entry => entry.medicareWages !== undefined);
  return {
    wages: sum('wages'),
    federalWithheld: sum('federalWithheld'),
    socialSecurityWages: sum('socialSecurityWages'),
    // Keep the existing missing-Box-5 warning in the 1040 engine for legacy records.
    medicareWages: hasMedicareWages ? normalized.reduce((total, entry) => total + entry.medicareWages!, 0) : undefined,
    medicareWagesForSE: normalized.reduce((total, entry) => total + (entry.medicareWages ?? entry.wages), 0),
    stateWithheld: sum('stateWithheld'),
  };
}

export type W2FederalWithholdingRead =
  | { status: 'ready'; federalWithheld: number }
  | { status: 'unreadable' };

/**
 * W-2 federal income tax withheld from the same fields `summarizeW2Income` reads
 * (`box2FederalWithheld`, then `federalWithheld`) and the same profile fallback
 * `buildFederalTaxSnapshot` uses when no W-2 rows are saved. A saved W-2 with no
 * numeric Box 2 is unreadable so callers do not substitute zero.
 */
export function readW2FederalWithholding(
  entries: ReadonlyArray<Record<string, unknown>>,
  profile?: Record<string, unknown> | null,
): W2FederalWithholdingRead {
  if (entries.length === 0) {
    const fromProfile = profileFederalWithholding(profile?.w2_federal_withheld);
    return fromProfile === null ? { status: 'unreadable' } : { status: 'ready', federalWithheld: fromProfile };
  }
  let total = 0;
  for (const entry of entries) {
    const withheld = entryFederalWithholding(entry);
    if (withheld === null) return { status: 'unreadable' };
    total += withheld;
  }
  return { status: 'ready', federalWithheld: total };
}

function entryFederalWithholding(entry: Record<string, unknown>): number | null {
  for (const field of ['box2FederalWithheld', 'federalWithheld'] as const) {
    if (!Object.prototype.hasOwnProperty.call(entry, field)) continue;
    const value = entry[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    return value;
  }
  return null;
}

/** Blank profile withholding matches buildFederalTaxSnapshot's amount() helper (blank → 0). A negative or non-numeric value is unreadable. */
function profileFederalWithholding(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}
