import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES } from '@/lib/ai/transaction-tax-policy';
import { PLAID_CATEGORY_MAP } from '@/lib/ai/merchant-intelligence';
import { VEHICLE_ACTUAL_EXPENSE_CATEGORY, VEHICLE_LOAN_INTEREST_CATEGORY, VEHICLE_PROPERTY_TAX_CATEGORY } from '@/lib/ai/actual-expense-share';
import { HIRED_LOCAL_TRANSPORT_CATEGORY } from '@/lib/ai/vehicle-separate-costs';
import { hasCategoryRule } from '@/lib/schedule-c/aggregate';
import { REVIEW_CATEGORIES } from '@/lib/transactions/ai-review-contract';

/** Enforce mode. Any live value other than the four review placeholders must have a rule. CI fails when one does not. */
const DELIBERATE_EXCEPTIONS = [
  'EQUIPMENT_REVIEW_REQUIRED',
  'VEHICLE_REVIEW_REQUIRED',
  'HOME_OFFICE_REVIEW_REQUIRED',
  'OTHER_REVIEW_REQUIRED',
] as const;

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function expensePickerValues(path: string): string[] {
  const block = source(path).match(/const EXPENSE_CATEGORIES = \[([\s\S]*?)\];/);
  if (!block) throw new Error(`missing EXPENSE_CATEGORIES in ${path}`);
  return [...block[1].matchAll(/value:\s*"([^"]+)"/g)].map(match => match[1]);
}

describe('live category coverage', () => {
  it('fails when a live category has no rule, other than the four review placeholders', () => {
    const policy = source('lib/ai/transaction-tax-policy.ts');
    const analysis = source('lib/ai/analyzeTransaction.ts');
    const merchant = source('lib/ai/merchant-intelligence.ts');
    const review = source('lib/transactions/review.ts');
    const manual = source('app/api/transactions/manual/route.ts');
    const statement = source('app/api/tax/import-bank-statement/route.ts');
    const receipt = source('lib/ocr/receipt-processor.ts');
    const sync = source('lib/plaid/sync-helper.ts');
    expect(analysis).toContain('z.enum(EXPENSE_CATEGORIES)');
    expect(analysis).toContain('enum: [...EXPENSE_CATEGORIES, null]');
    expect(manual).toContain("category || (txType === 'income' ? 'income' : 'other')");
    expect(sync).toContain("|| 'Other'");
    expect(review).toContain("recordedCategory = 'INCOME'");
    expect(review).toContain("recordedCategory = 'TRANSFER'");
    expect(review).toContain("recordedCategory = 'PERSONAL'");

    const fallback = merchant.match(/const PLAID_PRIMARY_FALLBACK[\s\S]*?^};/m);
    if (!fallback) throw new Error('missing PLAID_PRIMARY_FALLBACK');
    const primaryKeys = [...fallback[0].matchAll(/^\s+([A-Z0-9_]+):/gm)].map(match => match[1]);
    expect(primaryKeys).toEqual(['INCOME', 'TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS', 'BANK_FEES']);

    const guess = statement.match(/category \(best guess: ([^)]+)\)/);
    if (!guess) throw new Error('missing statement category prompt');
    const statementLabels = guess[1].split(',').map(label => label.trim());

    const ocr = receipt.match(/const categoryMap = \{([\s\S]*?)\};/);
    if (!ocr) throw new Error('missing receipt category map');
    const ocrKeys = [...ocr[1].matchAll(/'([^']+)':/g)].map(match => match[1]);

    const live = new Set<string>([
      ...PLAID_CATEGORY_MAP.map(item => item.detailed),
      ...primaryKeys,
      ...EXPENSE_CATEGORIES,
      ...REVIEW_CATEGORIES.flatMap(category => [category.value, category.recordedCategory]),
      ...expensePickerValues('components/add-manual-entry-screen.tsx'),
      ...expensePickerValues('components/add-manual-transaction-screen.tsx'),
      ...ocrKeys,
      'other',
      'income',
      'Other',
      ...statementLabels,
      'INCOME',
      'TRANSFER',
      'PERSONAL',
      VEHICLE_ACTUAL_EXPENSE_CATEGORY,
      VEHICLE_LOAN_INTEREST_CATEGORY,
      VEHICLE_PROPERTY_TAX_CATEGORY,
      HIRED_LOCAL_TRANSPORT_CATEGORY,
    ]);

    const exceptions = DELIBERATE_EXCEPTIONS.filter(value => live.has(value)).slice().sort();
    const unmapped = [...live].filter(value => !hasCategoryRule(value) && !exceptions.includes(value)).sort();
    console.log(`[live-category-coverage] unmapped live categories (${unmapped.length}):\n${unmapped.join('\n')}`);
    console.log(`[live-category-coverage] deliberate exceptions:\n${exceptions.join('\n')}`);

    expect(exceptions).toEqual([...DELIBERATE_EXCEPTIONS].slice().sort());
    expect(unmapped).toEqual([]);
    for (const exception of exceptions) expect(hasCategoryRule(exception)).toBe(false);
  });
});
