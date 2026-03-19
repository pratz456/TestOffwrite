/**
 * State income tax data for 2024
 * Used by the State Tax Calculator
 */

export type FilingStatus =
  | "single"
  | "married_filing_jointly"
  | "married_filing_separately"
  | "head_of_household";

export interface TaxBracket {
  min: number;
  max: number;
  rate: number;
}

export interface StateTaxConfig {
  code: string;
  name: string;
  type: "no_tax" | "flat" | "progressive";
  flatRate?: number;
  /** NH and TN only tax interest/dividends */
  limitedTax?: "interest_dividends";
  brackets?: Record<FilingStatus, TaxBracket[]>;
}

export const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

const single = "single" as const;
const mfj = "married_filing_jointly" as const;
const mfs = "married_filing_separately" as const;
const hoh = "head_of_household" as const;

/** California 2024 brackets - 10 brackets 1% to 13.3% */
const CA_BRACKETS = {
  [single]: [
    { min: 0, max: 10412, rate: 0.01 },
    { min: 10412, max: 24684, rate: 0.02 },
    { min: 24684, max: 38959, rate: 0.04 },
    { min: 38959, max: 54081, rate: 0.06 },
    { min: 54081, max: 68350, rate: 0.08 },
    { min: 68350, max: 349137, rate: 0.093 },
    { min: 349137, max: 418961, rate: 0.103 },
    { min: 418961, max: 698271, rate: 0.113 },
    { min: 698271, max: 1000000, rate: 0.123 },
    { min: 1000000, max: Infinity, rate: 0.133 },
  ],
  [mfj]: [
    { min: 0, max: 20824, rate: 0.01 },
    { min: 20824, max: 49368, rate: 0.02 },
    { min: 49368, max: 77918, rate: 0.04 },
    { min: 77918, max: 108162, rate: 0.06 },
    { min: 108162, max: 136700, rate: 0.08 },
    { min: 136700, max: 698274, rate: 0.093 },
    { min: 698274, max: 837922, rate: 0.103 },
    { min: 837922, max: 1396542, rate: 0.113 },
    { min: 1396542, max: Infinity, rate: 0.133 },
  ],
  [mfs]: [
    { min: 0, max: 10412, rate: 0.01 },
    { min: 10412, max: 24684, rate: 0.02 },
    { min: 24684, max: 38959, rate: 0.04 },
    { min: 38959, max: 54081, rate: 0.06 },
    { min: 54081, max: 68350, rate: 0.08 },
    { min: 68350, max: 349137, rate: 0.093 },
    { min: 349137, max: 418961, rate: 0.103 },
    { min: 418961, max: 698271, rate: 0.113 },
    { min: 698271, max: 1000000, rate: 0.123 },
    { min: 1000000, max: Infinity, rate: 0.133 },
  ],
  [hoh]: [
    { min: 0, max: 10412, rate: 0.01 },
    { min: 10412, max: 24684, rate: 0.02 },
    { min: 24684, max: 38959, rate: 0.04 },
    { min: 38959, max: 54081, rate: 0.06 },
    { min: 54081, max: 68350, rate: 0.08 },
    { min: 68350, max: 349137, rate: 0.093 },
    { min: 349137, max: 418961, rate: 0.103 },
    { min: 418961, max: 698271, rate: 0.113 },
    { min: 698271, max: 1000000, rate: 0.123 },
    { min: 1000000, max: Infinity, rate: 0.133 },
  ],
};

/** New York 2024 brackets - 4% to 10.9% */
const NY_BRACKETS = {
  [single]: [
    { min: 0, max: 8500, rate: 0.04 },
    { min: 8500, max: 11700, rate: 0.045 },
    { min: 11700, max: 13900, rate: 0.0525 },
    { min: 13900, max: 80650, rate: 0.055 },
    { min: 80650, max: 215400, rate: 0.06 },
    { min: 215400, max: 1077550, rate: 0.0685 },
    { min: 1077550, max: 5000000, rate: 0.0965 },
    { min: 5000000, max: 25000000, rate: 0.103 },
    { min: 25000000, max: Infinity, rate: 0.109 },
  ],
  [mfj]: [
    { min: 0, max: 17150, rate: 0.04 },
    { min: 17150, max: 23600, rate: 0.045 },
    { min: 23600, max: 27900, rate: 0.0525 },
    { min: 27900, max: 161550, rate: 0.055 },
    { min: 161550, max: 323200, rate: 0.06 },
    { min: 323200, max: 2155350, rate: 0.0685 },
    { min: 2155350, max: 5000000, rate: 0.0965 },
    { min: 5000000, max: 25000000, rate: 0.103 },
    { min: 25000000, max: Infinity, rate: 0.109 },
  ],
  [mfs]: [
    { min: 0, max: 12800, rate: 0.04 },
    { min: 12800, max: 17650, rate: 0.045 },
    { min: 17650, max: 20900, rate: 0.0525 },
    { min: 20900, max: 107650, rate: 0.055 },
    { min: 107650, max: 269300, rate: 0.06 },
    { min: 269300, max: 1616450, rate: 0.0685 },
    { min: 1616450, max: 5000000, rate: 0.0965 },
    { min: 5000000, max: 25000000, rate: 0.103 },
    { min: 25000000, max: Infinity, rate: 0.109 },
  ],
  [hoh]: [
    { min: 0, max: 8500, rate: 0.04 },
    { min: 8500, max: 11700, rate: 0.045 },
    { min: 11700, max: 13900, rate: 0.0525 },
    { min: 13900, max: 80650, rate: 0.055 },
    { min: 80650, max: 215400, rate: 0.06 },
    { min: 215400, max: 1077550, rate: 0.0685 },
    { min: 1077550, max: 5000000, rate: 0.0965 },
    { min: 5000000, max: 25000000, rate: 0.103 },
    { min: 25000000, max: Infinity, rate: 0.109 },
  ],
};

/** New Jersey 2024 - 1.4% to 10.75% */
const NJ_BRACKETS = {
  [single]: [
    { min: 0, max: 20000, rate: 0.014 },
    { min: 20000, max: 35000, rate: 0.0175 },
    { min: 35000, max: 40000, rate: 0.035 },
    { min: 40000, max: 75000, rate: 0.05525 },
    { min: 75000, max: 500000, rate: 0.0637 },
    { min: 500000, max: 1000000, rate: 0.0897 },
    { min: 1000000, max: Infinity, rate: 0.1075 },
  ],
  [mfj]: [
    { min: 0, max: 20000, rate: 0.014 },
    { min: 20000, max: 50000, rate: 0.0175 },
    { min: 50000, max: 70000, rate: 0.0245 },
    { min: 70000, max: 80000, rate: 0.035 },
    { min: 80000, max: 150000, rate: 0.05525 },
    { min: 150000, max: 500000, rate: 0.0637 },
    { min: 500000, max: 1000000, rate: 0.0897 },
    { min: 1000000, max: Infinity, rate: 0.1075 },
  ],
  [mfs]: [
    { min: 0, max: 20000, rate: 0.014 },
    { min: 20000, max: 35000, rate: 0.0175 },
    { min: 35000, max: 40000, rate: 0.035 },
    { min: 40000, max: 75000, rate: 0.05525 },
    { min: 75000, max: 500000, rate: 0.0637 },
    { min: 500000, max: 1000000, rate: 0.0897 },
    { min: 1000000, max: Infinity, rate: 0.1075 },
  ],
  [hoh]: [
    { min: 0, max: 20000, rate: 0.014 },
    { min: 20000, max: 35000, rate: 0.0175 },
    { min: 35000, max: 40000, rate: 0.035 },
    { min: 40000, max: 75000, rate: 0.05525 },
    { min: 75000, max: 500000, rate: 0.0637 },
    { min: 500000, max: 1000000, rate: 0.0897 },
    { min: 1000000, max: Infinity, rate: 0.1075 },
  ],
};

/** Georgia 2024 - 1% to 5.49% */
const GA_BRACKETS = {
  [single]: [
    { min: 0, max: 750, rate: 0.01 },
    { min: 750, max: 2250, rate: 0.02 },
    { min: 2250, max: 3750, rate: 0.03 },
    { min: 3750, max: 5250, rate: 0.04 },
    { min: 5250, max: 7000, rate: 0.05 },
    { min: 7000, max: Infinity, rate: 0.0549 },
  ],
  [mfj]: [
    { min: 0, max: 1000, rate: 0.01 },
    { min: 1000, max: 3000, rate: 0.02 },
    { min: 3000, max: 5000, rate: 0.03 },
    { min: 5000, max: 7000, rate: 0.04 },
    { min: 7000, max: 10000, rate: 0.05 },
    { min: 10000, max: Infinity, rate: 0.0549 },
  ],
  [mfs]: [
    { min: 0, max: 500, rate: 0.01 },
    { min: 500, max: 1500, rate: 0.02 },
    { min: 1500, max: 2500, rate: 0.03 },
    { min: 2500, max: 3500, rate: 0.04 },
    { min: 3500, max: 5000, rate: 0.05 },
    { min: 5000, max: Infinity, rate: 0.0549 },
  ],
  [hoh]: [
    { min: 0, max: 1000, rate: 0.01 },
    { min: 1000, max: 3000, rate: 0.02 },
    { min: 3000, max: 5000, rate: 0.03 },
    { min: 5000, max: 7000, rate: 0.04 },
    { min: 7000, max: 10000, rate: 0.05 },
    { min: 10000, max: Infinity, rate: 0.0549 },
  ],
};

/** Oregon 2024 - 4.75% to 9.9% */
const OR_BRACKETS = {
  [single]: [
    { min: 0, max: 4050, rate: 0.0475 },
    { min: 4050, max: 10200, rate: 0.0675 },
    { min: 10200, max: 125000, rate: 0.0875 },
    { min: 125000, max: Infinity, rate: 0.099 },
  ],
  [mfj]: [
    { min: 0, max: 8100, rate: 0.0475 },
    { min: 8100, max: 20400, rate: 0.0675 },
    { min: 20400, max: 250000, rate: 0.0875 },
    { min: 250000, max: Infinity, rate: 0.099 },
  ],
  [mfs]: [
    { min: 0, max: 4050, rate: 0.0475 },
    { min: 4050, max: 10200, rate: 0.0675 },
    { min: 10200, max: 125000, rate: 0.0875 },
    { min: 125000, max: Infinity, rate: 0.099 },
  ],
  [hoh]: [
    { min: 0, max: 8100, rate: 0.0475 },
    { min: 8100, max: 20400, rate: 0.0675 },
    { min: 20400, max: 250000, rate: 0.0875 },
    { min: 250000, max: Infinity, rate: 0.099 },
  ],
};

/** Minnesota 2024 - 5.35% to 9.85% */
const MN_BRACKETS = {
  [single]: [
    { min: 0, max: 31580, rate: 0.0535 },
    { min: 31580, max: 103960, rate: 0.068 },
    { min: 103960, max: Infinity, rate: 0.0985 },
  ],
  [mfj]: [
    { min: 0, max: 46230, rate: 0.0535 },
    { min: 46230, max: 184020, rate: 0.068 },
    { min: 184020, max: Infinity, rate: 0.0985 },
  ],
  [mfs]: [
    { min: 0, max: 31580, rate: 0.0535 },
    { min: 31580, max: 103960, rate: 0.068 },
    { min: 103960, max: Infinity, rate: 0.0985 },
  ],
  [hoh]: [
    { min: 0, max: 31580, rate: 0.0535 },
    { min: 31580, max: 103960, rate: 0.068 },
    { min: 103960, max: Infinity, rate: 0.0985 },
  ],
};

/** Simplified 3-bracket for other progressive states */
function simpleBrackets(
  lowRate: number,
  midRate: number,
  topRate: number,
  singleThreshold = 50000,
  mfjThreshold = 100000
): Record<FilingStatus, TaxBracket[]> {
  return {
    [single]: [
      { min: 0, max: singleThreshold, rate: lowRate },
      { min: singleThreshold, max: singleThreshold * 2, rate: midRate },
      { min: singleThreshold * 2, max: Infinity, rate: topRate },
    ],
    [mfj]: [
      { min: 0, max: mfjThreshold, rate: lowRate },
      { min: mfjThreshold, max: mfjThreshold * 2, rate: midRate },
      { min: mfjThreshold * 2, max: Infinity, rate: topRate },
    ],
    [mfs]: [
      { min: 0, max: singleThreshold, rate: lowRate },
      { min: singleThreshold, max: singleThreshold * 2, rate: midRate },
      { min: singleThreshold * 2, max: Infinity, rate: topRate },
    ],
    [hoh]: [
      { min: 0, max: singleThreshold * 1.2, rate: lowRate },
      { min: singleThreshold * 1.2, max: singleThreshold * 2.4, rate: midRate },
      { min: singleThreshold * 2.4, max: Infinity, rate: topRate },
    ],
  };
}

export const STATE_TAX_CONFIG: Record<string, StateTaxConfig> = {
  AK: { code: "AK", name: "Alaska", type: "no_tax" },
  FL: { code: "FL", name: "Florida", type: "no_tax" },
  NV: { code: "NV", name: "Nevada", type: "no_tax" },
  NH: {
    code: "NH",
    name: "New Hampshire",
    type: "no_tax",
    limitedTax: "interest_dividends",
  },
  SD: { code: "SD", name: "South Dakota", type: "no_tax" },
  TN: {
    code: "TN",
    name: "Tennessee",
    type: "no_tax",
    limitedTax: "interest_dividends",
  },
  TX: { code: "TX", name: "Texas", type: "no_tax" },
  WA: { code: "WA", name: "Washington", type: "no_tax" },
  WY: { code: "WY", name: "Wyoming", type: "no_tax" },

  CO: { code: "CO", name: "Colorado", type: "flat", flatRate: 0.044 },
  IL: { code: "IL", name: "Illinois", type: "flat", flatRate: 0.0495 },
  IN: { code: "IN", name: "Indiana", type: "flat", flatRate: 0.0305 },
  KY: { code: "KY", name: "Kentucky", type: "flat", flatRate: 0.04 },
  MA: { code: "MA", name: "Massachusetts", type: "flat", flatRate: 0.05 },
  MI: { code: "MI", name: "Michigan", type: "flat", flatRate: 0.0405 },
  NC: { code: "NC", name: "North Carolina", type: "flat", flatRate: 0.045 },
  PA: { code: "PA", name: "Pennsylvania", type: "flat", flatRate: 0.0307 },
  UT: { code: "UT", name: "Utah", type: "flat", flatRate: 0.0465 },

  CA: { code: "CA", name: "California", type: "progressive", brackets: CA_BRACKETS },
  NY: { code: "NY", name: "New York", type: "progressive", brackets: NY_BRACKETS },
  NJ: { code: "NJ", name: "New Jersey", type: "progressive", brackets: NJ_BRACKETS },
  GA: { code: "GA", name: "Georgia", type: "progressive", brackets: GA_BRACKETS },
  OR: { code: "OR", name: "Oregon", type: "progressive", brackets: OR_BRACKETS },
  MN: { code: "MN", name: "Minnesota", type: "progressive", brackets: MN_BRACKETS },

  AL: {
    code: "AL",
    name: "Alabama",
    type: "progressive",
    brackets: simpleBrackets(0.02, 0.04, 0.05, 500, 3000),
  },
  AZ: {
    code: "AZ",
    name: "Arizona",
    type: "progressive",
    brackets: simpleBrackets(0.025, 0.033, 0.045, 28000, 56000),
  },
  AR: {
    code: "AR",
    name: "Arkansas",
    type: "progressive",
    brackets: simpleBrackets(0.02, 0.04, 0.055, 4400, 8800),
  },
  CT: {
    code: "CT",
    name: "Connecticut",
    type: "progressive",
    brackets: simpleBrackets(0.03, 0.05, 0.0699, 10000, 20000),
  },
  DE: {
    code: "DE",
    name: "Delaware",
    type: "progressive",
    brackets: simpleBrackets(0.022, 0.039, 0.066, 2000, 5000),
  },
  DC: {
    code: "DC",
    name: "District of Columbia",
    type: "progressive",
    brackets: simpleBrackets(0.04, 0.065, 0.095, 10000, 20000),
  },
  HI: {
    code: "HI",
    name: "Hawaii",
    type: "progressive",
    brackets: simpleBrackets(0.014, 0.055, 0.11, 2400, 4800),
  },
  ID: {
    code: "ID",
    name: "Idaho",
    type: "progressive",
    brackets: simpleBrackets(0.01, 0.03, 0.058, 1500, 3000),
  },
  IA: {
    code: "IA",
    name: "Iowa",
    type: "progressive",
    brackets: simpleBrackets(0.04, 0.055, 0.06, 6000, 12000),
  },
  KS: {
    code: "KS",
    name: "Kansas",
    type: "progressive",
    brackets: simpleBrackets(0.031, 0.0525, 0.057, 15000, 30000),
  },
  LA: {
    code: "LA",
    name: "Louisiana",
    type: "progressive",
    brackets: simpleBrackets(0.0185, 0.035, 0.0425, 12500, 25000),
  },
  ME: {
    code: "ME",
    name: "Maine",
    type: "progressive",
    brackets: simpleBrackets(0.058, 0.0675, 0.0715, 24500, 49000),
  },
  MD: {
    code: "MD",
    name: "Maryland",
    type: "progressive",
    brackets: simpleBrackets(0.02, 0.04, 0.0575, 1000, 2000),
  },
  MS: {
    code: "MS",
    name: "Mississippi",
    type: "progressive",
    brackets: simpleBrackets(0, 0.03, 0.05, 10000, 20000),
  },
  MO: {
    code: "MO",
    name: "Missouri",
    type: "progressive",
    brackets: simpleBrackets(0.015, 0.02, 0.0545, 1121, 2242),
  },
  MT: {
    code: "MT",
    name: "Montana",
    type: "progressive",
    brackets: simpleBrackets(0.01, 0.04, 0.069, 3100, 6200),
  },
  NE: {
    code: "NE",
    name: "Nebraska",
    type: "progressive",
    brackets: simpleBrackets(0.0246, 0.0351, 0.0684, 3700, 7400),
  },
  NM: {
    code: "NM",
    name: "New Mexico",
    type: "progressive",
    brackets: simpleBrackets(0.017, 0.032, 0.059, 5500, 16000),
  },
  ND: {
    code: "ND",
    name: "North Dakota",
    type: "progressive",
    brackets: simpleBrackets(0.01, 0.02, 0.029, 41000, 82000),
  },
  OH: {
    code: "OH",
    name: "Ohio",
    type: "progressive",
    brackets: simpleBrackets(0.0275, 0.0325, 0.0375, 26050, 52100),
  },
  OK: {
    code: "OK",
    name: "Oklahoma",
    type: "progressive",
    brackets: simpleBrackets(0.0025, 0.03, 0.0475, 1000, 2000),
  },
  RI: {
    code: "RI",
    name: "Rhode Island",
    type: "progressive",
    brackets: simpleBrackets(0.0375, 0.0475, 0.0599, 68250, 155050),
  },
  SC: {
    code: "SC",
    name: "South Carolina",
    type: "progressive",
    brackets: simpleBrackets(0, 0.03, 0.064, 3200, 6400),
  },
  VT: {
    code: "VT",
    name: "Vermont",
    type: "progressive",
    brackets: simpleBrackets(0.0335, 0.066, 0.0875, 42550, 102200),
  },
  VA: {
    code: "VA",
    name: "Virginia",
    type: "progressive",
    brackets: simpleBrackets(0.02, 0.03, 0.0575, 3000, 17000),
  },
  WV: {
    code: "WV",
    name: "West Virginia",
    type: "progressive",
    brackets: simpleBrackets(0.03, 0.04, 0.065, 10000, 20000),
  },
  WI: {
    code: "WI",
    name: "Wisconsin",
    type: "progressive",
    brackets: simpleBrackets(0.035, 0.0565, 0.0765, 13810, 27630),
  },
};

export function calculateStateTax(
  income: number,
  stateCode: string,
  filingStatus: FilingStatus
): { tax: number; effectiveRate: number } {
  const config = STATE_TAX_CONFIG[stateCode];
  if (!config) return { tax: 0, effectiveRate: 0 };

  if (config.type === "no_tax") {
    return { tax: 0, effectiveRate: 0 };
  }

  if (config.type === "flat" && config.flatRate != null) {
    const tax = income * config.flatRate;
    return {
      tax,
      effectiveRate: income > 0 ? (tax / income) * 100 : 0,
    };
  }

  if (config.type === "progressive" && config.brackets) {
    const brackets = config.brackets[filingStatus] || config.brackets.single;
    let tax = 0;
    for (const b of brackets) {
      if (income > b.min) {
        const taxableInBracket = Math.min(income, b.max) - b.min;
        tax += taxableInBracket * b.rate;
      }
    }
    return {
      tax,
      effectiveRate: income > 0 ? (tax / income) * 100 : 0,
    };
  }

  return { tax: 0, effectiveRate: 0 };
}
