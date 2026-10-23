import React from 'react';
import { MILEAGE_VEHICLE_COPY } from '@/lib/mileage/vehicle-copy';
import type { HomeDestination, MileageTripFields, TripGroupView, TripType, VehiclePatch, VehicleRecord } from '@/lib/mileage/vehicles';
import { VehicleCards } from './vehicle-cards';

const TYPE_CHOICES = [
  ['business', MILEAGE_VEHICLE_COPY.business],
  ['commute', MILEAGE_VEHICLE_COPY.commute],
  ['personal', MILEAGE_VEHICLE_COPY.personal],
  ['unsure', MILEAGE_VEHICLE_COPY.notSure],
] as const;

function choiceButtons(selected: string | null, onPick: (value: TripType | 'unsure') => void) {
  return TYPE_CHOICES.map(([value, label]) => (
    <button
      key={value}
      type="button"
      aria-pressed={selected === value}
      className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${selected === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground'}`}
      onClick={() => onPick(value)}
    >
      {label}
    </button>
  ));
}

function GroupCard({
  group,
  trips,
  vehicles,
  open,
  selectedVehicleId,
  selectedType,
  showHomePrompt,
  homePromptTripId,
  onOpen,
  onSelectVehicle,
  onSelectType,
  onHomeChoice,
  onTripVehicle,
  onTripType,
  onTripHomeChoice,
}: {
  group: TripGroupView;
  trips: readonly MileageTripFields[];
  vehicles: readonly VehicleRecord[];
  open: boolean;
  selectedVehicleId: string | null;
  selectedType: TripType | 'unsure' | null;
  showHomePrompt: boolean;
  homePromptTripId: string | null;
  onOpen: () => void;
  onSelectVehicle: (vehicleId: string) => void;
  onSelectType: (tripType: TripType | 'unsure') => void;
  onHomeChoice: (choice: HomeDestination) => void;
  onTripVehicle: (tripId: string, vehicleId: string) => void;
  onTripType: (tripId: string, tripType: TripType | 'unsure') => void;
  onTripHomeChoice: (tripId: string, choice: HomeDestination) => void;
}) {
  const copy = MILEAGE_VEHICLE_COPY;
  const members = trips.filter(trip => group.tripIds.includes(trip.id));
  const dates = group.dateStart && group.dateStart === group.dateEnd ? group.dateStart : `${group.dateStart} ${copy.to} ${group.dateEnd}`;
  return (
    <article className="space-y-3 rounded-xl border border-border bg-card p-4">
      <button type="button" className="w-full text-left" onClick={onOpen}>
        <span className="block text-sm font-semibold text-foreground">{group.startLocation} {copy.to} {group.endLocation}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{group.tripCount} · {group.miles} {copy.miles} · {dates}</span>
      </button>
      <div className="flex flex-wrap gap-2">
        {vehicles.map(vehicle => (
          <button
            key={vehicle.id}
            type="button"
            aria-pressed={selectedVehicleId === vehicle.id}
            className={`min-h-11 rounded-lg border px-3 text-sm ${selectedVehicleId === vehicle.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground'}`}
            onClick={() => onSelectVehicle(vehicle.id)}
          >
            {vehicle.name}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">{choiceButtons(selectedType, onSelectType)}</div>
      {showHomePrompt ? (
        <div className="space-y-2 rounded-lg border border-border bg-background p-3">
          <p className="text-sm text-foreground">{copy.homePrompt}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm" onClick={() => onHomeChoice('regular_work')}>{copy.regularWork}</button>
            <button type="button" className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm" onClick={() => onHomeChoice('temporary_work')}>{copy.temporaryWork}</button>
            <button type="button" className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm" onClick={() => onHomeChoice('second_work')}>{copy.secondWork}</button>
          </div>
        </div>
      ) : null}
      {open ? members.map(trip => (
        <div key={trip.id} className="space-y-2 border-t border-border pt-3">
          <p className="text-sm text-foreground">{trip.date} · {trip.startLocation} {copy.to} {trip.endLocation} · {trip.miles} {copy.miles}</p>
          <div className="flex flex-wrap gap-2">
            {vehicles.map(vehicle => (
              <button key={vehicle.id} type="button" aria-pressed={trip.vehicleId === vehicle.id} className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm" onClick={() => onTripVehicle(trip.id, vehicle.id)}>
                {vehicle.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {choiceButtons(trip.tripType, value => onTripType(trip.id, value))}
          </div>
          {homePromptTripId === trip.id ? (
            <div className="space-y-2">
              <p className="text-sm text-foreground">{copy.homePrompt}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm" onClick={() => onTripHomeChoice(trip.id, 'regular_work')}>{copy.regularWork}</button>
                <button type="button" className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm" onClick={() => onTripHomeChoice(trip.id, 'temporary_work')}>{copy.temporaryWork}</button>
                <button type="button" className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm" onClick={() => onTripHomeChoice(trip.id, 'second_work')}>{copy.secondWork}</button>
              </div>
            </div>
          ) : null}
        </div>
      )) : null}
    </article>
  );
}

export function MileageUnsortedBanner({
  copyEnabled,
  unsortedCount,
  onSort,
}: {
  copyEnabled: boolean;
  unsortedCount: number;
  onSort?: () => void;
}) {
  if (!copyEnabled || unsortedCount < 1) return null;
  const label = MILEAGE_VEHICLE_COPY.banner(unsortedCount);
  if (!onSort) return <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-foreground">{label}</p>;
  return (
    <button type="button" role="status" className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-foreground" onClick={onSort}>
      {label}
    </button>
  );
}

export function TripSortScreen({
  copyEnabled,
  vehicles,
  taxYear,
  repeated,
  oneOff,
  trips,
  done,
  total,
  openGroupKey,
  homePromptKey,
  homePromptTripId,
  selectedVehicleByGroup,
  selectedTypeByGroup,
  vehicleErrors = {},
  onChangeVehicle,
  onAddVehicle,
  onOpenGroup,
  onSelectVehicle,
  onSelectType,
  onHomeChoice,
  onTripVehicle,
  onTripType,
  onTripHomeChoice,
}: {
  copyEnabled: boolean;
  vehicles: readonly VehicleRecord[];
  taxYear: number;
  repeated: readonly TripGroupView[];
  oneOff: readonly TripGroupView[];
  trips: readonly MileageTripFields[];
  done: number;
  total: number;
  openGroupKey: string | null;
  homePromptKey: string | null;
  homePromptTripId: string | null;
  selectedVehicleByGroup: Record<string, string | null>;
  selectedTypeByGroup: Record<string, TripType | 'unsure' | null>;
  vehicleErrors?: Record<string, string>;
  onChangeVehicle: (vehicleId: string, patch: VehiclePatch) => void;
  onAddVehicle: () => void;
  onOpenGroup: (key: string) => void;
  onSelectVehicle: (key: string, vehicleId: string) => void;
  onSelectType: (key: string, tripType: TripType | 'unsure') => void;
  onHomeChoice: (key: string, choice: HomeDestination) => void;
  onTripVehicle: (tripId: string, vehicleId: string) => void;
  onTripType: (tripId: string, tripType: TripType | 'unsure') => void;
  onTripHomeChoice: (tripId: string, choice: HomeDestination) => void;
}) {
  if (!copyEnabled) return null;
  const copy = MILEAGE_VEHICLE_COPY;
  const renderGroup = (group: TripGroupView) => (
    <GroupCard
      key={group.key}
      group={group}
      trips={trips}
      vehicles={vehicles}
      open={openGroupKey === group.key}
      selectedVehicleId={selectedVehicleByGroup[group.key] ?? null}
      selectedType={selectedTypeByGroup[group.key] ?? null}
      showHomePrompt={homePromptKey === group.key}
      homePromptTripId={homePromptTripId}
      onOpen={() => onOpenGroup(group.key)}
      onSelectVehicle={vehicleId => onSelectVehicle(group.key, vehicleId)}
      onSelectType={tripType => onSelectType(group.key, tripType)}
      onHomeChoice={choice => onHomeChoice(group.key, choice)}
      onTripVehicle={onTripVehicle}
      onTripType={onTripType}
      onTripHomeChoice={onTripHomeChoice}
    />
  );
  return (
    <section className="space-y-4">
      <VehicleCards copyEnabled={copyEnabled} vehicles={vehicles} taxYear={taxYear} detail="trip" errors={vehicleErrors} onChange={onChangeVehicle} onAdd={onAddVehicle} />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">{copy.sortTitle}</h1>
        <p className="text-sm text-muted-foreground">{copy.pickTripType}</p>
        <p className="text-sm text-foreground">{copy.progress(done, total)}</p>
      </div>
      {repeated.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">{copy.repeatedTrips}</h2>
          {repeated.map(renderGroup)}
        </div>
      ) : null}
      {oneOff.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">{copy.oneOffTrips}</h2>
          {oneOff.map(renderGroup)}
        </div>
      ) : null}
    </section>
  );
}
