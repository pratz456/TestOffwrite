import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
import { analysisSuggestionUpdate, STANDARD_MILEAGE_RUNNING_COST_GATE, VEHICLE_METHOD_GATE, withheldApprovalGate, withheldMissingField } from '@/lib/ai/analysis-persistence';
import { blankVehicle, saveVehicle } from '@/lib/mileage/vehicles';
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
  it.each([
    ['parking_tolls', '9', 'PARKMOBILE 770-818-9036', 'Parking at the client site for the kickoff meeting'],
    ['insurance', '15', 'HISCOX INC', 'Professional liability insurance for my consulting business'],
    ['legal_professional', '17', 'MORRISON LAW GROUP', 'Attorney review of my client services contract'],
    ['taxes_licenses', '23', 'FLORIDA SUNBIZ', 'Annual report fee for my LLC'],
    ['repairs_maintenance', '21', 'UBREAKIFIX', 'Screen repair on the work laptop'],
  ])('a %s approval (2026-09-18.3 confirmable line %s) is saved as the approval, not withheld', (category, line, merchant, purpose) => {
    const saved = analysisSuggestionUpdate(approval({ category: category as OutputType['category'], schedule_c_line: line,
      customized_reason: `You noted: ${purpose}.` }), 1, record({ amount: 120, merchant_name: merchant, business_purpose: purpose }));
    expect(saved.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, deductiblePercent: 100, scheduleCLine: line, category });
    expect(saved.ai_missing_fields).toEqual([]);
    expect(saved.deductionStatus).toBe('Likely Deductible');
  });
  it('a tax-preparation fee approved at the saved business share is withheld like any partial share', () => {
    const saved = analysisSuggestionUpdate(approval({ category: 'legal_professional', deductible_percent: 60, schedule_c_line: '17' }), 1,
      record({ amount: 200, merchant_name: 'H&R BLOCK ONLINE', business_purpose: 'Tax prep for my 1040 and Schedule C', business_use_percentage: 60 }));
    expect(saved.ai_suggestion).toMatchObject({ status: 'needs_more_info', isDeductible: null });
    expect(saved.ai_missing_fields).toEqual(['business_use_allocation']);
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
  it('standard mileage holds gas and other running costs and still allows parking and tolls', () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const savedCars = saveVehicle([blankVehicle('legacy-vehicle-1', 0)], 'legacy-vehicle-1', { method: 'standard_mileage', taxYear: 2026 });
    if (!savedCars.ok) throw new Error(savedCars.reason);
    const facts = { vehicles: savedCars.vehicles, taxYear: 2026, vehicleId: 'legacy-vehicle-1' };
    const gas = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9',
      customized_reason: 'You noted: Gas for a full day of Uber driving. Fuel for business driving is deductible on Schedule C line 9.' }), 1,
      record({ amount: 58, merchant_name: 'CHEVRON 0209', business_purpose: 'Gas for a full day of Uber driving' }), undefined, null, facts);
    const repair = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
      record({ amount: 40, merchant_name: 'JIFFY LUBE', business_purpose: 'Oil change on the work car' }), undefined, null, facts);
    expect(gas.deductionStatus).toBe('Needs more information');
    expect(gas.ai_suggestion).toMatchObject({ status: 'needs_more_info', isDeductible: null, deductiblePercent: null });
    expect(gas.ai_suggestion.questions[0]).toBe(STANDARD_MILEAGE_RUNNING_COST_GATE.question);
    expect(gas.ai_suggestion.reasoning).toBe(STANDARD_MILEAGE_RUNNING_COST_GATE.reason);
    expect(gas.deductionStatus).not.toBe('Likely Deductible');
    expect(repair.ai_suggestion.questions[0]).toBe(STANDARD_MILEAGE_RUNNING_COST_GATE.question);
    expect(repair.deductionStatus).toBe('Needs more information');
    for (const [merchant, purpose] of [['PARKMOBILE', 'Parking at the client site'], ['EZ PASS', 'Toll on the way to the client']] as const) {
      const allowed = analysisSuggestionUpdate(approval({ category: 'parking_tolls', schedule_c_line: '9', customized_reason: `You noted: ${purpose}.` }), 1,
        record({ amount: 18, merchant_name: merchant, business_purpose: purpose }), undefined, null, facts);
      expect(allowed.deductionStatus).toBe('Likely Deductible');
      expect(allowed.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, deductiblePercent: 100, category: 'parking_tolls' });
    }
    vi.unstubAllEnvs();
  });

  it('standard mileage still deducts car loan interest and vehicle personal property tax', () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const savedCars = saveVehicle([blankVehicle('legacy-vehicle-1', 0)], 'legacy-vehicle-1', { method: 'standard_mileage', taxYear: 2026 });
    if (!savedCars.ok) throw new Error(savedCars.reason);
    const facts = { vehicles: savedCars.vehicles, taxYear: 2026, vehicleId: 'legacy-vehicle-1' };
    const interest = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9', evidence_ids: ['travel-463'] }), 1,
      record({ amount: 180, merchant_name: 'Toyota Financial', business_purpose: 'Interest on the car loan for business miles' }), undefined, null, facts);
    const propertyTax = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9', evidence_ids: ['travel-463'] }), 1,
      record({ amount: 90, merchant_name: 'County Treasurer', business_purpose: 'Personal property tax on the car' }), undefined, null, facts);
    const payment = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
      record({ amount: 420, merchant_name: 'Toyota Financial', business_purpose: 'Car loan payment for the work car' }), undefined, null, facts);
    expect(interest.deductionStatus).toBe('Likely Deductible');
    expect(interest.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, deductiblePercent: 100, category: 'vehicle_expense' });
    expect(interest.ai_suggestion.questions.join(' ')).not.toContain(STANDARD_MILEAGE_RUNNING_COST_GATE.question);
    expect(propertyTax.deductionStatus).toBe('Likely Deductible');
    expect(propertyTax.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, category: 'vehicle_expense' });
    expect(propertyTax.ai_suggestion.questions.join(' ')).not.toContain(STANDARD_MILEAGE_RUNNING_COST_GATE.question);
    expect(payment.deductionStatus).toBe('Needs more information');
    expect(payment.ai_suggestion.questions[0]).toBe(STANDARD_MILEAGE_RUNNING_COST_GATE.question);
    vi.unstubAllEnvs();
    const off = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
      record({ amount: 180, merchant_name: 'Toyota Financial', business_purpose: 'Interest on the car loan for business miles' }), undefined, null, facts);
    expect(off.deductionStatus).toBe('Needs more information');
    expect(off.ai_suggestion.questions[0]).toBe(VEHICLE_METHOD_GATE.question);
    expect(off.deductionStatus).not.toBe('Likely Deductible');
  });

  it('actual expenses keep the base vehicle question', () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const savedCars = saveVehicle([blankVehicle('legacy-vehicle-1', 0)], 'legacy-vehicle-1', { method: 'actual_expense', taxYear: 2026 });
    if (!savedCars.ok) throw new Error(savedCars.reason);
    const gas = approval({ category: 'vehicle_expense', schedule_c_line: '9',
      customized_reason: 'You noted: Gas for a full day of Uber driving. Fuel for business driving is deductible on Schedule C line 9.' });
    const trip = record({ amount: 58, merchant_name: 'CHEVRON 0209', business_purpose: 'Gas for a full day of Uber driving' });
    const withMethod = analysisSuggestionUpdate(gas, 1, trip, undefined, null, { vehicles: savedCars.vehicles, taxYear: 2026 });
    vi.unstubAllEnvs();
    const base = analysisSuggestionUpdate(gas, 1, trip);
    expect(withMethod.deductionStatus).toBe('Needs more information');
    expect(withMethod.ai_suggestion).toMatchObject({ status: 'needs_more_info', isDeductible: null, questions: [VEHICLE_METHOD_GATE.question] });
    expect(withMethod.ai_suggestion.reasoning).toBe(base.ai_suggestion.reasoning);
    expect(withMethod.deductionStatus).toBe(base.deductionStatus);
    expect(withMethod.deductionStatus).not.toBe('Likely Deductible');
  });

  it('the switch off matches the base vehicle result even when a standard mileage car is on file', () => {
    const savedCars = saveVehicle([blankVehicle('legacy-vehicle-1', 0)], 'legacy-vehicle-1', { method: 'standard_mileage', taxYear: 2026 });
    if (!savedCars.ok) throw new Error(savedCars.reason);
    const gas = approval({ category: 'vehicle_expense', schedule_c_line: '9' });
    const trip = record({ amount: 58, merchant_name: 'CHEVRON 0209', business_purpose: 'Gas for a full day of Uber driving' });
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '0');
    const off = analysisSuggestionUpdate(gas, 1, trip, undefined, null, { vehicles: savedCars.vehicles, profile: { vehicle_deduction_method: 'standard_mileage' }, taxYear: 2026 });
    vi.unstubAllEnvs();
    const base = analysisSuggestionUpdate(gas, 1, trip);
    expect(off.deductionStatus).toBe('Needs more information');
    expect(off.ai_suggestion.questions[0]).toBe(VEHICLE_METHOD_GATE.question);
    expect(off.ai_suggestion.reasoning).toBe(base.ai_suggestion.reasoning);
    expect(off.ai_suggestion.status).toBe(base.ai_suggestion.status);
    expect(off.ai_missing_fields).toEqual(base.ai_missing_fields);
    expect(JSON.stringify(off.ai_suggestion)).not.toContain(STANDARD_MILEAGE_RUNNING_COST_GATE.question);
  });

  it('several cars and no linked car still need the vehicle method', () => {
    const first = saveVehicle([blankVehicle('legacy-vehicle-1', 0)], 'legacy-vehicle-1', { method: 'standard_mileage', taxYear: 2026 });
    if (!first.ok) throw new Error(first.reason);
    const saved = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
      record({ amount: 58, business_purpose: 'Gas for a full day of Uber driving' }), undefined, null, {
        vehicles: [...first.vehicles, blankVehicle('van', 1)],
      });
    expect(saved.ai_suggestion.status).toBe('needs_more_info');
    expect(saved.ai_suggestion.questions[0]).toBe('Do you use the standard mileage rate or actual expenses for this vehicle?');
    expect(saved.ai_missing_fields).toEqual(['vehicle_method']);
  });

  it('a meal approval at 50% is saved as the approval; any other share is withheld', () => {
    const meal = approval({ category: 'meals_50', deductible_percent: 50, schedule_c_line: '24b' });
    expect(analysisSuggestionUpdate(meal, 1, record({ amount: 64, merchant_name: 'Chipotle' })).ai_suggestion.status).toBe('ok');
    expect(analysisSuggestionUpdate({ ...meal, deductible_percent: 100 }, 1, record({ amount: 64 })).ai_suggestion.status).toBe('needs_more_info');
  });
});
