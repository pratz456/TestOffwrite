import { describe, expect, it } from 'vitest';
import { INCOME_RANGES, incomeRangeOptions } from '@/lib/profile/income-ranges';

describe('profile income ranges', () => {
  it('uses neutral planning bands rather than tax-bracket thresholds', () => {
    expect(INCOME_RANGES).toEqual([
      'Under $25,000', '$25,000 - $50,000', '$50,000 - $75,000', '$75,000 - $100,000',
      '$100,000 - $150,000', '$150,000 - $200,000', '$200,000 - $300,000', 'Over $300,000',
    ]);
    expect(INCOME_RANGES.join(' ')).not.toMatch(/11,600|47,150|609,350/);
  });

  it('shows an existing legacy value until the user explicitly replaces it', () => {
    expect(incomeRangeOptions('$47,150 - $100,525')[0]).toEqual({
      value: '$47,150 - $100,525',
      label: '$47,150 - $100,525 (saved legacy range)',
    });
  });
});
