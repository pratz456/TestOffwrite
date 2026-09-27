export const INCOME_RANGES = [
  'Under $25,000',
  '$25,000 - $50,000',
  '$50,000 - $75,000',
  '$75,000 - $100,000',
  '$100,000 - $150,000',
  '$150,000 - $200,000',
  '$200,000 - $300,000',
  'Over $300,000',
] as const;

export function incomeRangeOptions(savedValue?: string | null) {
  const options = INCOME_RANGES.map(value => ({ value, label: value }));
  const saved = savedValue?.trim();
  if (saved && !INCOME_RANGES.includes(saved as (typeof INCOME_RANGES)[number])) {
    return [{ value: saved, label: `${saved} (saved legacy range)` }, ...options];
  }
  return options;
}
