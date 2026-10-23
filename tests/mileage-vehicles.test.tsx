import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }));
import { withheldApprovalGate } from '@/lib/ai/analysis-persistence';
import { convertToEnhancedContext, type UserContext } from '@/lib/ai/analyzeTransaction';
import { buildTaxpayerContext } from '@/lib/ai/taxpayer-context';
import { assistantProfileFacts } from '@/lib/tax-assistant/context';
import { VehicleCards } from '@/components/mileage/vehicle-cards';
import { MileageUnsortedBanner, TripSortScreen } from '@/components/mileage/trip-sort-screen';
import { MILEAGE_VEHICLE_COPY, mileageVehicleCopyCatalog, mileageVehicleCopyEnabled } from '@/lib/mileage/vehicle-copy';
import { buildFederalTaxSnapshot } from '@/lib/tax-rules/federal-tax-snapshot';
import { reviewedPersonalDeductionOrganizer } from './fixtures/personal-deductions';
import {
  applyHomeDestination,
  assignTrips,
  blankVehicle,
  countedMiles,
  emptyPartIV,
  groupTrips,
  legacyPercentageContribution,
  methodForYear,
  migrateLegacyVehicles,
  mileageDeductionTotal,
  normalizeStoredTrip,
  odometerForYear,
  partIVForYear,
  planLegacyVehicle,
  saveVehicle,
  sortProgress,
  tripCreateRecord,
  tripTypeFromBusinessPurpose,
  vehicleFromDocument,
  vehicleMethodForTaxYear,
  vehicleNeedsReview,
  vehicleToDocument,
  type LegacyVehicleProfile,
  type MileageTripFields,
  type VehicleRecord,
} from '@/lib/mileage/vehicles';

const copy = MILEAGE_VEHICLE_COPY;

function trip(partial: Partial<MileageTripFields> & Pick<MileageTripFields, 'id'>): MileageTripFields {
  return normalizeStoredTrip({
    date: '2026-02-01', startLocation: 'Home', endLocation: 'Office', miles: 10,
    businessPurpose: '', roundTrip: false, vehicleId: null, tripType: null, ...partial, id: partial.id,
  });
}

function baseCreate(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-03-01', startLocation: 'Home', endLocation: 'Client', miles: 8,
    businessPurpose: 'Business commute to the client', roundTrip: false, ...overrides,
  };
}

function memory(profile: LegacyVehicleProfile) {
  const saved: VehicleRecord[] = [];
  const original = JSON.parse(JSON.stringify(profile)) as LegacyVehicleProfile;
  return {
    saved,
    original,
    profile,
    readProfile: () => profile,
    readVehicles: () => saved,
    writeVehicle: (vehicle: VehicleRecord) => { saved.push(JSON.parse(JSON.stringify(vehicle)) as VehicleRecord); },
  };
}

function mustSave(vehicles: VehicleRecord[], id: string, patch: Parameters<typeof saveVehicle>[2]) {
  const result = saveVehicle(vehicles, id, patch);
  expect(result.ok, result.ok ? '' : result.reason).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.vehicles;
}

type Element = ReactElement<Record<string, unknown>>;
function rendered(node: Element): unknown {
  return typeof node.type === 'function' ? (node.type as (props: Record<string, unknown>) => unknown)(node.props) : node.props.children;
}
function walk(node: unknown): Element[] {
  if (node == null || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  if (node && typeof node === 'object' && 'props' in node) {
    const element = node as Element;
    return [element, ...walk(rendered(element))];
  }
  return [];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join(' ').replace(/\s+/g, ' ').trim();
  if (node && typeof node === 'object' && 'props' in node) return text(rendered(node as Element));
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}

const federalFixture = {
  taxYear: 2026,
  profile: { filing_status: 'single' },
  organizer: reviewedPersonalDeductionOrganizer(),
  transactions: [],
  grossReceipts: [{ amount: 100000 }],
  forms1099: [],
  w2Entries: [],
  deductions: {},
  assets: [],
  estimatedPayments: 0,
};

describe('mileage vehicles, trip types, and sorting', () => {
  it('vehicle saves with all fields and default unset', () => {
    const created = blankVehicle('v1', 0);
    expect(created).toMatchObject({
      name: 'Vehicle 1', method: 'unset', ownership: 'not_answered', datePlacedInService: '',
      odometerByYear: {}, partIVByYear: {}, legacyBusinessUsePercentage: null, reviewItems: [],
    });
    expect(partIVForYear(created, 2026)).toEqual(emptyPartIV());
    const vehicles = mustSave([created], 'v1', {
      name: 'Civic', method: 'unset', ownership: 'owned', datePlacedInService: '2024-03-01', taxYear: 2026,
      odometerStart: 1200, odometerEnd: 8400,
      partIV: { offDutyPersonalUse: 'yes', otherVehicleForPersonalUse: 'no', hasEvidence: 'yes', evidenceWritten: 'no' },
    });
    const saved = vehicles[0];
    expect(saved.method).toBe('unset');
    expect(saved.name).toBe('Civic');
    expect(saved.ownership).toBe('owned');
    expect(saved.datePlacedInService).toBe('2024-03-01');
    expect(saved.odometerByYear['2026']).toEqual({ start: 1200, end: 8400, startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(saved.partIVByYear['2026']).toEqual({ offDutyPersonalUse: 'yes', otherVehicleForPersonalUse: 'no', hasEvidence: 'yes', evidenceWritten: 'no' });
    expect(saved.partIVByYear['2025']).toBeUndefined();
    expect(partIVForYear(saved, 2025)).toEqual(emptyPartIV());
    expect(vehicleFromDocument(saved.id, vehicleToDocument(saved))).toEqual(saved);
  });

  it('trip without vehicle or type counts zero, and new trips need both after sort finished', () => {
    expect(countedMiles(trip({ id: 'bare' }))).toBe(0);
    expect(countedMiles(trip({ id: 'type-only', tripType: 'business' }))).toBe(0);
    expect(countedMiles(trip({ id: 'car-only', vehicleId: 'v1' }))).toBe(0);
    const unsorted = [trip({ id: 'old' })];
    const early = tripCreateRecord(baseCreate(), unsorted);
    expect(early.ok).toBe(true);
    if (early.ok) expect(early.trip.tripType).toBeNull();
    const sorted = [trip({ id: 'old', vehicleId: 'v1', tripType: 'business' })];
    expect(tripCreateRecord(baseCreate(), sorted).ok).toBe(false);
    expect(tripCreateRecord(baseCreate({ vehicleId: 'v1' }), sorted).ok).toBe(false);
    expect(tripCreateRecord(baseCreate({ tripType: 'business' }), sorted).ok).toBe(false);
    const ready = tripCreateRecord(baseCreate({ vehicleId: 'v1', tripType: 'commute' }), sorted);
    expect(ready.ok).toBe(true);
    if (ready.ok) expect(countedMiles(ready.trip)).toBe(0);
  });

  it('migration agree: both standard gives standard, and only one set method is kept', () => {
    const both = planLegacyVehicle({
      vehicle_deduction_method: 'standard_mileage',
      vehicle_business_use_percentage: 40,
      business_vehicle: { make: 'Honda', model: 'Civic', year: 2019, deduction_method: 'standard_mileage', business_use_percentage: 40 },
    }, []);
    expect(both.inserted).toMatchObject({
      name: 'Honda Civic 2019', method: 'standard_mileage', ownership: 'not_answered', datePlacedInService: '',
      legacyBusinessUsePercentage: 40, reviewItems: [], odometerByYear: {},
    });
    const onlyTop = planLegacyVehicle({ vehicle_deduction_method: 'standard_mileage' }, []);
    expect(onlyTop.inserted?.method).toBe('standard_mileage');
    expect(onlyTop.inserted?.name).toBe('Vehicle 1');
    const onlyNested = planLegacyVehicle({ business_vehicle: { deduction_method: 'actual_expense', model: 'Fit' } }, []);
    expect(onlyNested.inserted).toMatchObject({ name: 'Fit', method: 'actual_expense', depreciationMethod: 'macrs', reviewItems: [] });
  });

  it('migration disagree gives unset plus one review item', () => {
    const plan = planLegacyVehicle({
      vehicle_deduction_method: 'standard_mileage',
      business_vehicle: { deduction_method: 'actual_expense', make: 'Ford' },
    }, []);
    expect(plan.inserted?.method).toBe('unset');
    expect(plan.inserted?.firstBusinessMethod).toBeNull();
    expect(plan.inserted?.reviewItems).toEqual([{ id: 'legacy_method_disagreement', message: copy.methodDisagree }]);
  });

  it('old percentage is stored and changes no total', () => {
    const plan = planLegacyVehicle({ vehicle_business_use_percentage: 80, business_vehicle: { business_use_percentage: 15 } }, []);
    expect(plan.inserted?.legacyBusinessUsePercentage).toBe(80);
    expect(legacyPercentageContribution(plan.inserted!)).toBe(0);
    const trips = [trip({ id: 'biz', vehicleId: 'v', tripType: 'business', miles: 100 })];
    const high = { ...blankVehicle('v', 0), legacyBusinessUsePercentage: 90 };
    const low = { ...blankVehicle('v', 0), legacyBusinessUsePercentage: 10 };
    expect(mileageDeductionTotal(trips, [high], 0.7)).toBe(70);
    expect(mileageDeductionTotal(trips, [low], 0.7)).toBe(70);
    expect(mileageDeductionTotal([trip({ id: 'open', businessPurpose: 'client', miles: 100 })], [high], 0.7)).toBe(0);
  });

  it('migration is idempotent', () => {
    const store = memory({
      vehicle_deduction_method: 'actual_expense',
      business_vehicle: { deduction_method: 'standard_mileage' },
      vehicle_business_use_percentage: 33,
    });
    migrateLegacyVehicles(store);
    migrateLegacyVehicles(store);
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0].reviewItems).toHaveLength(1);
    expect(store.saved[0].method).toBe('unset');
    expect(store.saved[0].name).toBe('Vehicle 1');
  });

  it('no vehicle data creates no vehicle', () => {
    expect(planLegacyVehicle({}, []).inserted).toBeNull();
    expect(planLegacyVehicle({ business_vehicle: {} }, []).inserted).toBeNull();
    expect(planLegacyVehicle({ vehicle_deduction_method: '', business_vehicle: { make: '  ' } }, []).vehicles).toEqual([]);
    const store = memory({});
    expect(migrateLegacyVehicles(store)).toEqual([]);
    expect(store.saved).toEqual([]);
  });

  it('old fields stay untouched after migration', () => {
    const profile = {
      vehicle_deduction_method: 'standard_mileage',
      vehicle_business_use_percentage: 62,
      business_vehicle: { make: 'Toyota', model: 'Camry', year: 2018, deduction_method: 'actual_expense', business_use_percentage: 10 },
      name: 'Synthetic',
    };
    const store = memory(profile);
    migrateLegacyVehicles(store);
    expect(store.profile).toEqual(store.original);
    expect(store.profile.vehicle_deduction_method).toBe('standard_mileage');
    expect(store.profile.business_vehicle).toEqual(profile.business_vehicle);
    expect(store.saved[0].name).toBe('Toyota Camry 2018');
  });

  it('mid year method change goes to review', () => {
    const started = mustSave([blankVehicle('car', 0)], 'car', { ownership: 'owned', method: 'standard_mileage', taxYear: 2026 });
    expect(methodForYear(started[0], 2026)).toBe('standard_mileage');
    expect(Object.keys(started[0].methodByYear)).toEqual(['2026']);
    const mid = saveVehicle(started, 'car', { method: 'actual_expense', taxYear: 2026, methodEffectiveDate: '2026-06-15' });
    expect(mid.ok).toBe(true);
    if (!mid.ok) return;
    expect(methodForYear(mid.vehicles[0], 2026)).toBe('standard_mileage');
    expect(mid.vehicles[0].methodByYear).toEqual({ '2026': 'standard_mileage' });
    expect(mid.vehicles[0].reviewItems).toEqual([{ id: 'mid_year_method_change', taxYear: 2026, message: copy.midYearMethod }]);
    const again = saveVehicle(mid.vehicles, 'car', { method: 'actual_expense', taxYear: 2026, methodEffectiveDate: '2026-08-01' });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.vehicles[0].reviewItems.filter(item => item.id === 'mid_year_method_change')).toHaveLength(1);
  });

  it('actual to standard switch is blocked', () => {
    const started = mustSave([blankVehicle('car', 0)], 'car', { ownership: 'owned', method: 'actual_expense', taxYear: 2025 });
    expect(started[0].depreciationMethod).toBe('macrs');
    const blocked = saveVehicle(started, 'car', { method: 'standard_mileage', taxYear: 2026 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe(copy.macrsLock);
    expect(started[0].methodByYear['2025']).toBe('actual_expense');
    expect(started[0].methodByYear['2026']).toBeUndefined();
  });

  it('a car placed in service on July 1 stores that start reading date', () => {
    const placed = mustSave([blankVehicle('car', 0)], 'car', {
      datePlacedInService: '2026-07-01', taxYear: 2026, odometerStart: 41000, odometerEnd: 46000,
    });
    expect(odometerForYear(placed[0], 2026)).toEqual({ start: 41000, end: 46000, startDate: '2026-07-01', endDate: '2026-12-31' });
    const sold = mustSave(placed, 'car', { dateDisposed: '2026-09-15' });
    expect(odometerForYear(sold[0], 2026).endDate).toBe('2026-09-15');
    expect(sold[0].dateDisposed).toBe('2026-09-15');
  });

  it('a car missing either odometer reading is flagged and nothing is assumed', () => {
    const partial = mustSave([blankVehicle('car', 0)], 'car', { taxYear: 2026, odometerStart: 10, method: 'standard_mileage' });
    expect(odometerForYear(partial[0], 2026)).toMatchObject({ start: 10, end: null, endDate: null });
    expect(vehicleNeedsReview(partial[0], 2026)).toBe(true);
    const empty = blankVehicle('bare', 1);
    expect(odometerForYear(empty, 2026)).toEqual({ start: null, end: null, startDate: null, endDate: null });
    expect(vehicleNeedsReview(empty, 2026)).toBe(true);
  });

  it('vehicle method reader uses the list for the tax year and treats several unlinked cars as unknown', () => {
    const migrated = blankVehicle('legacy-vehicle-1', 0);
    migrated.legacyMigration = true;
    migrated.legacyBusinessUsePercentage = 80;
    migrated.method = 'standard_mileage';
    migrated.methodByYear = { '2026': 'standard_mileage' };
    const listed = [migrated];
    const one = vehicleMethodForTaxYear({
      vehicles: listed, profile: { vehicle_deduction_method: 'actual_expense', vehicle_business_use_percentage: 15 }, taxYear: 2026,
    });
    expect(one).toMatchObject({ status: 'known', method: 'standard_mileage', businessUsePercent: 80, vehicleId: migrated.id, needsInfo: false });
    const second = blankVehicle('other', 1);
    const many = vehicleMethodForTaxYear({ vehicles: [...listed, second], taxYear: 2026 });
    expect(many).toMatchObject({ status: 'unknown', method: null, businessUsePercent: null, needsInfo: true });
    const linked = vehicleMethodForTaxYear({ vehicles: [...listed, second], taxYear: 2026, vehicleId: migrated.id });
    expect(linked.method).toBe('standard_mileage');
    const fallback = vehicleMethodForTaxYear({ profile: { vehicle_deduction_method: 'standard_mileage', vehicle_business_use_percentage: 33 }, taxYear: 2026 });
    expect(fallback).toMatchObject({ status: 'known', method: 'standard_mileage', businessUsePercent: 33, vehicleId: 'legacy-vehicle-1' });
    const disagree = vehicleMethodForTaxYear({
      profile: { vehicle_deduction_method: 'standard_mileage', business_vehicle: { deduction_method: 'actual_expense' } }, taxYear: 2026,
    });
    expect(disagree).toMatchObject({ status: 'unset', method: null, needsInfo: true });
  });

  it('actual first year then standard is rejected', () => {
    const started = mustSave([blankVehicle('car', 0)], 'car', { ownership: 'owned', method: 'actual_expense' });
    expect(started[0].depreciationMethod).toBe('macrs');
    const blocked = saveVehicle(started, 'car', { method: 'standard_mileage' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe(copy.macrsLock);
  });

  it('leased standard cannot switch to actual', () => {
    const started = mustSave([blankVehicle('lease', 0)], 'lease', { ownership: 'leased', method: 'standard_mileage' });
    expect(started[0].leasedStandardLock).toBe(true);
    const blocked = saveVehicle(started, 'lease', { method: 'actual_expense' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe(copy.leaseStay);
  });

  it('standard to actual is allowed as straight line', () => {
    const started = mustSave([blankVehicle('own', 0)], 'own', { ownership: 'owned', method: 'standard_mileage' });
    const switched = mustSave(started, 'own', { method: 'actual_expense' });
    expect(switched[0].method).toBe('actual_expense');
    expect(switched[0].depreciationMethod).toBe('straight_line');
  });

  it('fifth simultaneous vehicle blocks standard', () => {
    let fleet: VehicleRecord[] = [];
    for (let index = 0; index < 4; index += 1) {
      const id = `car-${index}`;
      fleet = [...fleet, blankVehicle(id, fleet.length)];
      fleet = mustSave(fleet, id, { ownership: 'owned', method: 'standard_mileage' });
    }
    fleet = [...fleet, blankVehicle('car-4', fleet.length)];
    const asStandard = saveVehicle(fleet, 'car-4', { ownership: 'owned', method: 'standard_mileage' });
    expect(asStandard.ok).toBe(false);
    if (!asStandard.ok) expect(asStandard.reason).toBe(copy.fiveVehicles);
    const asActual = saveVehicle(fleet, 'car-4', { ownership: 'owned', method: 'actual_expense' });
    expect(asActual.ok).toBe(false);
    if (!asActual.ok) expect(asActual.reason).toBe(copy.fiveVehicles);
    let actualFleet: VehicleRecord[] = [];
    for (let index = 0; index < 4; index += 1) {
      const id = `actual-${index}`;
      actualFleet = [...actualFleet, blankVehicle(id, actualFleet.length)];
      actualFleet = mustSave(actualFleet, id, { ownership: 'owned', method: 'actual_expense' });
    }
    actualFleet = [...actualFleet, blankVehicle('actual-4', actualFleet.length)];
    const fifthActual = saveVehicle(actualFleet, 'actual-4', { ownership: 'owned', method: 'actual_expense' });
    expect(fifthActual.ok).toBe(true);
    const fifthStandard = saveVehicle(actualFleet, 'actual-4', { ownership: 'owned', method: 'standard_mileage' });
    expect(fifthStandard.ok).toBe(false);
  });

  it('untyped and commute count zero, and home to a temporary work location typed business counts', () => {
    const home = trip({ id: 'home', startLocation: 'Home', endLocation: 'Site', miles: 12, vehicleId: 'v1', tripType: 'commute' });
    expect(countedMiles(trip({ id: 'open', businessPurpose: 'client meeting' }))).toBe(0);
    expect(countedMiles(home)).toBe(0);
    expect(countedMiles(trip({ id: 'personal', vehicleId: 'v1', tripType: 'personal', miles: 12 }))).toBe(0);
    const temporary = applyHomeDestination(home, 'temporary_work');
    expect(temporary.tripType).toBe('business');
    expect(temporary.homeDestination).toBe('temporary_work');
    expect(countedMiles(temporary)).toBe(12);
    expect(countedMiles(applyHomeDestination(home, 'regular_work'))).toBe(0);
    expect(countedMiles(applyHomeDestination(home, 'second_work'))).toBe(0);
  });

  it('type is never set from businessPurpose', () => {
    expect(tripTypeFromBusinessPurpose('Business commute to the client')).toBeNull();
    const created = tripCreateRecord(baseCreate(), []);
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.trip.tripType).toBeNull();
      expect(created.trip.vehicleId).toBeNull();
      expect(created.trip.businessPurpose).toBe('Business commute to the client');
    }
    expect(normalizeStoredTrip({ id: 'stored', businessPurpose: 'personal errand business commute', miles: 4 }).tripType).toBeNull();
  });

  it('grouping includes exact reverse trips and leaves a different case apart', () => {
    const trips = [
      trip({ id: '1', startLocation: 'Home', endLocation: 'Office', miles: 10, date: '2026-01-01' }),
      trip({ id: '2', startLocation: 'Office', endLocation: 'Home', miles: 10, date: '2026-01-02' }),
      trip({ id: '3', startLocation: 'Home', endLocation: 'Office', miles: 8, date: '2026-01-03' }),
      trip({ id: '4', startLocation: 'Home', endLocation: 'Airport', miles: 5, date: '2026-02-01' }),
      trip({ id: '5', startLocation: 'home', endLocation: 'Office', miles: 1, date: '2026-02-02' }),
    ];
    const groups = groupTrips(trips);
    expect(groups.repeated).toHaveLength(1);
    expect(groups.repeated[0]).toMatchObject({
      startLocation: 'Home', endLocation: 'Office', tripCount: 3, miles: 28, dateStart: '2026-01-01', dateEnd: '2026-01-03',
    });
    expect([...groups.repeated[0].tripIds].sort()).toEqual(['1', '2', '3']);
    expect(groups.oneOff.map(group => group.tripIds[0]).sort()).toEqual(['4', '5']);
    expect(groups.repeated[0].tripCount).toBeGreaterThan(groups.oneOff[0].tripCount);
    return groups;
  });

  it('group assign sets all trips in the group', () => {
    const trips = [
      trip({ id: '1', startLocation: 'Home', endLocation: 'Office' }),
      trip({ id: '2', startLocation: 'Office', endLocation: 'Home' }),
      trip({ id: '3', startLocation: 'Home', endLocation: 'Airport' }),
    ];
    const group = groupTrips(trips).repeated[0];
    const assigned = assignTrips(trips, group.tripIds, { vehicleId: 'v1', tripType: 'business' });
    expect(assigned.filter(item => group.tripIds.includes(item.id)).every(item => item.vehicleId === 'v1' && item.tripType === 'business')).toBe(true);
    expect(assigned.find(item => item.id === '3')).toMatchObject({ vehicleId: null, tripType: null });
  });

  it('Not sure leaves trips untyped', () => {
    const trips = [
      trip({ id: '1', startLocation: 'Home', endLocation: 'Office', vehicleId: 'v1', tripType: 'business' }),
      trip({ id: '2', startLocation: 'Office', endLocation: 'Home', tripType: 'personal' }),
    ];
    const group = groupTrips(trips).repeated[0];
    const unsure = assignTrips(trips, group.tripIds, { vehicleId: 'v1', tripType: null });
    expect(unsure.every(item => item.tripType === null)).toBe(true);
    expect(unsure.every(item => item.vehicleId === 'v1')).toBe(true);
    expect(countedMiles(unsure[0])).toBe(0);
  });

  it('resume keeps sort progress', () => {
    const trips = [
      trip({ id: '1' }), trip({ id: '2', startLocation: 'Office', endLocation: 'Home' }), trip({ id: '3', endLocation: 'Airport' }),
    ];
    const saved = assignTrips(trips, ['1', '2'], { vehicleId: 'v1', tripType: 'business' });
    const progress = sortProgress(saved);
    const reloaded = saved.map(item => normalizeStoredTrip(JSON.parse(JSON.stringify(item))));
    expect(sortProgress(reloaded)).toEqual(progress);
    expect(progress).toEqual({ done: 2, total: 3, unsorted: 1 });
    expect(reloaded.find(item => item.id === '3')).toMatchObject({ vehicleId: null, tripType: null });
  });

  it('banner hides only when no trip is unsorted', () => {
    expect(text(MileageUnsortedBanner({ copyEnabled: true, unsortedCount: 3 }))).toBe(copy.banner(3));
    expect(MileageUnsortedBanner({ copyEnabled: true, unsortedCount: 0 })).toBeNull();
    expect(MileageUnsortedBanner({ copyEnabled: false, unsortedCount: 4 })).toBeNull();
    const hidden = MileageUnsortedBanner({ copyEnabled: false, unsortedCount: 4 });
    expect(text(hidden)).toBe('');
    expect(text(hidden)).not.toContain('trips to sort');
  });

  it('new strings are hidden when the copy flag is off and shown when it is on', () => {
    expect(mileageVehicleCopyEnabled({})).toBe(false);
    expect(mileageVehicleCopyEnabled({ NEXT_PUBLIC_MILEAGE_VEHICLE_COPY: '0' })).toBe(false);
    expect(mileageVehicleCopyEnabled({ NEXT_PUBLIC_MILEAGE_VEHICLE_COPY: '1' })).toBe(true);
    expect(mileageVehicleCopyCatalog(false)).toEqual([]);
    const vehicle = blankVehicle('legacy-vehicle-1', 0);
    vehicle.legacyMigration = true;
    vehicle.legacyBusinessUsePercentage = 60;
    vehicle.reviewItems = [{ id: 'legacy_method_disagreement', message: copy.methodDisagree }];
    const props = { vehicles: [vehicle], taxYear: 2026, onChange: vi.fn(), onAdd: vi.fn() };
    expect(text(VehicleCards({ copyEnabled: false, ...props }))).toBe('');
    const shown = VehicleCards({ copyEnabled: true, ...props });
    const shownText = text(shown);
    for (const sentence of [copy.yourCars, copy.addCar, copy.vehicleName, copy.deductionMethod, copy.ownedOrLeased, copy.dateFirstUsed, copy.dateSold, copy.odometerJan1, copy.odometerDec31, copy.partIVOffDuty, copy.partIVOtherCar, copy.partIVEvidence, copy.partIVWritten, copy.methodDisagree, copy.odometerReview, copy.legacyPercentage, copy.review]) {
      expect(shownText).toContain(sentence);
    }
    const nodes = walk(shown);
    expect(nodes.find(node => node.props['aria-label'] === copy.deductionMethod)?.props.value).toBe('unset');
    expect(nodes.find(node => node.props['aria-label'] === copy.odometerJan1)?.props.defaultValue).toBe('');
    expect(nodes.find(node => node.props['aria-label'] === copy.odometerDec31)?.props.defaultValue).toBe('');
    expect(nodes.filter(node => node.type === 'input').every(node => node.props.defaultValue !== 60 && node.props.value !== 60)).toBe(true);
    const trips = [trip({ id: '1' }), trip({ id: '2', startLocation: 'Office', endLocation: 'Home' }), trip({ id: '3', endLocation: 'Airport' })];
    const groups = groupTrips(trips);
    const sortProps = {
      vehicles: [vehicle], taxYear: 2026, repeated: groups.repeated, oneOff: groups.oneOff, trips, done: 0, total: 3,
      openGroupKey: null, homePromptKey: groups.repeated[0].key, homePromptTripId: null,
      selectedVehicleByGroup: {}, selectedTypeByGroup: {}, onChangeVehicle: vi.fn(), onAddVehicle: vi.fn(),
      onOpenGroup: vi.fn(), onSelectVehicle: vi.fn(), onSelectType: vi.fn(), onHomeChoice: vi.fn(),
      onTripVehicle: vi.fn(), onTripType: vi.fn(), onTripHomeChoice: vi.fn(),
    };
    expect(text(TripSortScreen({ copyEnabled: false, ...sortProps }))).toBe('');
    const sortText = text(TripSortScreen({ copyEnabled: true, ...sortProps }));
    for (const sentence of [copy.sortTitle, copy.pickTripType, copy.progress(0, 3), copy.repeatedTrips, copy.oneOffTrips, copy.business, copy.commute, copy.personal, copy.notSure, copy.homePrompt]) {
      expect(sortText).toContain(sentence);
    }
    const pressed = walk(TripSortScreen({ copyEnabled: true, ...sortProps })).filter(node => node.props['aria-pressed'] === true);
    expect(pressed).toHaveLength(0);
    expect(mileageVehicleCopyCatalog(true).length).toBeGreaterThan(20);
  });

  it('11a five readers use the vehicle list for the tax year', () => {
    const stale = {
      user_id: 'owner', profession: ['Photographer'], filing_state: 'TX',
      vehicle_deduction_method: 'actual_expense' as const, vehicle_business_use_percentage: 90,
      business_vehicle: { make: 'Ford', model: 'Focus', year: 2014, deduction_method: 'actual_expense' as const, business_use_percentage: 90 },
    };
    const linked = blankVehicle('legacy-vehicle-1', 0);
    linked.method = 'standard_mileage';
    linked.methodByYear = { '2026': 'standard_mileage' };
    linked.legacyBusinessUsePercentage = 40;
    const other = blankVehicle('van', 1);
    other.method = 'actual_expense';
    other.methodByYear = { '2026': 'actual_expense' };
    const profile = stale as UserContext;
    const taxpayer = buildTaxpayerContext({
      profile, vehicles: [linked], vehicleId: linked.id, transactionDate: '2026-08-01', merchant: 'Chevron', confirmed: [],
    });
    expect(taxpayer.methods.vehicle).toEqual({ method: 'standard_mileage', businessUsePercent: 40 });
    expect(taxpayer.gaps).not.toContain('vehicle_deduction_method');
    const gate = withheldApprovalGate({ category: 'vehicle_expense', deductiblePercent: 100, transactionKind: 'expense', amount: 40 }, 100, {
      vehicles: [linked], profile: stale, taxYear: 2026, vehicleId: linked.id,
    });
    expect(gate).toBeNull();
    const enhanced = convertToEnhancedContext(stale, '2026-08-01', { vehicles: [linked], vehicleId: linked.id });
    expect(enhanced.vehicle_deduction_method).toBe('standard_mileage');
    expect(enhanced.business_vehicle).toMatchObject({ make: 'Ford', model: 'Focus', year: 2014, deduction_method: 'standard_mileage', business_use_percentage: 40 });
    expect(assistantProfileFacts(stale, { vehicles: [linked], vehicleId: linked.id, taxYear: 2026 }).vehicleMethod).toBe('standard_mileage');

    const several = buildTaxpayerContext({
      profile, vehicles: [linked, other], transactionDate: '2026-08-01', merchant: 'Chevron', confirmed: [],
    });
    expect(several.methods.vehicle).toEqual({ method: null, businessUsePercent: null });
    expect(several.gaps).toContain('vehicle_deduction_method');
    expect(withheldApprovalGate({ category: 'vehicle_expense', deductiblePercent: 100, transactionKind: 'expense', amount: 40 }, 100, {
      vehicles: [linked, other], profile: stale, taxYear: 2026,
    })?.question).toBe('Do you use the standard mileage rate or actual expenses for this vehicle?');
    const unknown = convertToEnhancedContext(stale, '2026-08-01', { vehicles: [linked, other] });
    expect(unknown.vehicle_deduction_method).toBeUndefined();
    expect(unknown.vehicle_business_use_percentage).toBeUndefined();
    expect(unknown.business_vehicle?.deduction_method).toBeUndefined();
    expect(unknown.business_vehicle?.business_use_percentage).toBeUndefined();
    expect(unknown.business_vehicle).toMatchObject({ make: 'Ford', model: 'Focus', year: 2014 });
    expect(assistantProfileFacts(stale, { vehicles: [linked, other], taxYear: 2026 }).vehicleMethod).toBeNull();
  });

  it('11b a mid year method change on one car goes to review and leaves the method in place', () => {
    const first = mustSave([blankVehicle('car-a', 0), blankVehicle('car-b', 1)], 'car-a', { ownership: 'owned', method: 'standard_mileage', taxYear: 2026 });
    const fleet = mustSave(first, 'car-b', { ownership: 'owned', method: 'actual_expense', taxYear: 2026 });
    const before = fleet.find(vehicle => vehicle.id === 'car-b');
    const changed = saveVehicle(fleet, 'car-a', { method: 'actual_expense', taxYear: 2026, methodEffectiveDate: '2026-06-15' });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const car = changed.vehicles.find(vehicle => vehicle.id === 'car-a');
    expect(methodForYear(car!, 2026)).toBe('standard_mileage');
    expect(car?.method).toBe('standard_mileage');
    expect(car?.methodByYear).toEqual({ '2026': 'standard_mileage' });
    expect(car?.reviewItems).toEqual([{ id: 'mid_year_method_change', taxYear: 2026, message: copy.midYearMethod }]);
    expect(changed.vehicles.find(vehicle => vehicle.id === 'car-b')).toEqual(before);
    const again = saveVehicle(changed.vehicles, 'car-a', { method: 'actual_expense', taxYear: 2026, methodEffectiveDate: '2026-09-01' });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(methodForYear(again.vehicles.find(vehicle => vehicle.id === 'car-a')!, 2026)).toBe('standard_mileage');
    expect(again.vehicles.find(vehicle => vehicle.id === 'car-a')?.reviewItems.filter(item => item.id === 'mid_year_method_change')).toHaveLength(1);
  });

  it('11c placed in service and date sold set the odometer reading dates', () => {
    const placed = mustSave([blankVehicle('car', 0)], 'car', {
      datePlacedInService: '2026-07-01', dateDisposed: '2026-09-15', taxYear: 2026, odometerStart: 1000, odometerEnd: 1800,
    });
    expect(odometerForYear(placed[0], 2026)).toEqual({ start: 1000, end: 1800, startDate: '2026-07-01', endDate: '2026-09-15' });
    const earlier = mustSave([blankVehicle('older', 1)], 'older', {
      datePlacedInService: '2024-05-01', dateDisposed: '2026-03-01', taxYear: 2026, odometerStart: 10, odometerEnd: 20,
    });
    expect(odometerForYear(earlier[0], 2026)).toEqual({ start: 10, end: 20, startDate: '2026-01-01', endDate: '2026-03-01' });
    const datesOnly = mustSave([blankVehicle('bare', 2)], 'bare', { datePlacedInService: '2026-07-01', dateDisposed: '2026-09-15', taxYear: 2026 });
    expect(odometerForYear(datesOnly[0], 2026)).toEqual({ start: null, end: null, startDate: null, endDate: null });
    expect(vehicleNeedsReview(datesOnly[0], 2026)).toBe(true);
  });

  it('buildFederalTaxSnapshot output is unchanged for an existing fixture', () => {
    const source = readFileSync(new URL('../lib/tax-rules/federal-tax-snapshot.ts', import.meta.url), 'utf8');
    expect(source.includes('countedMiles')).toBe(false);
    expect(source.includes('legacyBusinessUsePercentage')).toBe(false);
    expect(source.includes('vehicle_business_use_percentage')).toBe(false);
    const result = buildFederalTaxSnapshot(federalFixture);
    const miles = countedMiles(trip({ id: 'beside', vehicleId: 'v1', tripType: 'business', miles: 100 }));
    expect(miles).toBe(100);
    expect(legacyPercentageContribution({ ...blankVehicle('v1', 0), legacyBusinessUsePercentage: 75 })).toBe(0);
    expect({
      totalTax: result.result.totalTax,
      agi: result.result.agi,
      taxableIncome: result.result.taxableIncome,
      totalIncome: result.result.totalIncome,
      scheduleCLine31NetProfit: result.income.scheduleCLine31NetProfit,
      totalSETax: result.seCalc.totalSETax,
    }).toEqual({
      totalTax: 22364.55,
      agi: 92935.22,
      taxableIncome: 61468.18,
      totalIncome: 100000,
      scheduleCLine31NetProfit: 100000,
      totalSETax: 14129.55,
    });
    expect(buildFederalTaxSnapshot(federalFixture).result.totalTax).toBe(result.result.totalTax);
  });
});
