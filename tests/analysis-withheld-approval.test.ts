import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
import { analysisSuggestionUpdate, withheldApprovalGate, withheldMissingField } from '@/lib/ai/analysis-persistence';
import type { OutputType } from '@/lib/ai/analyzeTransaction';

const approval = (patch: Partial<OutputType> = {}): OutputType => ({
  status: 'ok', transaction_kind: 'expense', category: 'software_subscriptions', is_deductible: true, expense_type: 'business', deductible_percent: 100,
  evidence_ids: ['software-334'], confidence: 0.9, audit_risk: 'low', questions: [], documentation_required: ['Invoice'],
  customized_reason: 'You noted: Design software for client work. The subscription is an ordinary software expense (Schedule C line 18).',
  reasoning_summary: 'Ordinary software expense.', key_analysis_factor: 'Saved purpose names client work.', schedule_c_line: '18', ...patch,
});
const record = (patch: Record<string, unknown> = {}) => ({ amount: 95, date: '2026-05-04', merchant_name: 'Verizon Wireless', business_purpose: 'Cell phone used for client calls', ...patch });

describe('an engine approval the review path cannot consume is stored as the question that unblocks it', () => {
  it('a 100% approval in a supported category is saved as the approval', () => {
    const saved = analysisSuggestionUpdate(approval(), 1, record());
    expect(saved.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, deductiblePercent: 100, scheduleCLine: '18' });
    expect(saved.ai_customized_reason).toContain('Schedule C line 18');
    expect(saved.deductionStatus).toBe('Likely Deductible');
  });
  it('a partial business share names the share and says the estimate keeps it for the preparer; nothing contradicts the status', () => {
    const saved = analysisSuggestionUpdate(approval({ category: 'utilities_phone_internet', deductible_percent: 40, schedule_c_line: '25',
      customized_reason: 'You noted: Cell phone used for client calls. The 40% business share is deductible on Schedule C line 25.' }), 1, record());
    expect(saved.ai_suggestion).toMatchObject({ status: 'needs_more_info', isDeductible: null, deductiblePercent: null });
    expect(saved.ai_suggestion.reasoning).toContain('40% business share ($38.00 of $95.00)');
    expect(saved.ai_suggestion.reasoning).toContain('kept with its 40% share for your preparer');
    expect(saved.ai_suggestion.questions[0]).toContain('100% business, or a shared item');
    for (const text of [saved.ai_customized_reason, saved.reasoning, saved.ai.reasoning, saved.ai_reasoning_summary, saved.ai_key_analysis_factor]) {
      expect(text).not.toMatch(/is deductible on Schedule C/);
      expect(text).toContain('40%');
    }
    expect(saved.ai_missing_fields).toEqual(['business_use_allocation']);
    expect(saved.ai_explanation.headline).toMatch(/^Needs one fact: whether this charge is 100% business or a shared item kept for your preparer/);
    expect(saved.ai_explanation.estimatedTaxEffect).toBeNull();
    expect(saved.deductionStatus).toBe('Needs more information');
  });
  it('a vehicle approval asks for the method instead of a generic confirmation', () => {
    const saved = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9',
      customized_reason: 'You noted: Gas for a full day of Uber driving. Fuel for business driving is deductible on Schedule C line 9.' }), 1,
      record({ amount: 58, merchant_name: 'CHEVRON 0209', business_purpose: 'Gas for a full day of Uber driving' }));
    expect(saved.ai_suggestion.status).toBe('needs_more_info');
    expect(saved.ai_suggestion.questions[0]).toBe('Do you use the standard mileage rate or actual expenses for this vehicle?');
    expect(saved.ai_suggestion.reasoning).toContain('standard mileage rate');
    expect(saved.ai_customized_reason).not.toContain('is deductible on Schedule C line 9');
    expect(saved.ai_missing_fields).toEqual(['vehicle_method']);
    expect(saved.ai_explanation.headline).toMatch(/^Needs one fact: the business miles driven and your vehicle deduction method/);
  });
  it.each([
    ['equipment', 'asset_treatment', /depreciation/],
    ['home_office', 'home_office_eligibility', /Form 8829/],
    ['other', 'expense_category', /Which expense category/],
  ])('%s approvals carry their own question', (category, field, pattern) => {
    const saved = analysisSuggestionUpdate(approval({ category: category as OutputType['category'] }), 1, record({ amount: 420 }));
    expect(saved.ai_suggestion.status).toBe('needs_more_info');
    expect(saved.ai_missing_fields).toEqual([field]);
    expect(`${saved.ai_suggestion.questions[0]} ${saved.ai_suggestion.reasoning}`).toMatch(pattern);
  });
  it('the model question is kept behind the unblocking question, and the gate text has no unconditional claims', () => {
    const saved = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', questions: ['Was this trip for a client?'] }), 1, record({ amount: 58 }));
    expect(saved.ai_suggestion.questions).toEqual(['Do you use the standard mileage rate or actual expenses for this vehicle?', 'Was this trip for a client?']);
    for (const kind of ['unknown', 'expense'] as const) {
      for (const category of ['vehicle_expense', 'equipment', 'home_office', 'other', 'software_subscriptions', null]) {
        const gate = withheldApprovalGate({ category, deductiblePercent: 40, transactionKind: kind, amount: 95 }, 100);
        expect(`${gate.question} ${gate.reason}`).not.toMatch(/fully deductible|100% deductible|maximi[sz]e|guarantee|audit protection|file your taxes/i);
        expect(withheldMissingField(category, kind)).toMatch(/^[a-z_]+$/);
      }
    }
  });
  it('a meal approval at 50% is saved as the approval; any other share is withheld', () => {
    const meal = approval({ category: 'meals_50', deductible_percent: 50, schedule_c_line: '24b' });
    expect(analysisSuggestionUpdate(meal, 1, record({ amount: 64, merchant_name: 'Chipotle' })).ai_suggestion.status).toBe('ok');
    expect(analysisSuggestionUpdate({ ...meal, deductible_percent: 100 }, 1, record({ amount: 64 })).ai_suggestion.status).toBe('needs_more_info');
  });
});
