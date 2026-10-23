import { MILEAGE_VEHICLE_COPY } from './vehicle-copy';

export const LEGACY_VEHICLE_ID = 'legacy-vehicle-1';
export const SIMULTANEOUS_STANDARD_MILEAGE_LIMIT = 5;

export type DeductionMethod = 'standard_mileage' | 'actual_expense' | 'unset';
export type CommittedMethod = Exclude<DeductionMethod, 'unset'>;
export type VehicleOwnership = 'owned' | 'leased' | 'not_answered';
export type YesNo = 'yes' | 'no';
export type TripType = 'business' | 'commute' | 'personal';
export type HomeDestination = 'regular_work' | 'temporary_work' | 'second_work';
export type DepreciationMethod = 'macrs' | 'straight_line';

export interface PartIVAnswers {
  offDutyPersonalUse: YesNo | null;
  otherVehicleForPersonalUse: YesNo | null;
  hasEvidence: YesNo | null;
  evidenceWritten: YesNo | null;
}

export interface OdometerReadings {
  start: number | null;
  end: number | null;
}

export interface VehicleReviewItem {
  id: 'legacy_method_disagreement';
  message: string;
}

export interface VehicleRecord {
  id: string;
  name: string;
  method: DeductionMethod;
  ownership: VehicleOwnership;
  datePlacedInService: string;
  odometerByYear: Record<string, OdometerReadings>;
  partIVByYear: Record<string, PartIVAnswers>;
  legacyBusinessUsePercentage: number | null;
  legacyMigration: boolean;
  reviewItems: VehicleReviewItem[];
  firstBusinessMethod: CommittedMethod | null;
  depreciationMethod: DepreciationMethod | null;
  standardMileageSelected: boolean;
  leasedStandardLock: boolean;
}

export interface LegacyVehicleProfile {
  vehicle_deduction_method?: string | null;
  vehicle_business_use_percentage?: number | null;
  business_vehicle?: {
    make?: string | null;
    model?: string | null;
    year?: number | string | null;
    business_use_percentage?: number | null;
    deduction_method?: string | null;
  } | null;
}

export interface MileageTripFields {
  id: string;
  date: string;
  startLocation: string;
  endLocation: string;
  miles: number;
  businessPurpose: string;
  roundTrip: boolean;
  vehicleId: string | null;
  tripType: TripType | null;
  homeDestination: HomeDestination | null;
}

export interface VehiclePatch {
  name?: string;
  method?: DeductionMethod;
  ownership?: VehicleOwnership;
  datePlacedInService?: string;
  taxYear?: number;
  odometerStart?: number | null;
  odometerEnd?: number | null;
  partIV?: Partial<PartIVAnswers>;
}

export type SaveVehicleResult = { ok: true; vehicles: VehicleRecord[] } | { ok: false; reason: string };

const METHODS = new Set<DeductionMethod>(['standard_mileage', 'actual_expense', 'unset']);
const OWNERSHIP = new Set<VehicleOwnership>(['owned', 'leased', 'not_answered']);
const PART_IV_KEYS = ['offDutyPersonalUse', 'otherVehicleForPersonalUse', 'hasEvidence', 'evidenceWritten'] as const;

export function emptyPartIV(): PartIVAnswers {
  return { offDutyPersonalUse: null, otherVehicleForPersonalUse: null, hasEvidence: null, evidenceWritten: null };
}

export function blankVehicle(id: string, existingCount: number): VehicleRecord {
  return {
    id,
    name: MILEAGE_VEHICLE_COPY.vehicleNumber(existingCount + 1),
    method: 'unset',
    ownership: 'not_answered',
    datePlacedInService: '',
    odometerByYear: {},
    partIVByYear: {},
    legacyBusinessUsePercentage: null,
    legacyMigration: false,
    reviewItems: [],
    firstBusinessMethod: null,
    depreciationMethod: null,
    standardMileageSelected: false,
    leasedStandardLock: false,
  };
}

export function odometerForYear(vehicle: VehicleRecord, taxYear: number): OdometerReadings {
  return vehicle.odometerByYear[String(taxYear)] ?? { start: null, end: null };
}

export function partIVForYear(vehicle: VehicleRecord, taxYear: number): PartIVAnswers {
  return vehicle.partIVByYear[String(taxYear)] ?? emptyPartIV();
}

export function vehicleNeedsReview(vehicle: VehicleRecord, taxYear: number): boolean {
  const readings = odometerForYear(vehicle, taxYear);
  return vehicle.method === 'unset' || readings.start === null || readings.end === null;
}

function committedMethod(value: unknown): CommittedMethod | null {
  return value === 'standard_mileage' || value === 'actual_expense' ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim();
}

export function legacyVehicleFieldsPresent(profile: LegacyVehicleProfile): boolean {
  if (committedMethod(profile.vehicle_deduction_method)) return true;
  if (finiteNumber(profile.vehicle_business_use_percentage) !== null) return true;
  const nested = profile.business_vehicle;
  if (!nested) return false;
  if (text(nested.make) || text(nested.model) || text(nested.year)) return true;
  if (committedMethod(nested.deduction_method)) return true;
  return finiteNumber(nested.business_use_percentage) !== null;
}

export function planLegacyVehicle(profile: LegacyVehicleProfile, existing: readonly VehicleRecord[]): { vehicles: VehicleRecord[]; inserted: VehicleRecord | null } {
  if (existing.some(vehicle => vehicle.legacyMigration)) return { vehicles: [...existing], inserted: null };
  if (!legacyVehicleFieldsPresent(profile)) return { vehicles: [...existing], inserted: null };
  const top = committedMethod(profile.vehicle_deduction_method);
  const nested = committedMethod(profile.business_vehicle?.deduction_method);
  const disagree = Boolean(top && nested && top !== nested);
  const method: DeductionMethod = disagree ? 'unset' : top || nested || 'unset';
  const percentage = finiteNumber(profile.vehicle_business_use_percentage) ?? finiteNumber(profile.business_vehicle?.business_use_percentage);
  const name = [text(profile.business_vehicle?.make), text(profile.business_vehicle?.model), text(profile.business_vehicle?.year)].filter(Boolean).join(' ');
  const vehicle = blankVehicle(LEGACY_VEHICLE_ID, 0);
  vehicle.name = name || MILEAGE_VEHICLE_COPY.vehicleFallbackName;
  vehicle.legacyMigration = true;
  vehicle.legacyBusinessUsePercentage = percentage;
  vehicle.method = method;
  if (method === 'standard_mileage') {
    vehicle.firstBusinessMethod = 'standard_mileage';
    vehicle.standardMileageSelected = true;
  } else if (method === 'actual_expense') {
    vehicle.firstBusinessMethod = 'actual_expense';
    vehicle.depreciationMethod = 'macrs';
  }
  if (disagree) {
    vehicle.reviewItems = [{ id: 'legacy_method_disagreement', message: MILEAGE_VEHICLE_COPY.methodDisagree }];
  }
  return { vehicles: [...existing, vehicle], inserted: vehicle };
}

export interface VehicleMigrationStore {
  readProfile(): LegacyVehicleProfile;
  readVehicles(): VehicleRecord[];
  writeVehicle(vehicle: VehicleRecord): void;
}

/** Lazy, idempotent derivation. Reads legacy fields and writes only a new vehicle record. */
export function migrateLegacyVehicles(store: VehicleMigrationStore): VehicleRecord[] {
  const profile = store.readProfile();
  const original = JSON.stringify(profile);
  const plan = planLegacyVehicle(profile, store.readVehicles());
  if (JSON.stringify(profile) !== original) throw new Error('Legacy vehicle migration changed profile fields');
  if (plan.inserted) store.writeVehicle(plan.inserted);
  return plan.vehicles;
}

function validDate(value: string): boolean {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function reading(value: number | null): string | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return MILEAGE_VEHICLE_COPY.invalidOdometer;
  return null;
}

function validatePatch(patch: VehiclePatch): string | null {
  if (patch.name !== undefined && (patch.name.trim().length < 1 || patch.name.trim().length > 80)) return MILEAGE_VEHICLE_COPY.enterName;
  if (patch.method !== undefined && !METHODS.has(patch.method)) return MILEAGE_VEHICLE_COPY.invalidMethod;
  if (patch.ownership !== undefined && !OWNERSHIP.has(patch.ownership)) return MILEAGE_VEHICLE_COPY.invalidOwnership;
  if (patch.datePlacedInService !== undefined && !validDate(patch.datePlacedInService)) return MILEAGE_VEHICLE_COPY.invalidDate;
  if (patch.odometerStart !== undefined) {
    const reason = reading(patch.odometerStart);
    if (reason) return reason;
  }
  if (patch.odometerEnd !== undefined) {
    const reason = reading(patch.odometerEnd);
    if (reason) return reason;
  }
  if (patch.partIV) {
    for (const key of PART_IV_KEYS) {
      if (patch.partIV[key] !== undefined && patch.partIV[key] !== null && patch.partIV[key] !== 'yes' && patch.partIV[key] !== 'no') {
        return MILEAGE_VEHICLE_COPY.invalidAnswer;
      }
    }
  }
  if ((patch.odometerStart !== undefined || patch.odometerEnd !== undefined || patch.partIV) && (patch.taxYear === undefined || !Number.isInteger(patch.taxYear) || patch.taxYear < 2000 || patch.taxYear > 2100)) {
    return MILEAGE_VEHICLE_COPY.invalidOdometer;
  }
  return null;
}

function applyPatch(current: VehicleRecord, patch: VehiclePatch): VehicleRecord {
  const next: VehicleRecord = {
    ...current,
    odometerByYear: { ...current.odometerByYear },
    partIVByYear: { ...current.partIVByYear },
    reviewItems: current.reviewItems.map(item => ({ ...item })),
  };
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.method !== undefined) next.method = patch.method;
  if (patch.ownership !== undefined) next.ownership = patch.ownership;
  if (patch.datePlacedInService !== undefined) next.datePlacedInService = patch.datePlacedInService;
  const year = patch.taxYear === undefined ? null : String(patch.taxYear);
  if (year && (patch.odometerStart !== undefined || patch.odometerEnd !== undefined)) {
    const previous = next.odometerByYear[year] ?? { start: null, end: null };
    next.odometerByYear[year] = {
      start: patch.odometerStart !== undefined ? patch.odometerStart : previous.start,
      end: patch.odometerEnd !== undefined ? patch.odometerEnd : previous.end,
    };
  }
  if (year && patch.partIV) {
    const previous = next.partIVByYear[year] ?? emptyPartIV();
    const answers = { ...previous };
    for (const key of PART_IV_KEYS) {
      if (patch.partIV[key] !== undefined) answers[key] = patch.partIV[key] ?? null;
    }
    next.partIVByYear[year] = answers;
  }
  return next;
}

export function vehicleInBusinessUse(vehicle: VehicleRecord): boolean {
  return vehicle.method !== 'unset' || vehicle.datePlacedInService !== '';
}

function businessUseCount(vehicles: readonly VehicleRecord[]): number {
  return vehicles.filter(vehicleInBusinessUse).length;
}

function methodRuleReason(current: VehicleRecord, next: VehicleRecord, fleet: readonly VehicleRecord[]): string | null {
  const startedOnActual = current.firstBusinessMethod === 'actual_expense' || current.depreciationMethod === 'macrs';
  if (next.method === 'standard_mileage') {
    if (businessUseCount(fleet) >= SIMULTANEOUS_STANDARD_MILEAGE_LIMIT) return MILEAGE_VEHICLE_COPY.fiveVehicles;
    if (next.ownership === 'leased' && startedOnActual) return MILEAGE_VEHICLE_COPY.leaseWhole;
    if (next.ownership !== 'leased' && current.depreciationMethod === 'macrs') return MILEAGE_VEHICLE_COPY.macrsLock;
    if (next.ownership !== 'leased' && current.firstBusinessMethod === 'actual_expense') return MILEAGE_VEHICLE_COPY.ownedFirstYear;
  }
  if (next.method === 'actual_expense' && (current.leasedStandardLock || (next.ownership === 'leased' && current.standardMileageSelected))) {
    return MILEAGE_VEHICLE_COPY.leaseStay;
  }
  const enteredBusinessUse = !vehicleInBusinessUse(current) && vehicleInBusinessUse(next);
  if (enteredBusinessUse && businessUseCount(fleet) >= SIMULTANEOUS_STANDARD_MILEAGE_LIMIT && fleet.some(vehicle => vehicle.method === 'standard_mileage')) {
    return MILEAGE_VEHICLE_COPY.fiveVehicles;
  }
  return null;
}

function withMethodHistory(current: VehicleRecord, next: VehicleRecord): VehicleRecord {
  const result: VehicleRecord = { ...next };
  if (result.method === 'standard_mileage') {
    result.firstBusinessMethod = current.firstBusinessMethod ?? 'standard_mileage';
    result.standardMileageSelected = true;
    result.depreciationMethod = current.depreciationMethod;
    if (result.ownership === 'leased') result.leasedStandardLock = true;
  } else if (result.method === 'actual_expense') {
    result.firstBusinessMethod = current.firstBusinessMethod ?? 'actual_expense';
    result.standardMileageSelected = current.standardMileageSelected;
    result.leasedStandardLock = current.leasedStandardLock;
    if (current.standardMileageSelected || current.firstBusinessMethod === 'standard_mileage') result.depreciationMethod = 'straight_line';
    else result.depreciationMethod = current.depreciationMethod ?? 'macrs';
  }
  if (result.ownership === 'leased' && result.standardMileageSelected) result.leasedStandardLock = true;
  if (result.method !== 'unset') {
    result.reviewItems = result.reviewItems.filter(item => item.id !== 'legacy_method_disagreement');
  }
  return result;
}

export function saveVehicle(vehicles: readonly VehicleRecord[], vehicleId: string, patch: VehiclePatch): SaveVehicleResult {
  const current = vehicles.find(vehicle => vehicle.id === vehicleId);
  if (!current) return { ok: false, reason: MILEAGE_VEHICLE_COPY.vehicleMissing };
  const invalid = validatePatch(patch);
  if (invalid) return { ok: false, reason: invalid };
  const patched = applyPatch(current, patch);
  const fleet = vehicles.map(vehicle => vehicle.id === vehicleId ? patched : vehicle);
  const touchesRules = patch.method !== undefined || patch.ownership !== undefined || patch.datePlacedInService !== undefined;
  if (touchesRules) {
    const reason = methodRuleReason(current, patched, fleet);
    if (reason) return { ok: false, reason };
  }
  const saved = touchesRules ? withMethodHistory(current, patched) : patched;
  return { ok: true, vehicles: vehicles.map(vehicle => vehicle.id === vehicleId ? saved : vehicle) };
}

/** Reference percentage never contributes to a deduction total. */
export function legacyPercentageContribution(vehicle: VehicleRecord): number {
  void vehicle;
  return 0;
}

export function countedMiles(trip: Pick<MileageTripFields, 'miles' | 'roundTrip' | 'vehicleId' | 'tripType'>): number {
  if (!trip.vehicleId || trip.tripType !== 'business') return 0;
  if (typeof trip.miles !== 'number' || !Number.isFinite(trip.miles) || trip.miles <= 0) return 0;
  return trip.roundTrip ? trip.miles * 2 : trip.miles;
}

export function countedMilesTotal(trips: readonly Pick<MileageTripFields, 'miles' | 'roundTrip' | 'vehicleId' | 'tripType'>[]): number {
  return trips.reduce((sum, trip) => sum + countedMiles(trip), 0);
}

export function mileageDeductionTotal(trips: readonly MileageTripFields[], vehicles: readonly VehicleRecord[], ratePerMile: number): number {
  const fromPercentage = vehicles.reduce((sum, vehicle) => sum + legacyPercentageContribution(vehicle), 0);
  return countedMilesTotal(trips) * ratePerMile + fromPercentage;
}

/** Trip type is never derived from the free text purpose. */
export function tripTypeFromBusinessPurpose(businessPurpose: string | null | undefined): null {
  void businessPurpose;
  return null;
}

export function normalizeStoredTrip(raw: Partial<MileageTripFields>): MileageTripFields {
  const tripType = raw.tripType === 'business' || raw.tripType === 'commute' || raw.tripType === 'personal' ? raw.tripType : null;
  const homeDestination = raw.homeDestination === 'regular_work' || raw.homeDestination === 'temporary_work' || raw.homeDestination === 'second_work' ? raw.homeDestination : null;
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    date: typeof raw.date === 'string' ? raw.date : '',
    startLocation: typeof raw.startLocation === 'string' ? raw.startLocation : '',
    endLocation: typeof raw.endLocation === 'string' ? raw.endLocation : '',
    miles: typeof raw.miles === 'number' && Number.isFinite(raw.miles) ? raw.miles : 0,
    businessPurpose: typeof raw.businessPurpose === 'string' ? raw.businessPurpose : '',
    roundTrip: raw.roundTrip === true,
    vehicleId: typeof raw.vehicleId === 'string' && raw.vehicleId.trim() ? raw.vehicleId.trim() : null,
    tripType,
    homeDestination,
  };
}

export function sortFinished(trips: readonly Pick<MileageTripFields, 'vehicleId' | 'tripType'>[]): boolean {
  return trips.length > 0 && trips.every(trip => Boolean(trip.vehicleId) && (trip.tripType === 'business' || trip.tripType === 'commute' || trip.tripType === 'personal'));
}

export function newTripAllowed(
  existing: readonly Pick<MileageTripFields, 'vehicleId' | 'tripType'>[],
  next: Pick<MileageTripFields, 'vehicleId' | 'tripType'>,
): { ok: true } | { ok: false; reason: string } {
  if (!sortFinished(existing)) return { ok: true };
  if (!next.vehicleId || !next.tripType) return { ok: false, reason: MILEAGE_VEHICLE_COPY.pickTripType };
  return { ok: true };
}

export function tripCreateRecord(input: {
  date: string;
  startLocation: string;
  endLocation: string;
  miles: number;
  businessPurpose: string;
  roundTrip: boolean;
  vehicleId?: string | null;
  tripType?: TripType | null;
  homeDestination?: HomeDestination | null;
}, existing: readonly MileageTripFields[], id = 'new'): { ok: true; trip: MileageTripFields } | { ok: false; reason: string } {
  const trip = normalizeStoredTrip({
    id,
    date: input.date,
    startLocation: input.startLocation,
    endLocation: input.endLocation,
    miles: input.miles,
    businessPurpose: input.businessPurpose,
    roundTrip: input.roundTrip,
    vehicleId: input.vehicleId ?? null,
    tripType: input.tripType ?? tripTypeFromBusinessPurpose(input.businessPurpose),
    homeDestination: input.homeDestination ?? null,
  });
  const gate = newTripAllowed(existing, trip);
  if (!gate.ok) return gate;
  return { ok: true, trip };
}

export function tripStartsAtHome(startLocation: string): boolean {
  const value = startLocation.trim().toLowerCase();
  return value === 'home' || value.startsWith('home ') || value.startsWith('home,');
}

export function applyHomeDestination(trip: MileageTripFields, choice: HomeDestination): MileageTripFields {
  if (choice === 'temporary_work') return { ...trip, tripType: 'business', homeDestination: choice };
  return { ...trip, tripType: 'commute', homeDestination: choice };
}

export function groupNeedsHomePrompt(trips: readonly MileageTripFields[]): boolean {
  return trips.some(trip => tripStartsAtHome(trip.startLocation));
}

export interface TripAssignment {
  vehicleId: string | null;
  tripType: TripType | null;
  homeDestination?: HomeDestination | null;
}

export function assignTrips(trips: readonly MileageTripFields[], tripIds: readonly string[], assignment: TripAssignment): MileageTripFields[] {
  const ids = new Set(tripIds);
  return trips.map(trip => {
    if (!ids.has(trip.id)) return trip;
    if (assignment.homeDestination) {
      return { ...applyHomeDestination(trip, assignment.homeDestination), vehicleId: assignment.vehicleId };
    }
    return {
      ...trip,
      vehicleId: assignment.vehicleId,
      tripType: assignment.tripType,
      homeDestination: assignment.tripType === 'commute' ? trip.homeDestination : null,
    };
  });
}

export function sortProgress(trips: readonly Pick<MileageTripFields, 'vehicleId' | 'tripType'>[]): { done: number; total: number; unsorted: number } {
  const total = trips.length;
  const done = trips.filter(trip => Boolean(trip.vehicleId) && Boolean(trip.tripType)).length;
  return { done, total, unsorted: total - done };
}

export interface TripGroupView {
  key: string;
  startLocation: string;
  endLocation: string;
  tripIds: string[];
  tripCount: number;
  miles: number;
  dateStart: string;
  dateEnd: string;
}

export function tripGroupKey(startLocation: string, endLocation: string): string {
  const start = startLocation.trim();
  const end = endLocation.trim();
  return start < end ? `${start}\u0000${end}` : `${end}\u0000${start}`;
}

export function groupTrips(trips: readonly MileageTripFields[]): { repeated: TripGroupView[]; oneOff: TripGroupView[] } {
  const buckets = new Map<string, MileageTripFields[]>();
  for (const trip of trips) {
    const key = tripGroupKey(trip.startLocation, trip.endLocation);
    buckets.set(key, [...(buckets.get(key) ?? []), trip]);
  }
  const groups: TripGroupView[] = [];
  for (const [key, members] of buckets) {
    const directions = new Map<string, { start: string; end: string; count: number }>();
    for (const trip of members) {
      const start = trip.startLocation.trim();
      const end = trip.endLocation.trim();
      const direction = `${start}\u0000${end}`;
      const current = directions.get(direction) ?? { start, end, count: 0 };
      current.count += 1;
      directions.set(direction, current);
    }
    const display = [...directions.values()].sort((a, b) => b.count - a.count || a.start.localeCompare(b.start) || a.end.localeCompare(b.end))[0];
    const dates = members.map(trip => trip.date).filter(Boolean).sort();
    groups.push({
      key,
      startLocation: display.start,
      endLocation: display.end,
      tripIds: members.map(trip => trip.id),
      tripCount: members.length,
      miles: members.reduce((sum, trip) => sum + (trip.roundTrip ? trip.miles * 2 : trip.miles), 0),
      dateStart: dates[0] ?? '',
      dateEnd: dates[dates.length - 1] ?? '',
    });
  }
  const byCount = (a: TripGroupView, b: TripGroupView) => b.tripCount - a.tripCount || a.startLocation.localeCompare(b.startLocation) || a.endLocation.localeCompare(b.endLocation);
  return {
    repeated: groups.filter(group => group.tripCount > 1).sort(byCount),
    oneOff: groups.filter(group => group.tripCount === 1).sort(byCount),
  };
}

export function vehicleToDocument(vehicle: VehicleRecord): Record<string, unknown> {
  return {
    name: vehicle.name,
    method: vehicle.method,
    ownership: vehicle.ownership,
    datePlacedInService: vehicle.datePlacedInService,
    odometerByYear: vehicle.odometerByYear,
    partIVByYear: vehicle.partIVByYear,
    legacyBusinessUsePercentage: vehicle.legacyBusinessUsePercentage,
    legacyMigration: vehicle.legacyMigration,
    reviewItems: vehicle.reviewItems,
    firstBusinessMethod: vehicle.firstBusinessMethod,
    depreciationMethod: vehicle.depreciationMethod,
    standardMileageSelected: vehicle.standardMileageSelected,
    leasedStandardLock: vehicle.leasedStandardLock,
  };
}

function yesNo(value: unknown): YesNo | null {
  return value === 'yes' || value === 'no' ? value : null;
}

export function vehicleFromDocument(id: string, data: Record<string, unknown> | undefined): VehicleRecord {
  const base = blankVehicle(id, 0);
  if (!data) return base;
  const method = committedMethod(data.method) ?? (data.method === 'unset' ? 'unset' : 'unset');
  const ownership = data.ownership === 'owned' || data.ownership === 'leased' || data.ownership === 'not_answered' ? data.ownership : 'not_answered';
  const odometerByYear: VehicleRecord['odometerByYear'] = {};
  if (data.odometerByYear && typeof data.odometerByYear === 'object') {
    for (const [year, value] of Object.entries(data.odometerByYear as Record<string, unknown>)) {
      const readings = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      odometerByYear[year] = { start: finiteNumber(readings.start), end: finiteNumber(readings.end) };
    }
  }
  const partIVByYear: VehicleRecord['partIVByYear'] = {};
  if (data.partIVByYear && typeof data.partIVByYear === 'object') {
    for (const [year, value] of Object.entries(data.partIVByYear as Record<string, unknown>)) {
      const answers = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      partIVByYear[year] = {
        offDutyPersonalUse: yesNo(answers.offDutyPersonalUse),
        otherVehicleForPersonalUse: yesNo(answers.otherVehicleForPersonalUse),
        hasEvidence: yesNo(answers.hasEvidence),
        evidenceWritten: yesNo(answers.evidenceWritten),
      };
    }
  }
  const reviewItems = Array.isArray(data.reviewItems)
    ? data.reviewItems.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      if (record.id !== 'legacy_method_disagreement') return [];
      return [{ id: 'legacy_method_disagreement' as const, message: typeof record.message === 'string' ? record.message : MILEAGE_VEHICLE_COPY.methodDisagree }];
    })
    : [];
  return {
    ...base,
    name: text(data.name) || base.name,
    method,
    ownership,
    datePlacedInService: validDate(text(data.datePlacedInService)) ? text(data.datePlacedInService) : '',
    odometerByYear,
    partIVByYear,
    legacyBusinessUsePercentage: finiteNumber(data.legacyBusinessUsePercentage),
    legacyMigration: data.legacyMigration === true,
    reviewItems,
    firstBusinessMethod: committedMethod(data.firstBusinessMethod),
    depreciationMethod: data.depreciationMethod === 'macrs' || data.depreciationMethod === 'straight_line' ? data.depreciationMethod : null,
    standardMileageSelected: data.standardMileageSelected === true,
    leasedStandardLock: data.leasedStandardLock === true,
  };
}
