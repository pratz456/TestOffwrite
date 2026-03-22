/**
 * State Income Tax Calculator — Top 10 US States
 * Covers ~55% of US population. Other states return null.
 */

interface StateTaxResult {
  stateTax: number;
  effectiveRate: number;
  stateCode: string;
  stateName: string;
  isSupported: boolean;
  note?: string;
}

type FilingStatus = 'single' | 'married_filing_jointly' | 'married_filing_separately' | 'head_of_household';

// No income tax states
const NO_TAX_STATES = ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY'];

// State names
const STATE_NAMES: Record<string, string> = {
  CA: 'California', NY: 'New York', TX: 'Texas', FL: 'Florida',
  IL: 'Illinois', NJ: 'New Jersey', PA: 'Pennsylvania', OH: 'Ohio',
  GA: 'Georgia', NC: 'North Carolina',
};

// California 2025 brackets (FTB 2025 Tax Rate Schedules)
function calcCA(taxableIncome: number, fs: FilingStatus): number {
  const brackets = fs === 'married_filing_jointly' ? [
    { min: 0, rate: 0.01 }, { min: 22158, rate: 0.02 }, { min: 52530, rate: 0.04 },
    { min: 82898, rate: 0.06 }, { min: 115066, rate: 0.08 }, { min: 145236, rate: 0.093 },
    { min: 750442, rate: 0.103 }, { min: 900532, rate: 0.113 }, { min: 1000000, rate: 0.123 },
    { min: 1500620, rate: 0.133 },
  ] : [
    { min: 0, rate: 0.01 }, { min: 11079, rate: 0.02 }, { min: 26264, rate: 0.04 },
    { min: 41449, rate: 0.06 }, { min: 57533, rate: 0.08 }, { min: 72618, rate: 0.093 },
    { min: 375221, rate: 0.103 }, { min: 450266, rate: 0.113 }, { min: 1000000, rate: 0.123 },
    { min: 1000000, rate: 0.133 },
  ];
  return calcProgressive(taxableIncome, brackets);
}

// New York 2025 brackets
function calcNY(taxableIncome: number, fs: FilingStatus): number {
  const brackets = fs === 'married_filing_jointly' ? [
    { min: 0, rate: 0.04 }, { min: 17150, rate: 0.045 }, { min: 23600, rate: 0.0525 },
    { min: 27900, rate: 0.0585 }, { min: 161550, rate: 0.0625 }, { min: 323200, rate: 0.0685 },
    { min: 2155350, rate: 0.0965 }, { min: 5000000, rate: 0.103 }, { min: 25000000, rate: 0.109 },
  ] : [
    { min: 0, rate: 0.04 }, { min: 8500, rate: 0.045 }, { min: 11700, rate: 0.0525 },
    { min: 13900, rate: 0.0585 }, { min: 80650, rate: 0.0625 }, { min: 215400, rate: 0.0685 },
    { min: 1077550, rate: 0.0965 }, { min: 5000000, rate: 0.103 }, { min: 25000000, rate: 0.109 },
  ];
  return calcProgressive(taxableIncome, brackets);
}

// Illinois — flat 4.95%
function calcIL(taxableIncome: number): number {
  return taxableIncome * 0.0495;
}

// New Jersey 2025 brackets
function calcNJ(taxableIncome: number, fs: FilingStatus): number {
  const brackets = [
    { min: 0, rate: 0.014 }, { min: 20000, rate: 0.0175 }, { min: 35000, rate: 0.035 },
    { min: 40000, rate: 0.05525 }, { min: 75000, rate: 0.0637 }, { min: 500000, rate: 0.0897 },
    { min: 1000000, rate: 0.1075 },
  ];
  return calcProgressive(taxableIncome, brackets);
}

// Pennsylvania — flat 3.07%
function calcPA(taxableIncome: number): number {
  return taxableIncome * 0.0307;
}

// Ohio 2025 brackets (HB 33 rate reduction: 0% under $26,050, 2.75% to $100K, 3.125% above)
function calcOH(taxableIncome: number): number {
  if (taxableIncome <= 26050) return 0;
  let tax = 0;
  const tier1 = Math.min(taxableIncome, 100000) - 26050;
  if (tier1 > 0) tax += tier1 * 0.0275;
  const tier2 = taxableIncome - 100000;
  if (tier2 > 0) tax += tier2 * 0.03125;
  return tax;
}

// Georgia — flat 5.19% (2025, phasing down to 4.99%)
function calcGA(taxableIncome: number): number {
  return taxableIncome * 0.0519;
}

// North Carolina — flat 4.25% (2025, reduced from 4.5%)
function calcNC(taxableIncome: number): number {
  return taxableIncome * 0.0425;
}

// Helper: progressive bracket calculation
function calcProgressive(income: number, brackets: { min: number; rate: number }[]): number {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const lower = brackets[i].min;
    const upper = i + 1 < brackets.length ? brackets[i + 1].min : Infinity;
    const taxableInBracket = Math.min(income, upper) - lower;
    if (taxableInBracket <= 0) break;
    tax += taxableInBracket * brackets[i].rate;
  }
  return Math.max(0, tax);
}

export function calculateStateTax(
  stateCode: string,
  federalAGI: number,
  filingStatus: FilingStatus
): StateTaxResult {
  const code = stateCode?.toUpperCase()?.trim();
  const stateName = STATE_NAMES[code] || code || 'Unknown';

  if (!code) {
    return { stateTax: 0, effectiveRate: 0, stateCode: '', stateName: 'Not set', isSupported: false, note: 'Set your state in Settings to see state tax estimate.' };
  }

  if (NO_TAX_STATES.includes(code)) {
    return { stateTax: 0, effectiveRate: 0, stateCode: code, stateName, isSupported: true, note: `${stateName} has no state income tax.` };
  }

  // Use federal AGI as approximation for state taxable income
  // (Most states start from federal AGI with state-specific adjustments)
  const taxableIncome = Math.max(0, federalAGI);
  let stateTax = 0;

  switch (code) {
    case 'CA': stateTax = calcCA(taxableIncome, filingStatus); break;
    case 'NY': stateTax = calcNY(taxableIncome, filingStatus); break;
    case 'IL': stateTax = calcIL(taxableIncome); break;
    case 'NJ': stateTax = calcNJ(taxableIncome, filingStatus); break;
    case 'PA': stateTax = calcPA(taxableIncome); break;
    case 'OH': stateTax = calcOH(taxableIncome); break;
    case 'GA': stateTax = calcGA(taxableIncome); break;
    case 'NC': stateTax = calcNC(taxableIncome); break;
    default:
      return { stateTax: 0, effectiveRate: 0, stateCode: code, stateName, isSupported: false, note: `State tax calculation for ${stateName} is coming soon.` };
  }

  const effectiveRate = taxableIncome > 0 ? (stateTax / taxableIncome) * 100 : 0;
  return { stateTax: Math.round(stateTax * 100) / 100, effectiveRate: Math.round(effectiveRate * 10) / 10, stateCode: code, stateName, isSupported: true };
}
