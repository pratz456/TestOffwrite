import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFPage } from 'pdf-lib';
const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), fail: '' }));
vi.mock('@/lib/firebase/admin', () => {
  function doc(path: string) { return { id: path.split('/').at(-1)!, ref: { path }, exists: state.rows.has(path), data: () => state.rows.get(path), get: async () => doc(path), collection: (name: string) => query(`${path}/${name}`) }; }
  function query(path: string, group = false, filters: [string, unknown][] = []) {
    return { doc: (id: string) => doc(`${path}/${id}`), where: (field: string, _op: string, value: unknown) => query(path, group, [...filters, [field, value]]),
      get: async () => {
        if (state.fail === path) throw Error('private database credentials');
        const docs = [...state.rows].filter(([key, value]) => (group ? key.split('/').at(-2) === path : key.slice(0, key.lastIndexOf('/')) === path)
          && filters.every(([field, wanted]) => value[field] === wanted)).map(([key]) => doc(key));
        return { docs, empty: !docs.length };
      } };
  }
  return { adminDb: { collection: (path: string) => query(path), collectionGroup: (path: string) => query(path, true) } };
});
import { assembleAuditSupportPacket, auditSupportPacketCSV, buildEvidenceRecord, generateAuditSupportPDF, readAuditSupportPacket, retentionNote, substantiationCategory,
  RECEIPT_THRESHOLD, type AuditSupportInputs } from '@/lib/reports/audit-support-packet';
import { ExportDataUnavailableError } from '@/lib/reports/export-records';
import { ExportReviewRequiredError, type ExportRecord } from '@/lib/reports/transaction-export';
import { isServerConfirmedDeduction } from '@/lib/transactions/confirmed-deduction';

const uid = 'owner';
let sequence = 0;
/** A confirmed deduction with valid amount/date; tests override the fields under review. */
function confirmed(fields: Record<string, unknown> = {}): ExportRecord {
  sequence += 1;
  return { userId: uid, trans_id: `tx-${sequence}`, id: `doc-${sequence}`, recordPath: `user_profiles/${uid}/accounts/a/transactions/doc-${sequence}`, exportReference: `transaction-ref${sequence}`,
    date: '2026-03-10', amount: 40, iso_currency_code: 'USD', merchant_name: `Merchant ${sequence}`, category: 'SERVICE_SUBSCRIPTION',
    is_deductible: true, review_status: 'confirmed', review_source: 'user_corrected', reviewed_at: '2026-04-01T12:00:00.000Z',
    user_classification_reason: 'Category reviewed and corrected by user.', ...fields };
}
function packet(transactions: ExportRecord[], extra: Partial<AuditSupportInputs> = {}, year = 2026) {
  return assembleAuditSupportPacket(uid, year, { transactions, trips: [], receipts: [], ...extra }, new Date('2026-09-17T12:00:00Z'));
}
const only = (transactions: ExportRecord[], extra: Partial<AuditSupportInputs> = {}) => packet(transactions, extra).deductions[0];
const trip = (fields: Record<string, unknown> = {}) => ({ id: `trip-${++sequence}`, recordPath: `user_profiles/${uid}/mileage_trips/trip-${sequence}`, date: '2026-03-10', startLocation: 'Home office', endLocation: 'Client site', miles: 12, roundTrip: true, businessPurpose: 'Client kickoff', ...fields });
beforeEach(() => { sequence = 0; state.rows.clear(); state.fail = ''; });

describe('substantiation categories', () => {
  it.each([
    ['FOOD_AND_DRINK_RESTAURANT', 'meal'], ['FOOD_AND_DRINK_COFFEE_SHOP', 'meal'], ['TRAVEL_LODGING', 'lodging'], ['TRAVEL_FLIGHTS', 'travel'], ['TRAVEL_OTHER_TRAVEL', 'travel'],
    ['TRANSPORTATION_RENTAL_CAR', 'travel'], ['TRAVEL_TAXI', 'local_transportation'], ['TRANSPORTATION_RIDESHARE', 'local_transportation'], ['TRANSPORTATION_PUBLIC_TRANSIT', 'local_transportation'],
    ['TRANSPORTATION_FUEL', 'vehicle'], ['TRANSPORTATION_AUTO_PARKING', 'vehicle'], ['TRANSPORTATION_TOLLS', 'vehicle'], ['TRANSPORTATION_AUTO_INSURANCE', 'vehicle'],
    ['GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES', 'gift'], ['SERVICE_SUBSCRIPTION', 'general'], ['GENERAL_MERCHANDISE_COMPUTERS_AND_ELECTRONICS', 'general'], ['PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS', 'general'],
    ['Business meals', 'meal'], ['hotel', 'lodging'], ['', 'general'], [['Travel', 'Airlines'], 'travel'],
  ])('maps recorded category %j to %s', (category, expected) => {
    expect(substantiationCategory(category)).toBe(expected);
  });
});

describe('§274(d) substantiation rules', () => {
  const meal = (fields: Record<string, unknown>) => confirmed({ category: 'FOOD_AND_DRINK_RESTAURANT', business_purpose: 'Contract review with client', attendees: ['A. Client'], ...fields });
  it('applies the $75 documentary-evidence threshold to meals at $75.00, not below', () => {
    expect(RECEIPT_THRESHOLD).toBe(75);
    expect(only([meal({ amount: 74.99 })]).substantiation).toMatchObject({ category: 'meal', status: 'complete', missing: [] });
    const over = only([meal({ amount: 75 })]).substantiation;
    expect(over.status).toBe('needs_records'); expect(over.missing).toEqual(['receipt (business meal of $75 or more)']);
  });
  it('accepts an uploaded receipt referenced by private path and filename, never bytes or storage paths', () => {
    const receipts = [{ id: 'receipt-1', userId: uid, transactionId: 'tx-1', filename: 'dinner.jpg', originalName: 'dinner.jpg', mimeType: 'image/jpeg', size: 10, uploadedAt: new Date('2026-03-11T00:00:00Z'), storagePath: 'receipts/owner/tx-1/receipt-1', imageBase64: 'SECRET_BYTES' }];
    const record = only([meal({ amount: 120 })], { receipts });
    expect(record.substantiation.status).toBe('complete');
    expect(record.receipts).toEqual([{ path: '/api/receipts/receipt-1', filename: 'dinner.jpg', uploadedAt: '2026-03-11T00:00:00.000Z', mimeType: 'image/jpeg', source: 'uploaded' }]);
    expect(JSON.stringify(record)).not.toMatch(/SECRET_BYTES|storagePath|receipts\/owner/);
  });
  it('requires a receipt for lodging at any amount plus destination, dates and purpose', () => {
    const bare = only([confirmed({ category: 'TRAVEL_LODGING', amount: 40 })]).substantiation;
    expect(bare.status).toBe('needs_records');
    expect(bare.missing).toEqual(['receipt (required for lodging at any amount)', 'business purpose', 'travel destination', 'travel dates (departure and return)']);
    const complete = only([confirmed({ category: 'TRAVEL_LODGING', amount: 40, receipt_url: '/api/receipts/hotel', receipt_filename: 'hotel.pdf', business_purpose: 'Client onsite', travel_destination: 'Austin, TX, 2026-03-09 to 2026-03-11' })]);
    expect(complete.substantiation.status).toBe('complete'); expect(complete.travel).toEqual({ destination: 'Austin, TX, 2026-03-09 to 2026-03-11', datesRecorded: true });
    expect(complete.receipts[0]).toMatchObject({ path: '/api/receipts/hotel', filename: 'hotel.pdf', source: 'legacy_link' });
  });
  it('requires travel dates and purpose, recognizing dates written into the destination note', () => {
    const missing = only([confirmed({ category: 'TRAVEL_FLIGHTS', amount: 320, travel_destination: 'Denver' })]).substantiation.missing;
    expect(missing).toEqual(['receipt (travel away from home of $75 or more)', 'business purpose', 'travel dates (departure and return)']);
    const dated = only([confirmed({ category: 'TRAVEL_FLIGHTS', amount: 60, business_purpose: 'Conference talk', travel_destination: 'Denver, Mar 3-5' })]);
    expect(dated.substantiation).toMatchObject({ status: 'complete', missing: [] });
  });
  it('requires a mileage log for vehicle operating costs and a same-day trip entry for parking and tolls', () => {
    const fuel = confirmed({ category: 'TRANSPORTATION_FUEL', amount: 52 });
    expect(only([fuel]).substantiation.missing).toEqual(['mileage log for 2026 (business miles for each use and total miles for the year)']);
    const logged = only([fuel], { trips: [trip({ date: '2026-06-01' })] });
    expect(logged.substantiation.status).toBe('complete'); expect(logged.substantiation.advisories.join(' ')).toContain('not deductible in addition to the standard mileage rate');
    const parking = confirmed({ category: 'TRANSPORTATION_AUTO_PARKING', amount: 18, business_purpose: 'Client meeting parking' });
    expect(only([parking], { trips: [trip({ date: '2026-06-01' })] }).substantiation.missing).toEqual(['mileage log entry for this trip (date, destination, miles)']);
    const sameDay = only([parking], { trips: [trip({ date: '2026-03-10' })] });
    expect(sameDay.substantiation.status).toBe('complete'); expect(sameDay.linkedTrips).toBe(1);
    expect(only([confirmed({ category: 'TRANSPORTATION_TOLLS', amount: 6, mileage_details: { start_location: 'Office', end_location: 'Client', miles: 14, business_purpose: 'Site visit' } })]).substantiation.status).toBe('complete');
  });
  it('requires attendees and purpose for meals unless the meal is recorded as a travel meal', () => {
    const bare = only([confirmed({ category: 'FOOD_AND_DRINK_RESTAURANT', amount: 30 })]).substantiation;
    expect(bare.missing).toEqual(['business purpose', 'attendees and business relationship (or the travel destination for a meal while traveling)']);
    expect(bare.advisories).toContain('Business meals are generally limited to 50% of the recorded amount.');
    expect(only([confirmed({ category: 'FOOD_AND_DRINK_RESTAURANT', amount: 30, business_purpose: 'Dinner while at client onsite', travel_destination: 'Austin' })]).substantiation.status).toBe('complete');
  });
  it('requires recipient and business relationship for gifts', () => {
    expect(only([confirmed({ category: 'GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES', amount: 24, business_purpose: 'Thank-you gift' })]).substantiation.missing).toEqual(['recipient and business relationship']);
    expect(only([confirmed({ category: 'GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES', amount: 24, business_purpose: 'Thank-you gift', client_project: 'Acme launch' })]).substantiation.status).toBe('complete');
  });
  it('treats ordinary expenses as complete with advisories instead of §274(d) missing items', () => {
    const record = only([confirmed({ category: 'SERVICE_SUBSCRIPTION', amount: 500 })]);
    expect(record.substantiation).toMatchObject({ category: 'general', strict: false, status: 'complete', missing: [] });
    expect(record.substantiation.advisories).toEqual([
      'Receipt or invoice recommended for an expense of $75 or more.',
      'No business-purpose note. §274(d) does not apply, but add one when the purpose is not evident from the merchant and category.',
    ]);
  });
  it('accepts a declared receipt kept outside the app, the owner review note as purpose, and reports mixed use', () => {
    const record = only([confirmed({ category: 'TRAVEL_OTHER_TRAVEL', amount: 90, documentation_status: 'complete', user_classification_reason: 'Train to client site in Boston on 2026-03-10', travel_destination: 'Boston', business_percent: 80 })]);
    expect(record.substantiation.status).toBe('complete');
    expect(record.receiptDeclaredOutsideApp).toBe(true); expect(record.receipts).toEqual([]);
    expect(record.businessPurpose).toEqual({ text: 'Train to client site in Boston on 2026-03-10', source: 'owner_review_note' });
    expect(record.businessUsePercent).toBe(80);
    expect(record.substantiation.advisories).toEqual(expect.arrayContaining([expect.stringContaining('kept outside WriteOff'), expect.stringContaining('Mixed-use allocation of 80%')]));
  });
  it('never treats the boilerplate review reason as a business purpose', () => {
    expect(only([confirmed({ category: 'TRAVEL_TAXI', amount: 20 })]).businessPurpose).toEqual({ text: null, source: null });
    expect(only([confirmed({ category: 'TRAVEL_TAXI', amount: 20, review_source: 'ai_confirmed', user_classification_reason: 'Rideshare charges are commonly business transportation.' })]).businessPurpose).toEqual({ text: null, source: null });
  });
});

describe('inclusion, exclusion and review provenance', () => {
  it('includes only confirmed deductible records and counts each exclusion reason', () => {
    const result = packet([
      confirmed({ merchant_name: 'INCLUDED' }),
      confirmed({ merchant_name: 'NOT-CONFIRMED', review_status: undefined, review_source: undefined }),
      confirmed({ merchant_name: 'SUGGESTED-ONLY', is_deductible: null, ai_suggestion: { id: 's1', reasoning: 'AI_SUGGESTION_TEXT', isDeductible: true } }),
      confirmed({ merchant_name: 'REVIEW-REQUIRED', tax_review_required: true }),
      confirmed({ merchant_name: 'REVIEW-CATEGORY', category: 'VEHICLE_REVIEW_REQUIRED' }),
      confirmed({ merchant_name: 'PENDING', pending: true }),
      confirmed({ merchant_name: 'REMOVED', bank_removed: true }),
      confirmed({ merchant_name: 'PERSONAL', is_deductible: false }),
      confirmed({ merchant_name: 'PRIOR-YEAR', date: '2025-12-31' }),
    ]);
    expect(result.deductions.map(record => record.merchant)).toEqual(['INCLUDED']);
    expect(result.summary.excluded).toEqual({ notConfirmed: 1, reviewRequired: 2, pending: 1, bankRemoved: 1 });
    expect(JSON.stringify(result)).not.toMatch(/AI_SUGGESTION_TEXT|SUGGESTED-ONLY|PRIOR-YEAR|PERSONAL/);
  });
  it('shares the Schedule C confirmation contract: legacy pre-cutoff decisions count, unstamped post-cutoff ones do not', () => {
    const legacy = confirmed({ merchant_name: 'LEGACY', review_status: undefined, review_source: undefined, reviewed_at: undefined, created_at: '2026-03-10T09:00:00.000Z' });
    const unstamped = confirmed({ merchant_name: 'UNSTAMPED', review_status: undefined, review_source: undefined, reviewed_at: undefined, created_at: '2026-09-20T09:00:00.000Z' });
    const result = packet([legacy, unstamped]);
    expect(isServerConfirmedDeduction(legacy)).toBe(true);
    expect(isServerConfirmedDeduction(unstamped)).toBe(false);
    expect(result.deductions.map(record => record.merchant)).toEqual(['LEGACY']);
    expect(result.deductions[0].review.label).toBe('Owner confirmation (source not recorded)');
    expect(result.summary.excluded.notConfirmed).toBe(1);
  });
  it('records the review timestamp and whether the owner confirmed an AI suggestion or classified directly', () => {
    const [ai, owner, legacy] = packet([
      confirmed({ review_source: 'ai_confirmed', reviewed_at: '2026-04-01T12:00:00.000Z', user_classification_reason: 'Recurring software used for client work.', date: '2026-01-01' }),
      confirmed({ review_source: 'user_corrected', reviewed_at: new Date('2026-04-02T12:00:00Z'), user_classification_reason: 'Hosting for the client portal.', date: '2026-01-02' }),
      confirmed({ review_source: undefined, reviewed_at: undefined, date: '2026-01-03' }),
    ]).deductions;
    expect(ai.review).toEqual({ status: 'confirmed', source: 'ai_confirmed', label: 'AI suggestion confirmed by owner', reviewedAt: '2026-04-01T12:00:00.000Z', note: 'Recurring software used for client work.' });
    expect(owner.review).toMatchObject({ source: 'user_corrected', label: 'Owner classification', reviewedAt: '2026-04-02T12:00:00.000Z' });
    expect(legacy.review).toMatchObject({ source: 'unknown', label: 'Owner confirmation (source not recorded)', reviewedAt: null });
  });
  it('carries the archive reference and owner-only detail link while excluding secrets and AI output', () => {
    const record = only([confirmed({ trans_id: 'PROVIDER-ID', exportReference: 'transaction-abc', access_token: 'SECRET_TOKEN', ai_analysis: 'SECRET_AI', deduction_score: 0.9, ssn: 'SECRET_SSN', stripeCustomerId: 'SECRET_STRIPE' })]);
    expect(record.reference).toBe('transaction-abc'); expect(record.transactionId).toBe('PROVIDER-ID');
    expect(record.detailPath).toBe('/protected?screen=transaction-detail&transactionId=PROVIDER-ID&from=reports');
    expect(JSON.stringify(record)).not.toMatch(/SECRET_|deduction_score|ai_analysis/);
  });
  it('requires review instead of guessing for duplicates, invalid amounts, foreign currency and undated records', () => {
    expect(() => packet([confirmed({ trans_id: 'same' }), confirmed({ trans_id: 'same' })])).toThrow(ExportReviewRequiredError);
    expect(() => packet([confirmed({ amount: 'unknown' })])).toThrow(/invalid amount/);
    expect(() => packet([confirmed({ iso_currency_code: 'EUR' })])).toThrow(/Non-USD/);
    expect(() => packet([confirmed(), confirmed({ is_deductible: false, date: undefined })])).toThrow(ExportReviewRequiredError);
  });
});

describe('totals, mileage log and retention', () => {
  it('summarizes recorded amounts by status and category, nets credits, and counts missing items', () => {
    const result = packet([
      confirmed({ category: 'FOOD_AND_DRINK_RESTAURANT', amount: 100 }),
      confirmed({ category: 'FOOD_AND_DRINK_RESTAURANT', amount: 20, business_purpose: 'Pitch lunch', attendees: ['B. Prospect'] }),
      confirmed({ category: 'SERVICE_SUBSCRIPTION', amount: 30 }),
      confirmed({ category: 'SERVICE_SUBSCRIPTION', amount: -10 }),
    ]);
    expect(result.summary).toMatchObject({ deductionCount: 4, recordedAmount: 140,
      byStatus: { complete: { count: 3, amount: 40 }, needs_records: { count: 1, amount: 100 } } });
    expect(result.summary.byCategory).toEqual([
      { category: 'meal', label: 'Business meal', count: 2, amount: 120, complete: 1, needsRecords: 1 },
      { category: 'general', label: 'Ordinary business expense', count: 2, amount: 20, complete: 2, needsRecords: 0 },
    ]);
    expect(result.summary.missingItems).toEqual([
      { item: 'attendees and business relationship (or the travel destination for a meal while traveling)', count: 1 },
      { item: 'business purpose', count: 1 }, { item: 'receipt (business meal of $75 or more)', count: 1 },
    ]);
    const credit = result.deductions.find(record => record.amount === -10)!;
    expect(credit.direction).toBe('credit'); expect(credit.substantiation.missing).toEqual([]);
  });
  it('lists mileage trips at the IRS rate for each trip date and flags trips missing elements', () => {
    const result = packet([], { trips: [trip({ date: '2026-03-10', miles: 100 }), trip({ date: '2026-08-01', miles: 10, businessPurpose: '' }), trip({ date: '2025-12-31', miles: 500 }), trip({ date: 'invalid', miles: 5 })] });
    expect(result.mileageLog.trips).toHaveLength(2); expect(result.mileageLog.undatedTrips).toBe(1);
    expect(result.mileageLog.trips[0]).toMatchObject({ date: '2026-03-10', miles: 100, ratePerMile: 0.725, standardMileageAmount: 72.5, roundTrip: true, substantiation: { status: 'complete', missing: [] } });
    expect(result.mileageLog.trips[0].reference).toMatch(/^trip-[0-9a-f]{16}$/); expect(result.mileageLog.trips[0].rateSource).toMatch(/^https:\/\/www\.irs\.gov\//);
    expect(result.mileageLog.trips[1]).toMatchObject({ ratePerMile: 0.76, standardMileageAmount: 7.6, substantiation: { status: 'needs_records', missing: ['business purpose'] } });
    expect(result.summary.mileage).toEqual({ tripCount: 2, ratedMiles: 110, unratedMiles: 0, unratedTrips: 0, standardMileageAmount: 80.1, ratesApplied: [0.725, 0.76], tripsNeedingRecords: 1 });
    expect(result.sources).toEqual(expect.arrayContaining(['https://www.irs.gov/pub/irs-drop/n-26-10.pdf', 'https://www.irs.gov/irb/2026-29_irb']));
  });
  it('reports trips without a published rate instead of guessing', () => {
    const result = packet([], { trips: [trip({ date: '2027-02-01', miles: 40 })] }, 2027);
    expect(result.mileageLog.trips[0]).toMatchObject({ ratePerMile: null, standardMileageAmount: null });
    expect(result.summary.mileage).toMatchObject({ unratedMiles: 40, unratedTrips: 1, standardMileageAmount: 0 });
  });
  it('states the Pub 583 retention table anchored to the selected year', () => {
    const note = retentionNote(2026);
    expect(note.returnDueDate).toBe('2027-04-15');
    expect(note.rows.map(row => [row.period, row.keepUntil])).toEqual([
      ['3 years', '2030-04-15'], ['6 years', '2033-04-15'], ['7 years', '2034-04-15'], ['Later of 3 years from filing or 2 years from payment', 'Depends on the claim'],
      ['No limit', 'Indefinitely'], ['At least 4 years after the tax is due or paid', 'At least 4 years'], ['Until the limitations period expires for the year of disposition', 'Disposition year plus its period'],
    ]);
    expect(note.notes.join(' ')).toMatch(/Cohan rule\) are not accepted for travel, vehicle and gift/);
    expect(note.source).toBe('https://www.irs.gov/publications/p583');
    expect(packet([]).retention).toEqual(note);
  });
  it('keeps the cover note within the claims policy', () => {
    const result = packet([]);
    const text = [result.packetInfo.title, result.packetInfo.purpose, ...result.coverNote].join(' ');
    expect(result.packetInfo.title).toBe('Audit support records - Tax year 2026');
    expect(text).toContain('not audit representation'); expect(text).toContain('not attached');
    expect(text).not.toMatch(/audit defense|audit protection|guaranteed|maximize|every deduction/i);
    expect(result.packetInfo.receiptBinariesIncluded).toBe(false);
  });
});

describe('CSV, PDF and owner-scoped loading', () => {
  const inputs = () => ({
    transactions: [confirmed({ trans_id: 'PROVIDER-ID', exportReference: 'transaction-abc', merchant_name: '=HYPERLINK("bad")', category: 'TRAVEL_LODGING', amount: 180 })],
    trips: [trip({ date: '2026-03-10', miles: 100 })], receipts: [],
  });
  it('exports deductions and trips with hashed references only and formula-safe text', () => {
    const csv = auditSupportPacketCSV(packet(inputs().transactions, inputs()));
    const lines = csv.split('\r\n'); expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Record Type,Reference,Date,Merchant / Trip'); expect(lines[0]).toContain('Private Receipt Paths (sign-in required)');
    expect(lines[1]).toContain('Confirmed deduction,transaction-abc,2026-03-10,"\'=HYPERLINK(""bad"")",180,TRAVEL_LODGING,24a,Lodging while traveling,Needs records,');
    expect(lines[1]).toContain('receipt (required for lodging at any amount); business purpose; travel destination; travel dates (departure and return)');
    expect(lines[2]).toMatch(/^Mileage trip,trip-[0-9a-f]{16},2026-03-10,Home office -> Client site \(round trip\),72\.5,Mileage log,9,Vehicle,Complete,/);
    expect(csv).not.toContain('PROVIDER-ID');
  });
  it('prints the cover note, a deduction line with its missing records, the mileage log and retention table in bounds', async () => {
    const spy = vi.spyOn(PDFPage.prototype, 'drawText');
    const bytes = await generateAuditSupportPDF(packet(inputs().transactions, inputs()));
    // Table cells wrap across drawText calls; compare on whitespace-normalized text.
    const text = spy.mock.calls.map(call => call[0]).join(' ').replace(/\s+/g, ' ');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(2);
    expect(text).toContain('Audit support records - Tax year 2026'); expect(text).toContain('NOT FOR FILING');
    expect(text).toContain('not audit representation'); expect(text).toContain('$180.00'); expect(text).toContain('=HYPERLINK("bad")');
    expect(text).toContain('Needs records: receipt (required for lodging at any amount); business purpose; travel destination; travel dates (departure and return)');
    expect(text).toContain('transaction-abc'); expect(text).toContain('Logged trips this date: 1'); expect(text).toContain('Reviewed: 2026-04-01 - Owner classification');
    expect(text).toContain('Home office -> Client site (round trip)'); expect(text).toContain('$72.50'); expect(text).toContain('2030-04-15');
    expect(text).not.toContain('PROVIDER-ID'); expect(text).not.toMatch(/audit defense|audit protection/i);
    for (const [value, options] of spy.mock.calls) {
      expect(options!.y!, value).toBeGreaterThanOrEqual(20); expect(options!.y!, value).toBeLessThanOrEqual(766);
      expect(options!.x!, value).toBeGreaterThanOrEqual(42); expect(options!.x! + options!.font!.widthOfTextAtSize(value, options!.size!), value).toBeLessThanOrEqual(571);
    }
    spy.mockRestore();
  });
  it('loads only the owner transactions, trips and receipt metadata, and fails closed on unreadable or conflicting records', async () => {
    state.rows.set(`user_profiles/${uid}/accounts/a`, { name: 'Checking' });
    state.rows.set(`user_profiles/${uid}/accounts/a/transactions/meal`, { userId: uid, trans_id: 'meal-1', date: '2026-05-05', amount: 90, iso_currency_code: 'USD', category: 'FOOD_AND_DRINK_RESTAURANT', is_deductible: true, review_status: 'confirmed', business_purpose: 'Client lunch', attendees: ['C. Client'] });
    state.rows.set(`user_profiles/${uid}/mileage_trips/one`, { userId: uid, date: '2026-05-05', startLocation: 'A', endLocation: 'B', miles: 3, businessPurpose: 'Lunch trip' });
    state.rows.set('receipts/r1', { userId: uid, transactionId: 'meal-1', filename: 'lunch.png', mimeType: 'image/png', storagePath: 'receipts/owner/meal-1/r1', dataUrl: 'data:image/png;base64,SECRET' });
    state.rows.set('receipts/foreign', { userId: 'someone-else', transactionId: 'meal-1', filename: 'foreign.png' });
    const result = await readAuditSupportPacket(uid, 2026);
    expect(result.deductions).toHaveLength(1);
    expect(result.deductions[0]).toMatchObject({ substantiation: { status: 'complete' }, linkedTrips: 1, receipts: [{ path: '/api/receipts/r1', filename: 'lunch.png', source: 'uploaded' }] });
    expect(result.summary.mileage.tripCount).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/SECRET|foreign|storagePath/);
    state.fail = `user_profiles/${uid}/mileage_trips`;
    await expect(readAuditSupportPacket(uid, 2026)).rejects.toBeInstanceOf(ExportDataUnavailableError);
    state.fail = '';
    state.rows.set('receipts/conflict', { userId: uid, user_id: 'someone-else', transactionId: 'meal-1' });
    await expect(readAuditSupportPacket(uid, 2026)).rejects.toBeInstanceOf(ExportDataUnavailableError);
  });
  it('builds evidence records directly from an owner record', () => {
    const record = buildEvidenceRecord(confirmed({ exportReference: undefined, recordPath: 'user_profiles/owner/accounts/a/transactions/x' }), { uid, tripsByDate: new Map(), yearTripCount: 0, receiptsByTransaction: new Map() });
    expect(record.reference).toMatch(/^transaction-[0-9a-f]{16}$/);
  });
});
