import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
import { ACTUAL_EXPENSE_BUSINESS_SHARE } from '@/lib/ai/actual-expense-share';
import { HIRED_FARE_PERSONAL, HIRED_FARE_PURPOSE, HIRED_FARE_USE, hiredFareUsePrompt, SEPARATE_VEHICLE_COST_SHARE } from '@/lib/ai/vehicle-separate-costs';
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

  it('car loan interest and vehicle personal property tax count only at the recorded business-use share', () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const savedCars = saveVehicle([blankVehicle('legacy-vehicle-1', 0)], 'legacy-vehicle-1', { method: 'standard_mileage', taxYear: 2026 });
    if (!savedCars.ok) throw new Error(savedCars.reason);
    const facts = { vehicles: savedCars.vehicles, taxYear: 2026, vehicleId: 'legacy-vehicle-1' };
    const interest = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9', evidence_ids: ['travel-463'] }), 1,
      record({ amount: 180, merchant_name: 'Toyota Financial', business_purpose: 'Interest on the car loan for business miles' }), undefined, null, facts);
    const propertyTax = analysisSuggestionUpdate(approval({ category: 'taxes_licenses', schedule_c_line: '23', evidence_ids: ['taxes-licenses-sch-c'] }), 1,
      record({ amount: 90, merchant_name: 'County Treasurer', business_purpose: 'Personal property tax on the car' }), undefined, null, facts);
    expect(interest.deductionStatus).toBe('Needs more information');
    expect(interest.ai_suggestion.questions[0]).toBe(SEPARATE_VEHICLE_COST_SHARE.question);
    expect(interest.ai_suggestion.reasoning).toBe(SEPARATE_VEHICLE_COST_SHARE.reason);
    expect(interest.ai_suggestion.deductiblePercent).toBeNull();
    expect(interest.deductionStatus).not.toBe('Likely Deductible');
    expect(propertyTax.ai_suggestion.questions[0]).toBe(SEPARATE_VEHICLE_COST_SHARE.question);
    expect(propertyTax.ai_suggestion.deductiblePercent).toBeNull();
    const withShare = savedCars.vehicles.map(vehicle => ({ ...vehicle, legacyBusinessUsePercentage: 40 }));
    const sharedFacts = { vehicles: withShare, taxYear: 2026, vehicleId: 'legacy-vehicle-1' };
    for (const method of ['standard_mileage', 'actual_expense'] as const) {
      const cars = withShare.map(vehicle => ({ ...vehicle, method, methodByYear: { '2026': method } }));
      const methodFacts = { vehicles: cars, taxYear: 2026, vehicleId: 'legacy-vehicle-1' };
      const sharedInterest = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
        record({ amount: 180, merchant_name: 'Toyota Financial', business_purpose: 'Interest on the car loan for business miles' }), undefined, null, methodFacts);
      const sharedTax = analysisSuggestionUpdate(approval({ category: 'taxes_licenses', deductible_percent: 100, schedule_c_line: '23' }), 1,
        record({ amount: 90, merchant_name: 'County Treasurer', business_purpose: 'Personal property tax on the car' }), undefined, null, methodFacts);
      expect(sharedInterest.deductionStatus).toBe('Likely Deductible');
      expect(sharedInterest.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, deductiblePercent: 40, category: 'vehicle_expense' });
      expect(sharedInterest.ai_suggestion.questions.join(' ')).not.toContain(STANDARD_MILEAGE_RUNNING_COST_GATE.question);
      expect(sharedTax.deductionStatus).toBe('Likely Deductible');
      expect(sharedTax.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, deductiblePercent: 40, category: 'taxes_licenses' });
      for (const [merchant, purpose] of [['PARKMOBILE', 'Parking at the client site'], ['EZ PASS', 'Toll on the way to the client']] as const) {
        const allowed = analysisSuggestionUpdate(approval({ category: 'parking_tolls', schedule_c_line: '9' }), 1,
          record({ amount: 18, merchant_name: merchant, business_purpose: purpose }), undefined, null, methodFacts);
        expect(allowed.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, deductiblePercent: 100, category: 'parking_tolls' });
        expect(allowed.deductionStatus).toBe('Likely Deductible');
      }
    }
    const fullShare = withShare.map(vehicle => ({ ...vehicle, legacyBusinessUsePercentage: 100 }));
    const fullInterest = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
      record({ amount: 180, merchant_name: 'Toyota Financial', business_purpose: 'Interest on the car loan for business miles' }), undefined, null,
      { vehicles: fullShare, taxYear: 2026, vehicleId: 'legacy-vehicle-1' });
    expect(fullInterest.ai_suggestion.deductiblePercent).toBe(100);
    const payment = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
      record({ amount: 420, merchant_name: 'Toyota Financial', business_purpose: 'Car loan payment for the work car' }), undefined, null, sharedFacts);
    expect(payment.deductionStatus).toBe('Needs more information');
    expect(payment.ai_suggestion.questions[0]).toBe(STANDARD_MILEAGE_RUNNING_COST_GATE.question);
    vi.unstubAllEnvs();
    const off = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
      record({ amount: 180, merchant_name: 'Toyota Financial', business_purpose: 'Interest on the car loan for business miles' }), undefined, null, sharedFacts);
    expect(off.deductionStatus).toBe('Needs more information');
    expect(off.ai_suggestion.questions[0]).toBe(VEHICLE_METHOD_GATE.question);
    expect(off.deductionStatus).not.toBe('Likely Deductible');
  });

  it('a hired fare follows the trip purpose and not the method of the user car', () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const savedCars = saveVehicle([blankVehicle('legacy-vehicle-1', 0)], 'legacy-vehicle-1', { method: 'standard_mileage', taxYear: 2026 });
    if (!savedCars.ok) throw new Error(savedCars.reason);
    const withShare = savedCars.vehicles.map(vehicle => ({ ...vehicle, legacyBusinessUsePercentage: 40 }));
    const facts = { vehicles: withShare, taxYear: 2026, vehicleId: 'legacy-vehicle-1' };
    for (const merchant of ['Uber', 'Lyft', 'TAXI SVC']) {
      const fare = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9', deductible_percent: 40 }), 1,
        record({ amount: 28, merchant_name: merchant, business_purpose: 'Ride to the client meeting' }), undefined, null, facts);
      expect(fare.deductionStatus).toBe('Needs more information');
      expect(fare.ai_schedule_c_line).toBeNull();
      expect(fare.ai.schedule_c_line).toBeNull();
      expect(fare.ai_suggestion.scheduleCLine).toBeUndefined();
      expect(fare.ai_suggestion.category).toBeNull();
      expect(fare.ai_suggestion.questions).toEqual(hiredFareUsePrompt(null));
      expect(fare.ai_suggestion.questions[0]).toBe(HIRED_FARE_USE.question);
      expect(fare.ai_suggestion.questions).toContain(HIRED_FARE_USE.between);
      expect(fare.ai_suggestion.questions.join(' ')).not.toContain('27b');
      expect(JSON.stringify(fare.ai_explanation)).not.toContain('24a');
      expect(JSON.stringify(fare.ai_explanation)).not.toContain('27b');
      expect(fare.ai_suggestion.questions.join(' ')).not.toContain(STANDARD_MILEAGE_RUNNING_COST_GATE.question);
      expect(fare.ai_suggestion.questions.join(' ')).not.toContain(ACTUAL_EXPENSE_BUSINESS_SHARE.question);
    }
    const overnightPurpose = HIRED_FARE_USE.overnight;
    for (const merchant of ['Uber', 'Lyft', 'Yellow Taxi']) {
      const overnight = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9', deductible_percent: 40 }), 1,
        record({ amount: 28, merchant_name: merchant, business_purpose: overnightPurpose }), undefined, null, facts);
      expect(overnight.deductionStatus).toBe('Likely Deductible');
      expect(overnight.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, deductiblePercent: 100, category: 'travel', scheduleCLine: '24a' });
      expect(overnight.ai_schedule_c_line).toBe('24a');
    }
    const commute = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
      record({ amount: 16, merchant_name: 'Uber', business_purpose: 'Commuting to my regular workplace' }), undefined, null, facts);
    expect(commute.deductionStatus).toBe('Unlikely Deductible');
    expect(commute.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: false, deductiblePercent: 0, category: 'travel' });
    expect(commute.ai_schedule_c_line).toBeNull();
    const actualCars = withShare.map(vehicle => ({ ...vehicle, method: 'actual_expense' as const, methodByYear: { '2026': 'actual_expense' as const } }));
    const actualFare = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', deductible_percent: 40, schedule_c_line: '9' }), 1,
      record({ amount: 28, merchant_name: 'Uber', business_purpose: overnightPurpose }), undefined, null,
      { vehicles: actualCars, taxYear: 2026, vehicleId: 'legacy-vehicle-1' });
    expect(actualFare.ai_suggestion).toMatchObject({ status: 'ok', deductiblePercent: 100, category: 'travel', scheduleCLine: '24a' });
    const personal = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
      record({ amount: 18, merchant_name: 'Uber', business_purpose: 'Ride home from a concert' }), undefined, null, facts);
    expect(personal.deductionStatus).toBe('Unlikely Deductible');
    expect(personal.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: false, deductiblePercent: 0, category: 'travel' });
    expect(personal.ai_suggestion.reasoning).toBe(HIRED_FARE_PERSONAL.reason);
    expect(personal.ai_schedule_c_line).toBeNull();
    expect(personal.ai_suggestion.scheduleCLine).toBeUndefined();
    const unstated = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
      record({ amount: 18, merchant_name: 'Lyft', business_purpose: 'Ride across town tonight' }), undefined, null, facts);
    expect(unstated.deductionStatus).toBe('Needs more information');
    expect(unstated.ai_suggestion.questions[0]).toBe(HIRED_FARE_PURPOSE.question);
    expect(unstated.ai_schedule_c_line).toBeNull();
    expect(unstated.ai_suggestion.scheduleCLine).toBeUndefined();
    expect(JSON.stringify(unstated.ai_explanation)).not.toContain('24a');
    expect(unstated.ai_missing_fields).toEqual(['business_purpose']);
    const meal = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
      record({ amount: 24, merchant_name: 'UBER EATS', business_purpose: 'Dinner delivered while finishing a client proposal' }), undefined, null, facts);
    expect(meal.ai_suggestion.category).toBe('meals_50');
    expect(meal.ai_suggestion.questions.join(' ')).not.toContain(STANDARD_MILEAGE_RUNNING_COST_GATE.question);
    const gas = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
      record({ amount: 58, merchant_name: 'CHEVRON 0209', business_purpose: 'Gas for a full day of Uber driving' }), undefined, null, facts);
    expect(gas.deductionStatus).toBe('Needs more information');
    expect(gas.ai_suggestion.questions[0]).toBe(STANDARD_MILEAGE_RUNNING_COST_GATE.question);
    vi.unstubAllEnvs();
    const off = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
      record({ amount: 28, merchant_name: 'Uber', business_purpose: 'Ride to the client meeting' }), undefined, null, facts);
    expect(off.ai_suggestion.questions[0]).toBe(VEHICLE_METHOD_GATE.question);
    expect(off.ai_suggestion.category).toBe('vehicle_expense');
  });

  it('a hired fare uses one question and files only the chosen answer', () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const fare = (purpose: string, patch: Record<string, unknown> = {}, profile: Record<string, unknown> | null = null) => analysisSuggestionUpdate(
      approval({ category: 'vehicle_expense', schedule_c_line: '9', deductible_percent: 40 }), 1,
      record({ amount: 28, merchant_name: 'Uber', business_purpose: purpose, ...patch }), undefined, profile, null);
    const overnight = fare(HIRED_FARE_USE.overnight);
    expect(overnight.deductionStatus).toBe('Likely Deductible');
    expect(overnight.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, deductiblePercent: 100, category: 'travel', scheduleCLine: '24a' });
    expect(overnight.ai_schedule_c_line).toBe('24a');
    const between = fare(HIRED_FARE_USE.between, { mileage_details: { start_location: 'Client office', end_location: 'Second workplace' } });
    expect(between.deductionStatus).toBe('Likely Deductible');
    expect(between.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, deductiblePercent: 100, scheduleCLine: '27a' });
    expect(between.ai_suggestion.category).toBeNull();
    expect(between.ai_schedule_c_line).toBe('27a');
    expect(between.ai_suggestion.scheduleCLine).not.toBe('24a');
    const commute = fare(HIRED_FARE_USE.commute);
    expect(commute.deductionStatus).toBe('Unlikely Deductible');
    expect(commute.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: false, deductiblePercent: 0 });
    expect(commute.ai_schedule_c_line).toBeNull();
    expect(commute.ai_suggestion.scheduleCLine).toBeUndefined();
    const personal = fare(HIRED_FARE_USE.personal);
    expect(personal.deductionStatus).toBe('Unlikely Deductible');
    expect(personal.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: false, deductiblePercent: 0, reasoning: HIRED_FARE_PERSONAL.reason });
    expect(personal.ai_schedule_c_line).toBeNull();
    expect(personal.ai_suggestion.scheduleCLine).toBeUndefined();
    const unanswered = fare('Ride to the client meeting');
    expect(unanswered.deductionStatus).toBe('Needs more information');
    expect(unanswered.ai_schedule_c_line).toBeNull();
    expect(unanswered.ai_suggestion.questions).toEqual(hiredFareUsePrompt(null));
    const homeOffice = fare('Ride to the client meeting', {}, { home_office: true });
    expect(homeOffice.ai_suggestion.questions).toEqual(hiredFareUsePrompt({ home_office: true }));
    expect(homeOffice.ai_suggestion.questions).toContain(HIRED_FARE_USE.betweenWithHomeOffice);
    expect(homeOffice.ai_suggestion.questions).not.toContain(HIRED_FARE_USE.between);
    const fromHome = fare(HIRED_FARE_USE.between, { mileage_details: { start_location: 'Home' } });
    expect(fromHome.deductionStatus).toBe('Needs more information');
    expect(fromHome.ai_schedule_c_line).toBeNull();
    expect(fromHome.ai_suggestion.questions[0]).toBe(HIRED_FARE_USE.question);
    expect(fromHome.ai_suggestion.reasoning).toBe(HIRED_FARE_USE.homeStartReason);
    const fromHomeWithOffice = fare(HIRED_FARE_USE.betweenWithHomeOffice, { mileage_details: { start_location: 'Home' } }, { home_office: true });
    expect(fromHomeWithOffice.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, deductiblePercent: 100, scheduleCLine: '27a' });
    vi.unstubAllEnvs();
  });

  it('actual expenses use the recorded business share and ask when it is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', '1');
    const savedCars = saveVehicle([blankVehicle('legacy-vehicle-1', 0)], 'legacy-vehicle-1', { method: 'actual_expense', taxYear: 2026 });
    if (!savedCars.ok) throw new Error(savedCars.reason);
    const gas = approval({ category: 'vehicle_expense', schedule_c_line: '9',
      customized_reason: 'You noted: Gas for the work car. Fuel for business driving is deductible on Schedule C line 9.' });
    const trip = record({ amount: 100, merchant_name: 'CHEVRON 0209', business_purpose: 'Gas for the work car' });
    const asked = analysisSuggestionUpdate(gas, 1, trip, undefined, null, { vehicles: savedCars.vehicles, taxYear: 2026 });
    expect(asked.deductionStatus).toBe('Needs more information');
    expect(asked.ai_suggestion.questions[0]).toBe(ACTUAL_EXPENSE_BUSINESS_SHARE.question);
    expect(asked.ai_suggestion.reasoning).toBe(ACTUAL_EXPENSE_BUSINESS_SHARE.reason);
    expect(asked.ai_missing_fields).toEqual(['business_use_percentage']);
    expect(asked.ai_suggestion.questions.join(' ')).not.toContain(VEHICLE_METHOD_GATE.question);
    const withShare = savedCars.vehicles.map(vehicle => ({ ...vehicle, legacyBusinessUsePercentage: 40 }));
    for (const [merchant, purpose] of [['CHEVRON 0209', 'Gas for the work car'], ['JIFFY LUBE', 'Oil change on the work car'], ['GEICO', 'Car insurance for the work car']] as const) {
      const saved = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', schedule_c_line: '9' }), 1,
        record({ amount: 100, merchant_name: merchant, business_purpose: purpose }), undefined, null, { vehicles: withShare, taxYear: 2026 });
      expect(saved.deductionStatus).toBe('Likely Deductible');
      expect(saved.ai_suggestion).toMatchObject({ status: 'ok', isDeductible: true, deductiblePercent: 40, category: 'vehicle_expense' });
      expect(saved.ai_suggestion.questions.join(' ')).not.toContain(VEHICLE_METHOD_GATE.question);
    }
    const fromCharge = analysisSuggestionUpdate(approval({ category: 'vehicle_expense', deductible_percent: 100, schedule_c_line: '9' }), 1,
      record({ amount: 100, merchant_name: 'CHEVRON 0209', business_purpose: 'Gas for the work car', business_use_percentage: 25 }), undefined, null, { vehicles: withShare, taxYear: 2026 });
    expect(fromCharge.ai_suggestion.deductiblePercent).toBe(25);
    expect(fromCharge.deductionStatus).toBe('Likely Deductible');
    vi.unstubAllEnvs();
    const off = analysisSuggestionUpdate(gas, 1, trip, undefined, null, { vehicles: withShare, taxYear: 2026 });
    expect(off.deductionStatus).toBe('Needs more information');
    expect(off.ai_suggestion.questions[0]).toBe(VEHICLE_METHOD_GATE.question);
    expect(off.deductionStatus).not.toBe('Likely Deductible');
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
