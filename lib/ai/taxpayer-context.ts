/**
 * Taxpayer analysis context: everything the app already knows about the person
 * and their past decisions, shaped as hints and open questions for transaction
 * analysis. It never states that an expense is deductible; the server policy
 * keeps that decision behind the user's confirmation.
 */
import type { UserContext } from './analyzeTransaction';

export type PriorDecision = 'business' | 'personal' | 'unresolved';

export interface ConfirmedMerchantPrior {
  merchantKey: string;
  /** Category the user confirmed most often for this merchant. */
  category: string | null;
  decision: PriorDecision;
  confirmations: number;
  businessCount: number;
  personalCount: number;
  lastConfirmedAt: string | null;
  /** Most recent user-recorded business purpose, when one was saved. */
  lastBusinessPurpose: string | null;
  /** Recent posting dates (ISO), oldest first, used for recurrence detection. */
  dates: string[];
}

export interface RecurrenceHint {
  isRecurring: boolean;
  cadence: 'weekly' | 'monthly' | 'quarterly' | 'annual' | null;
  occurrences: number;
}

export interface TaxpayerAnalysisContext {
  identity: {
    professions: string[];
    entity: UserContext['business_entity'] | null;
    filingState: string | null;
    workLocation: string | null;
    travelPattern: string | null;
    yearsInBusiness: number | null;
    hasW2Income: boolean;
    hasBusinessIncome: boolean;
    naicsCode: string | null;
    businessPurpose: string | null;
    filingStatus: string | null;
    itemizationStatus: string | null;
    professionalLicenseCount: number;
    taxYearRecords: TaxYearRecordFacts | null;
  };
  methods: {
    homeOffice: { method: 'simplified' | 'actual' | null; officeSqFt: number | null; totalHomeSqFt: number | null; exclusiveUseConfirmed: boolean } | null;
    vehicle: { method: 'standard_mileage' | 'actual_expense' | null; businessUsePercent: number | null } | null;
  };
  priors: {
    merchant: ConfirmedMerchantPrior | null;
    recurrence: RecurrenceHint;
    confirmedMerchants: number;
  };
  /** Facts the app still lacks; analysis phrases these as questions, never assumptions. */
  gaps: string[];
  provenance: { sources: string[]; generatedAt: string };
}

export interface ConfirmedTransactionRecord {
  merchant_name?: string | null;
  name?: string | null;
  category?: string | null;
  expense_type?: string | null;
  is_deductible?: boolean | null;
  review_status?: string | null;
  business_purpose?: string | null;
  date?: string | null;
  reviewed_at?: string | null;
}

export interface HomeOfficeFacts {
  officeSqFt?: number | null;
  totalHomeSqFt?: number | null;
}

export interface TaxYearRecordFacts {
  taxYear: number;
  hasW2: boolean;
  form1099Types: string[];
  hasGrossReceipts: boolean;
}

/** Normalizes merchant text so "STARBUCKS #1234" and "Starbucks" compare equal. */
export function merchantKey(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[#*]\s*\d+[\w-]*/g, ' ')
    .replace(/\b\d{2,}\b/g, ' ')
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const isoDay = (value: unknown): string | null => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

/** Reduces confirmed records to per-merchant history. Unconfirmed rows and AI suggestions are ignored. */
export function summarizeConfirmedMerchants(
  records: ConfirmedTransactionRecord[],
  limit = 40,
  taxYear?: number,
): ConfirmedMerchantPrior[] {
  const byMerchant = new Map<string, ConfirmedMerchantPrior & { categories: Map<string, number> }>();
  for (const record of records) {
    if (record.review_status !== 'confirmed') continue;
    const recordDay = isoDay(record.date);
    if (taxYear !== undefined && recordDay?.slice(0, 4) !== String(taxYear)) continue;
    const key = merchantKey(record.merchant_name || record.name);
    if (!key) continue;
    const entry = byMerchant.get(key) ?? {
      merchantKey: key, category: null, decision: 'unresolved', confirmations: 0, businessCount: 0, personalCount: 0,
      lastConfirmedAt: null, lastBusinessPurpose: null, dates: [], categories: new Map<string, number>(),
    };
    entry.confirmations++;
    if (record.is_deductible === true || record.expense_type === 'business') entry.businessCount++;
    else if (record.is_deductible === false || record.expense_type === 'personal') entry.personalCount++;
    if (record.category) entry.categories.set(record.category, (entry.categories.get(record.category) ?? 0) + 1);
    const day = recordDay;
    if (day) entry.dates.push(day);
    const reviewedAt = typeof record.reviewed_at === 'string' ? record.reviewed_at : day;
    if (reviewedAt && (!entry.lastConfirmedAt || reviewedAt > entry.lastConfirmedAt)) {
      entry.lastConfirmedAt = reviewedAt;
      if (typeof record.business_purpose === 'string' && record.business_purpose.trim().length >= 8) {
        entry.lastBusinessPurpose = record.business_purpose.trim().slice(0, 240);
      }
    }
    byMerchant.set(key, entry);
  }
  return [...byMerchant.values()]
    .map(({ categories, ...entry }) => {
      const category = [...categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      // A decision only counts when the history is one-sided; mixed history stays unresolved.
      const decision: PriorDecision = entry.businessCount && !entry.personalCount ? 'business'
        : entry.personalCount && !entry.businessCount ? 'personal' : 'unresolved';
      return { ...entry, category, decision, dates: [...new Set(entry.dates)].sort().slice(-12) };
    })
    .sort((a, b) => (b.lastConfirmedAt ?? '').localeCompare(a.lastConfirmedAt ?? ''))
    .slice(0, limit);
}

/** Recurrence from posting-date spacing; a hint for categorization, never evidence of business use. */
export function detectRecurrence(dates: string[], currentDate?: string | null): RecurrenceHint {
  const days = [...new Set([...dates, ...(isoDay(currentDate) ? [isoDay(currentDate)!] : [])])].sort();
  if (days.length < 3) return { isRecurring: false, cadence: null, occurrences: days.length };
  const gaps: number[] = [];
  for (let index = 1; index < days.length; index++) {
    gaps.push((Date.parse(days[index]) - Date.parse(days[index - 1])) / 86_400_000);
  }
  const cadences: Array<[RecurrenceHint['cadence'], number, number]> = [['weekly', 7, 2], ['monthly', 30, 5], ['quarterly', 91, 10], ['annual', 365, 20]];
  for (const [cadence, expected, tolerance] of cadences) {
    const matching = gaps.filter(gap => Math.abs(gap - expected) <= tolerance).length;
    if (matching >= 2 && matching >= gaps.length - 1) return { isRecurring: true, cadence, occurrences: days.length };
  }
  return { isRecurring: false, cadence: null, occurrences: days.length };
}

export function buildTaxpayerContext(input: {
  profile: UserContext;
  homeOffice?: HomeOfficeFacts | null;
  taxYearRecords?: TaxYearRecordFacts | null;
  confirmed: ConfirmedMerchantPrior[];
  merchant: string | null | undefined;
  transactionDate?: string | null;
  generatedAt?: string;
}): TaxpayerAnalysisContext {
  const { profile } = input;
  const key = merchantKey(input.merchant);
  const prior = key ? input.confirmed.find(entry => entry.merchantKey === key) ?? null : null;
  const homeOfficeMethod = profile.home_office_method === 'simplified' || profile.home_office_method === 'actual' ? profile.home_office_method
    : profile.home_office_details?.method === 'simplified' || profile.home_office_details?.method === 'actual' ? profile.home_office_details.method : null;
  const officeSqFt = input.homeOffice?.officeSqFt ?? profile.home_office_sqft ?? profile.home_office_details?.sqft ?? null;
  const totalHomeSqFt = input.homeOffice?.totalHomeSqFt ?? profile.total_home_sqft ?? profile.home_office_details?.total_home_sqft ?? null;
  const vehicleMethod = profile.vehicle_deduction_method === 'standard_mileage' || profile.vehicle_deduction_method === 'actual_expense'
    ? profile.vehicle_deduction_method : profile.business_vehicle?.deduction_method ?? null;
  const vehiclePercent = profile.vehicle_business_use_percentage ?? profile.business_vehicle?.business_use_percentage ?? null;
  const hasHomeOffice = Boolean(homeOfficeMethod || officeSqFt || profile.office_location?.toLowerCase().includes('home'));
  const hasVehicle = Boolean(vehicleMethod || vehiclePercent);

  const gaps: string[] = [];
  if (!profile.business_entity) gaps.push('business_entity');
  if (hasHomeOffice && !homeOfficeMethod) gaps.push('home_office_method');
  if (hasHomeOffice && profile.home_office_details?.exclusive_use !== true) gaps.push('home_office_exclusive_use');
  if (hasVehicle && !vehicleMethod) gaps.push('vehicle_deduction_method');
  if (hasVehicle && vehiclePercent == null) gaps.push('vehicle_business_use_percentage');
  if (!profile.work_related_travel) gaps.push('work_related_travel');

  return {
    identity: {
      professions: profile.profession ?? [],
      entity: profile.business_entity ?? null,
      filingState: profile.filing_state || profile.state || null,
      workLocation: profile.office_location ?? null,
      travelPattern: profile.work_related_travel_pattern ?? profile.work_related_travel ?? null,
      yearsInBusiness: profile.years_in_business ?? null,
      hasW2Income: (profile.w2_income ?? profile.income_breakdown?.w2_income ?? 0) > 0,
      hasBusinessIncome: (profile.business_income ?? profile.income_breakdown?.business_income ?? 0) > 0,
      naicsCode: typeof profile.naics_code === 'string' ? profile.naics_code.trim().slice(0, 12) || null : null,
      businessPurpose: typeof profile.business_purpose === 'string' ? profile.business_purpose.trim().slice(0, 500) || null : null,
      filingStatus: typeof profile.filing_status === 'string' ? profile.filing_status : null,
      itemizationStatus: profile.itemization_status ?? null,
      professionalLicenseCount: Array.isArray(profile.professional_licenses) ? profile.professional_licenses.length : 0,
      taxYearRecords: input.taxYearRecords ?? null,
    },
    methods: {
      homeOffice: hasHomeOffice ? { method: homeOfficeMethod, officeSqFt: officeSqFt ?? null, totalHomeSqFt: totalHomeSqFt ?? null, exclusiveUseConfirmed: profile.home_office_details?.exclusive_use === true } : null,
      vehicle: hasVehicle ? { method: vehicleMethod ?? null, businessUsePercent: vehiclePercent ?? null } : null,
    },
    priors: {
      merchant: prior,
      recurrence: detectRecurrence(prior?.dates ?? [], input.transactionDate ?? null),
      confirmedMerchants: input.confirmed.length,
    },
    gaps,
    provenance: {
      sources: ['profile', ...(input.homeOffice ? ['home_office_settings'] : []),
        ...(input.taxYearRecords ? ['tax_year_income_records'] : []),
        ...(input.confirmed.length ? ['confirmed_transactions'] : [])],
      generatedAt: input.generatedAt ?? new Date().toISOString(),
    },
  };
}

/** Compact, model-facing view: no identifiers beyond what analysis already receives. */
export function taxpayerContextForModel(context: TaxpayerAnalysisContext) {
  const prior = context.priors.merchant;
  return {
    identity: context.identity,
    methods: context.methods,
    prior_merchant_decisions: prior ? {
      decision: prior.decision,
      confirmations: prior.confirmations,
      usual_category: prior.category,
      last_business_purpose: prior.lastBusinessPurpose,
      note: 'Past confirmations are category signals from this user; they do not establish deductibility for this transaction.',
    } : null,
    recurrence: context.priors.recurrence,
    open_questions: context.gaps,
  };
}
