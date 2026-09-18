/** Client-safe review contract. Categories map to the existing export taxonomy only after user review. */
export const REVIEW_CATEGORIES = [
  { value: 'advertising_marketing', label: 'Advertising and marketing', recordedCategory: 'SERVICE_ADVERTISING' },
  { value: 'supplies_small_tools', label: 'Supplies and small tools', recordedCategory: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' },
  { value: 'software_subscriptions', label: 'Software and subscriptions', recordedCategory: 'SERVICE_SUBSCRIPTION' },
  { value: 'contract_labor', label: 'Contract labor', recordedCategory: 'SERVICE_FREELANCE_SERVICES' },
  { value: 'equipment', label: 'Equipment — tax treatment needs review', recordedCategory: 'EQUIPMENT_REVIEW_REQUIRED' },
  { value: 'vehicle_expense', label: 'Vehicle — method needs review', recordedCategory: 'VEHICLE_REVIEW_REQUIRED' },
  { value: 'travel', label: 'Business travel', recordedCategory: 'TRAVEL_OTHER_TRAVEL' },
  { value: 'meals_50', label: 'Business meals (50% limit)', recordedCategory: 'FOOD_AND_DRINK_RESTAURANT' },
  { value: 'home_office', label: 'Home office — eligibility needs review', recordedCategory: 'HOME_OFFICE_REVIEW_REQUIRED' },
  { value: 'utilities_phone_internet', label: 'Utilities, phone and internet', recordedCategory: 'SERVICE_UTILITIES' },
  { value: 'education_training', label: 'Education and training', recordedCategory: 'SERVICE_EDUCATION' },
  { value: 'dues_and_memberships', label: 'Professional dues', recordedCategory: 'SERVICE_PROFESSIONAL_DUES' },
  { value: 'bank_and_payment_fees', label: 'Bank and payment fees', recordedCategory: 'BANK_FEES_OTHER_BANK_FEES' },
  { value: 'rent', label: 'Business property rent', recordedCategory: 'RENT_RENT' },
  { value: 'other', label: 'Other — tax treatment needs review', recordedCategory: 'OTHER_REVIEW_REQUIRED' },
] as const;

export type ReviewCategory = typeof REVIEW_CATEGORIES[number]['value'];
export type TransactionKind = 'expense' | 'income' | 'transfer' | 'refund' | 'personal' | 'unknown';
export interface AiReviewSuggestion {
  id: string;
  status: 'ok' | 'needs_more_info' | 'blocked';
  transactionKind: TransactionKind;
  category: ReviewCategory | null;
  isDeductible: boolean | null;
  deductiblePercent: number | null;
  reasoning: string;
  questions: string[];
  documentationRequired: string[];
  irsReferences: string[];
  sources: Array<{ id: string; title: string; url: string; reviewed_at: string; edition: string }>;
  taxYear: number | null;
  policyVersion: string | null;
  model: string;
  analyzedAt: number;
  inputHash: string;
  profileHash?: string;
  /** Unsupported year/entity can block tax treatment without blocking a known bookkeeping category. */
  categoryReady?: boolean;
  /**
   * Server-proposed business purpose (from the merchant table) awaiting the user's one-tap confirmation
   * or edit. Present only when status is needs_more_info with business_purpose missing; saving the
   * purpose and re-running analysis, not this field, is what can change the outcome.
   */
  proposedPurpose?: string;
  /** Schedule C line where the suggested category would be reported; display only. */
  scheduleCLine?: string;
}

export type TransactionReviewRequest =
  | { action: 'confirm'; accountId: string; suggestionId: string }
  | { action: 'correct'; accountId: string; category: string; transactionKind: Exclude<TransactionKind, 'unknown'>; isDeductible: boolean | null; reason?: string };

export function reviewCategory(value: unknown) {
  return REVIEW_CATEGORIES.find(category => category.value === value || category.recordedCategory === value);
}

export function canConfirmAiSuggestion(suggestion: AiReviewSuggestion | null | undefined): boolean {
  if (!suggestion || suggestion.status === 'blocked' && suggestion.categoryReady !== true || !suggestion.id || !suggestion.inputHash ||
      suggestion.transactionKind === 'unknown') return false;
  if (['income', 'transfer', 'personal', 'refund'].includes(suggestion.transactionKind)) return suggestion.isDeductible !== true;
  const category = reviewCategory(suggestion.category);
  return !!category && category.value !== 'other';
}

/** Cash direction alone never establishes taxable business income. */
export function recordedTransactionType(record: Record<string, any>): 'income' | 'expense' | undefined {
  const category = typeof record.category === 'string' ? record.category.toLowerCase() : '';
  if (record.amount < 0 && (record.transaction_kind === 'income' || category === 'income' || category === 'revenue')) return 'income';
  if (record.amount > 0 && record.transaction_kind !== 'transfer') return 'expense';
  return undefined;
}

export function reviewHydrationFields(record: Record<string, any>) {
  return {
    ai_suggestion: record.ai_suggestion ?? null,
    transaction_kind: record.transaction_kind,
    review_status: record.review_status,
    review_source: record.review_source,
    review_suggestion_id: record.review_suggestion_id,
    reviewed_at: record.reviewed_at,
    tax_review_required: record.tax_review_required ?? false,
    expense_type: record.expense_type,
    iso_currency_code: record.iso_currency_code,
    unofficial_currency_code: record.unofficial_currency_code,
    business_purpose: record.business_purpose,
    attendees: record.attendees,
    equipment_details: record.equipment_details,
    documentation_status: record.documentation_status,
    travel_destination: record.travel_destination,
    client_project: record.client_project,
    meeting_notes: record.meeting_notes,
    mileage_details: record.mileage_details,
    analysis_status: record.analysis_status || record.analysisStatus,
    analysisJobId: record.analysisJobId,
    analysisErrorCode: record.analysisErrorCode,
  };
}

export type AiSuggestion = AiReviewSuggestion;
export type ReviewRequest = TransactionReviewRequest;
export const canConfirmSuggestion = canConfirmAiSuggestion;
