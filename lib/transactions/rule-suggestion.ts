import { merchantIntelligence } from '@/lib/ai/merchant-intelligence';
import {
  canConfirmAiSuggestion, reviewCategory, type AiReviewSuggestion, type ReviewCategory,
} from './ai-review-contract';

/** Stable id shared by the server confirm path and the review screen. No hash, no model call. */
export function ruleSuggestionId(kind: string, category: string, name: string): string {
  const raw = `rule:${kind}:${category}:${name}`;
  return raw.length <= 128 ? raw : raw.slice(0, 128);
}

export interface RuleSuggestionInput {
  merchant_name?: string | null;
  merchant?: string | null;
  name?: string | null;
  amount?: number | null;
  description?: string | null;
}

function suggestion(id: string, fields: Pick<AiReviewSuggestion, 'transactionKind' | 'category' | 'isDeductible' | 'deductiblePercent' | 'reasoning'>): AiReviewSuggestion {
  return {
    id,
    status: 'ok',
    transactionKind: fields.transactionKind,
    category: fields.category,
    isDeductible: fields.isDeductible,
    deductiblePercent: fields.deductiblePercent,
    reasoning: fields.reasoning,
    questions: [],
    documentationRequired: [],
    irsReferences: [],
    sources: [],
    taxYear: null,
    policyVersion: null,
    model: 'rule',
    analyzedAt: 0,
    inputHash: id,
  };
}

/**
 * A high-confidence merchant-table hint the owner can confirm without a model call.
 * Medium Plaid-only hints are not confirmable. Nothing here calls a model.
 */
export function ruleBasedSuggestion(record: RuleSuggestionInput): AiReviewSuggestion | null {
  const merchant = record.merchant_name || record.merchant || record.name || '';
  const amount = typeof record.amount === 'number' ? record.amount : undefined;
  const intel = merchantIntelligence({
    merchant, merchant_name: record.merchant_name || undefined,
    description: record.description || undefined, amount, amount_usd: amount,
  });
  if (intel.confidence !== 'high' || intel.source !== 'merchant_table' || !intel.name) return null;
  const reasoning = intel.defaultPurpose || intel.name;
  if (intel.disposition === 'personal_likely') {
    return suggestion(ruleSuggestionId('personal', 'other', intel.name), {
      transactionKind: 'personal', category: 'other', isDeductible: false, deductiblePercent: 0, reasoning,
    });
  }
  if (intel.disposition !== 'business_likely' || !intel.category) return null;
  const category = reviewCategory(intel.category);
  if (!category || category.value === 'other' || category.recordedCategory.endsWith('_REVIEW_REQUIRED')) return null;
  const built = suggestion(ruleSuggestionId('expense', category.value, intel.name), {
    transactionKind: 'expense',
    category: category.value as ReviewCategory,
    isDeductible: true,
    deductiblePercent: category.value === 'meals_50' ? 50 : 100,
    reasoning,
  });
  return canConfirmAiSuggestion(built) ? built : null;
}
