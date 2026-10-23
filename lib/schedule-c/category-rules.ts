/**
 * Alias-head category rulings. Exact, case-sensitive keys.
 * Part V is the internal Other expenses key 27a. The export prints 27a or 27b from the charge year.
 * A line of 'nmi' or 'zero' never becomes a Schedule C line.
 */

export const BUSINESS_SHARE_ONLY_NOTE = 'Only the business-use share is deductible.';
export const REFUND_COPY_MARK = 'awaiting copy approval';
/** Reg. 1.263(a)-1(f)(1)(ii)(D) as raised by Notice 2015-82. $2,500.00 stays. $2,500.01 does not. */
export const PART_V_AND_SUPPLIES_CAP_CENTS = 250_000;
export const REFUND_MATCH_DAYS = 90;

export type RuledKind =
  | 'line'
  | 'part-v'
  | 'zero'
  | 'nmi'
  | 'personal'
  | 'inflow'
  | 'fuel'
  | 'automotive'
  | 'described-other'
  | 'bank-split'
  | 'late-fee'
  | 'transfer';

export interface RuledCategory {
  kind: RuledKind;
  line?: string;
  name?: string;
  /** Line 25 internet and phone: count the confirmed amount and carry the business-share note. */
  businessShareNote?: boolean;
}

const line = (lineCode: string, name: string, businessShareNote = false): RuledCategory =>
  ({ kind: 'line', line: lineCode, name, businessShareNote });
const partV = (): RuledCategory => ({ kind: 'part-v', line: '27a', name: 'Other expenses' });

const ZERO: RuledCategory = { kind: 'zero' };
const NMI: RuledCategory = { kind: 'nmi' };
const PERSONAL: RuledCategory = { kind: 'personal' };
const INFLOW: RuledCategory = { kind: 'inflow' };
const FUEL: RuledCategory = { kind: 'fuel' };
const AUTOMOTIVE: RuledCategory = { kind: 'automotive' };
const OTHER: RuledCategory = { kind: 'described-other' };
const BANK_SPLIT: RuledCategory = { kind: 'bank-split' };
const LATE_FEE: RuledCategory = { kind: 'late-fee', line: '16b', name: 'Interest: other' };
const TRANSFER: RuledCategory = { kind: 'transfer' };

/**
 * Card interest and cash-advance fees keep the 52f5788d fallback: Other expenses at the full confirmed amount.
 * The alias table's 16b share entry is skipped. The ruling is still open, and the $2,500 cap does not apply.
 */
const LEGACY_OTHER_EXPENSE_FEES = new Set(['BANK_FEES_CASH_ADVANCE', 'BANK_FEES_INTEREST_CHARGE']);

export function legacyOtherExpenseFee(category: string): boolean {
  return LEGACY_OTHER_EXPENSE_FEES.has(category);
}

/** Keys whose ruling is not "use the static Schedule C line on CATEGORY_MAP". */
export const RULED_CATEGORIES: Record<string, RuledCategory> = {
  // Meals, so the 50% cut applies. Item 75.
  FOOD_AND_DRINK_COFFEE: line('24b', 'Meals'),
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: line('24b', 'Meals'),
  meals_50: line('24b', 'Meals'),
  'Food & Drink': line('24b', 'Meals'),

  Advertising: line('8', 'Advertising'),
  TRANSPORTATION_PARKING: line('9', 'Car and truck expenses'),

  GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING: line('17', 'Legal and professional services'),
  GENERAL_SERVICES_CONSULTING_AND_LEGAL: line('17', 'Legal and professional services'),
  'Professional Services': line('17', 'Legal and professional services'),

  GENERAL_SERVICES_STORAGE: line('20b', 'Rent (other business property)'),

  GENERAL_MERCHANDISE_DEPARTMENT_STORES: line('22', 'Supplies'),
  GENERAL_MERCHANDISE_DISCOUNT_STORES: line('22', 'Supplies'),
  GENERAL_MERCHANDISE_SUPERSTORES: line('22', 'Supplies'),
  HOME_IMPROVEMENT_HARDWARE: line('22', 'Supplies'),
  GENERAL_SERVICES_POSTAGE_AND_SHIPPING: line('22', 'Supplies'),
  office_supplies: line('22', 'Supplies'),
  'Office Supplies': line('22', 'Supplies'),

  TRAVEL_RENTAL_CARS: line('24a', 'Travel'),
  travel: line('24a', 'Travel'),
  Travel: line('24a', 'Travel'),

  RENT_AND_UTILITIES_INTERNET_AND_CABLE: line('25', 'Utilities', true),
  RENT_AND_UTILITIES_TELEPHONE: line('25', 'Utilities', true),
  utilities_phone_internet: line('25', 'Utilities', true),
  SERVICE_INTERNET_AND_CABLE: line('25', 'Utilities', true),
  SERVICE_PHONE: line('25', 'Utilities', true),

  // Part V by year. The $2,500 cap is applied to every Part V and line 22 charge.
  BANK_FEES_ATM_FEES: partV(),
  BANK_FEES_FOREIGN_TRANSACTION_FEES: partV(),
  BANK_FEES_INSUFFICIENT_FUNDS: partV(),
  BANK_FEES_OVERDRAFT_FEES: partV(),
  BANK_FEES: partV(),
  SOFTWARE: partV(),
  software_subscriptions: partV(),
  Software: partV(),
  GENERAL_SERVICES_EDUCATION: partV(),
  GENERAL_SERVICES_OTHER_GENERAL_SERVICES: partV(),
  SERVICE_SUBSCRIPTION: partV(),

  other: OTHER,
  Other: OTHER,

  BANK_FEES_OTHER_BANK_FEES: BANK_SPLIT,
  bank_and_payment_fees: BANK_SPLIT,
  BANK_FEES_LATE_FEES: LATE_FEE,
  BANK_FEES_CASH_ADVANCE: partV(),
  BANK_FEES_INTEREST_CHARGE: partV(),

  TRANSPORTATION_FUEL: FUEL,
  TRANSPORTATION_GAS: FUEL,
  GENERAL_SERVICES_AUTOMOTIVE: AUTOMOTIVE,
  gas: NMI,

  // Inflows never change an expense line.
  INCOME_DIVIDENDS: INFLOW,
  INCOME_INTEREST_EARNED: INFLOW,
  INCOME_RETIREMENT_PENSION: INFLOW,
  INCOME_TAX_REFUND: INFLOW,
  INCOME_UNEMPLOYMENT: INFLOW,
  INCOME_WAGES: INFLOW,
  INCOME_OTHER_INCOME: INFLOW,
  INCOME: INFLOW,
  income: INFLOW,
  TRANSFER_IN_CASH_ADVANCES_AND_LOANS: INFLOW,
  TRANSFER_IN_DEPOSIT: INFLOW,
  TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS: INFLOW,
  TRANSFER_IN_SAVINGS: INFLOW,
  TRANSFER_IN_ACCOUNT_TRANSFER: INFLOW,
  TRANSFER_IN_OTHER_TRANSFER_IN: INFLOW,
  TRANSFER_IN: INFLOW,
  TRANSFER: INFLOW,

  TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS: ZERO,
  TRANSFER_OUT_SAVINGS: ZERO,
  TRANSFER_OUT_WITHDRAWAL: ZERO,
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: ZERO,
  LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT: ZERO,
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: ZERO,
  COMMUNITY_CHARITY: ZERO,
  GENERAL_MERCHANDISE_PHARMACY: ZERO,
  PERSONAL: ZERO,
  ENTERTAINMENT_SPORTS_AND_OUTDOORS: ZERO,
  ENTERTAINMENT_ARTS: ZERO,
  ENTERTAINMENT_THEATER: ZERO,
  ENTERTAINMENT_MUSIC: ZERO,
  ENTERTAINMENT_MOVIES_AND_DVDS: ZERO,
  ENTERTAINMENT_CASINOS_AND_GAMBLING: ZERO,
  ENTERTAINMENT_MUSIC_AND_AUDIO: ZERO,
  ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS: ZERO,
  ENTERTAINMENT_TV_AND_MOVIES: ZERO,
  ENTERTAINMENT_VIDEO_GAMES: ZERO,
  ENTERTAINMENT_OTHER_ENTERTAINMENT: ZERO,
  Entertainment: ZERO,

  FOOD_AND_DRINK_GROCERIES: PERSONAL,
  GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: PERSONAL,
  GENERAL_MERCHANDISE_PET_SUPPLIES: PERSONAL,
  GENERAL_MERCHANDISE_TOBACCO_AND_VAPE: PERSONAL,
  MEDICAL_DENTAL_CARE: PERSONAL,
  MEDICAL_EYE_CARE: PERSONAL,
  MEDICAL_NURSING_CARE: PERSONAL,
  MEDICAL_PHARMACIES_AND_SUPPLEMENTS: PERSONAL,
  MEDICAL_PRIMARY_CARE: PERSONAL,
  MEDICAL_VETERINARY_SERVICES: PERSONAL,
  MEDICAL_OTHER_MEDICAL: PERSONAL,
  PERSONAL_CARE_HAIR_AND_BEAUTY: PERSONAL,
  PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING: PERSONAL,
  PERSONAL_CARE_OTHER_PERSONAL_CARE: PERSONAL,
  GENERAL_SERVICES_CHILDCARE: PERSONAL,
  Health: PERSONAL,

  TRANSFER_OUT_ACCOUNT_TRANSFER: TRANSFER,
  TRANSFER_OUT_OTHER_TRANSFER_OUT: TRANSFER,
  TRANSFER_OUT: TRANSFER,

  LOAN_PAYMENTS_CAR_PAYMENT: NMI,
  LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT: NMI,
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: NMI,
  LOAN_PAYMENTS_OTHER_PAYMENT: NMI,
  LOAN_PAYMENTS: NMI,
  GENERAL_MERCHANDISE_CONVENIENCE_STORES: NMI,
  GENERAL_MERCHANDISE_ELECTRONICS: NMI,
  GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES: NMI,
  HOME_IMPROVEMENT_FURNITURE: NMI,
  HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE: NMI,
  HOME_IMPROVEMENT_SECURITY: NMI,
  HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT: NMI,
  GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: NMI,
  GOVERNMENT_AND_NON_PROFIT_OTHER_GOVERNMENT_AND_NON_PROFIT: NMI,
  GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES: NMI,
  TRANSPORTATION_BIKES_AND_SCOOTERS: NMI,
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES: NMI,
  TRANSPORTATION_OTHER_TRANSPORTATION: NMI,
  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: NMI,
  RENT_AND_UTILITIES_RENT: NMI,
  RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT: NMI,
  RENT_AND_UTILITIES_WATER: NMI,
  RENT_AND_UTILITIES_OTHER_UTILITIES: NMI,
  vehicle_expense: NMI,
  home_office: NMI,
  Shopping: NMI,
  GENERAL_SERVICES_INSURANCE: NMI,
  Utilities: NMI,
  equipment: NMI,
};

export function ruledCategory(category: string): RuledCategory | undefined {
  if (Object.prototype.hasOwnProperty.call(RULED_CATEGORIES, category)) return RULED_CATEGORIES[category];
  if (category.startsWith('ENTERTAINMENT_')) return ZERO;
  if (category.startsWith('INCOME_') || category.startsWith('TRANSFER_IN')) return INFLOW;
  return undefined;
}

export function possibleRefundNotice(dollars: number): string {
  const amount = `$${Math.abs(dollars).toFixed(2)}`;
  return `These totals do not subtract ${amount} in possible refunds. A refund of a deducted purchase must reduce that expense. ${REFUND_COPY_MARK}`;
}

export interface FuelProfile {
  vehicle_deduction_method?: string | null;
  vehicle_business_use_percentage?: number | null;
  business_vehicle?: { deduction_method?: string | null; business_use_percentage?: number | null } | null;
  vehicleCount?: number | null;
}

export type FuelDecision =
  | { kind: 'nmi' }
  | { kind: 'zero' }
  | { kind: 'line'; percentage: number | null; note: string | null };

function committedMethod(value: unknown): 'standard_mileage' | 'actual_expense' | null {
  return value === 'standard_mileage' || value === 'actual_expense' ? value : null;
}

/** A saved vehicle percentage from 0 through 100. The charge percentage is not read here. */
export function vehiclePercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

/**
 * Interim fuel rule. One vehicle on the profile.
 * Method disagreement, no method, or more than one vehicle with no charge link: Needs more information.
 * Standard mileage: $0. Actual expenses: the vehicle percentage applied later to the yearly total.
 * Disagreeing or missing percentages stay on line 9 at the confirmed amount, with the business-share note.
 */
export function fuelDecision(profile: FuelProfile | null | undefined, vehicleId: string | null): FuelDecision {
  const count = profile?.vehicleCount ?? null;
  if ((count !== null && count > 1 && !vehicleId) || (count !== null && count > 1 && vehicleId === '')) return { kind: 'nmi' };
  const top = committedMethod(profile?.vehicle_deduction_method);
  const nested = committedMethod(profile?.business_vehicle?.deduction_method);
  if (top && nested && top !== nested) return { kind: 'nmi' };
  const method = top || nested;
  if (!method) return { kind: 'nmi' };
  if (method === 'standard_mileage') return { kind: 'zero' };
  const topPercent = vehiclePercent(profile?.vehicle_business_use_percentage);
  const nestedPercent = vehiclePercent(profile?.business_vehicle?.business_use_percentage);
  if (topPercent !== null && nestedPercent !== null && topPercent !== nestedPercent) {
    return { kind: 'line', percentage: null, note: BUSINESS_SHARE_ONLY_NOTE };
  }
  const percentage = topPercent ?? nestedPercent;
  if (percentage === null) return { kind: 'line', percentage: null, note: BUSINESS_SHARE_ONLY_NOTE };
  return { kind: 'line', percentage, note: null };
}

export function textBlob(tx: { [key: string]: unknown }): string {
  return ['merchant_name', 'merchant', 'name', 'description', 'notes', 'business_purpose', 'fee_purpose', 'fee_answer', 'purpose']
    .map(key => tx[key])
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
}

export function hasExpenseDescription(tx: { [key: string]: unknown }): boolean {
  return ['description', 'notes', 'business_purpose'].some(key => typeof tx[key] === 'string' && tx[key].trim().length > 0);
}

/** Processor and platform fees stay on line 10. Plain bank fees do not. */
export function isProcessorOrPlatformFee(tx: { [key: string]: unknown }): boolean {
  return /\bstripe\b|\bpaypal\b|\bsquareup\b|\bsquare\s+(?:inc|fees?)\b|cash\s*out|cashout|instant payout|\b1099\b|processor|platform fee|marketplace fee|seller fee/.test(textBlob(tx));
}

/** A personal-by-default charge the user has marked as business. Confirmation alone is not that mark. */
export function markedBusiness(tx: { [key: string]: unknown }): boolean {
  if (tx.expense_type === 'business' || tx.marked_business === true) return true;
  return typeof tx.business_purpose === 'string' && tx.business_purpose.trim().length > 0;
}

export function answeredPersonal(tx: { [key: string]: unknown }): boolean {
  return /\bpersonal\b/.test(textBlob(tx));
}

export function transferPurposeLine(tx: { [key: string]: unknown }): '11' | '20b' | null {
  const purpose = textBlob(tx);
  if (/\bcontractor\b|\bcontract labor\b/.test(purpose)) return '11';
  if (/\brent\b/.test(purpose)) return '20b';
  return null;
}

export function isIncomeLike(tx: { [key: string]: unknown }, category: string): boolean {
  // `type` is cash direction in the tax export (every negative amount is stamped income). It is not the tax classification.
  const kind = tx.transaction_kind ?? tx.transactionKind;
  if (kind === 'income') return true;
  return ruledCategory(category)?.kind === 'inflow';
}

export function isTransferLike(tx: { [key: string]: unknown }, category: string): boolean {
  const kind = tx.transaction_kind ?? tx.transactionKind ?? tx.type;
  if (kind !== 'transfer') return false;
  if (category.startsWith('TRANSFER_OUT') || category.startsWith('LOAN_')) return false;
  return true;
}

export function merchantKey(tx: { merchant_name?: unknown; merchant?: unknown; name?: unknown }): string {
  const value = tx.merchant_name ?? tx.merchant ?? tx.name;
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function dayNumber(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const parsed = Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 86_400_000) : null;
}

export function cappedLine(lineKey: string): boolean {
  return lineKey === '22' || lineKey === '27a' || lineKey === '27b';
}
