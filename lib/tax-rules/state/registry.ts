import { californiaRules } from './california';
import { FLAT_RATE_STATE_CODES, flatRateRules } from './flat-rate';
import { newYorkRules } from './new-york';
import { NO_INCOME_TAX_STATE_CODES, noIncomeTaxRules } from './no-income-tax';
import { ohioRules } from './ohio';
import { STATE_REGISTRY_TAX_YEARS, type StateRegistryTaxYear, type StateYearRules, type UnsupportedStateYear } from './types';

export const US_STATE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
});

export const US_STATES: readonly { code: string; name: string }[] = Object.freeze(
  Object.entries(US_STATE_NAMES).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name)),
);

const NAME_TO_CODE = new Map(Object.entries(US_STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));

/**
 * Accepts a two-letter code or a full state name (as saved by onboarding) and returns the
 * code, or an empty string when the value is not a U.S. state. Unlike slicing the first two
 * letters, "New York" resolves to NY rather than Nebraska.
 */
export function resolveStateCode(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const upper = trimmed.toUpperCase();
  if (upper.length === 2 && upper in US_STATE_NAMES) return upper;
  return NAME_TO_CODE.get(trimmed.toLowerCase().replace(/\s+/g, ' ')) ?? '';
}

export function stateName(code: string): string {
  return US_STATE_NAMES[code] ?? (code || 'Not set');
}

/** States the module encodes for at least one registry year. */
export const ENCODED_STATE_CODES = Object.freeze(
  [...NO_INCOME_TAX_STATE_CODES, ...FLAT_RATE_STATE_CODES, 'CA', 'NY', 'OH'].sort(),
) as readonly string[];

export function isRegistryTaxYear(taxYear: number): taxYear is StateRegistryTaxYear {
  return (STATE_REGISTRY_TAX_YEARS as readonly number[]).includes(taxYear);
}

/** Registry lookup. Returns the published rule set or an explicit unsupported record; never guesses. */
export function getStateYearRules(stateCode: string, taxYear: number): StateYearRules | UnsupportedStateYear {
  const code = resolveStateCode(stateCode);
  if (!code) {
    const saved = typeof stateCode === 'string' ? stateCode.trim() : '';
    return {
      stateCode: '', taxYear,
      reason: saved
        ? `"${saved}" is not a recognized U.S. state, so no state planning estimate is available; review the state saved in Settings.`
        : 'No state is saved in the profile, so no state planning estimate is available.',
    };
  }
  if (!isRegistryTaxYear(taxYear)) {
    return {
      stateCode: code, taxYear,
      reason: `State income tax parameters are encoded for tax years ${STATE_REGISTRY_TAX_YEARS.join(' and ')} only; ${taxYear} department publications have not been reviewed.`,
    };
  }
  const noTax = noIncomeTaxRules(code, taxYear);
  if (noTax) return noTax;
  const flat = flatRateRules(code, taxYear);
  if (flat) return flat;
  switch (code) {
    case 'CA': return californiaRules(taxYear);
    case 'NY': return newYorkRules(taxYear);
    case 'OH': return ohioRules(taxYear);
    default:
      return {
        stateCode: code, taxYear,
        reason: `${stateName(code)} individual income tax parameters have not been encoded from department of revenue sources; no state planning estimate is available.`,
      };
  }
}

export function isSupportedStateYear(rules: StateYearRules | UnsupportedStateYear): rules is StateYearRules {
  return 'kind' in rules;
}

/** Every state-year pair with published parameters, for registry sanity tests and documentation. */
export function supportedStateYears(): { stateCode: string; taxYear: StateRegistryTaxYear; kind: StateYearRules['kind'] }[] {
  const pairs: { stateCode: string; taxYear: StateRegistryTaxYear; kind: StateYearRules['kind'] }[] = [];
  for (const stateCode of ENCODED_STATE_CODES) {
    for (const taxYear of STATE_REGISTRY_TAX_YEARS) {
      const rules = getStateYearRules(stateCode, taxYear);
      if (isSupportedStateYear(rules)) pairs.push({ stateCode, taxYear, kind: rules.kind });
    }
  }
  return pairs;
}
