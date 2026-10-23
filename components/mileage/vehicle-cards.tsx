import React from 'react';
import { MILEAGE_VEHICLE_COPY } from '@/lib/mileage/vehicle-copy';
import {
  odometerForYear,
  partIVForYear,
  vehicleNeedsReview,
  type DeductionMethod,
  type VehicleOwnership,
  type VehiclePatch,
  type VehicleRecord,
  type YesNo,
} from '@/lib/mileage/vehicles';

function answerValue(value: YesNo | null): string {
  return value ?? '';
}

function answerPatch(value: string): YesNo | null {
  return value === 'yes' || value === 'no' ? value : null;
}

export function VehicleCards({
  copyEnabled,
  vehicles,
  taxYear,
  detail = 'full',
  errors = {},
  onChange,
  onAdd,
}: {
  copyEnabled: boolean;
  vehicles: readonly VehicleRecord[];
  taxYear: number;
  detail?: 'full' | 'trip';
  errors?: Record<string, string>;
  onChange: (vehicleId: string, patch: VehiclePatch) => void;
  onAdd: () => void;
}) {
  if (!copyEnabled) return null;
  const copy = MILEAGE_VEHICLE_COPY;
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{copy.yourCars}</h2>
        <button type="button" className="min-h-11 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground" onClick={onAdd}>
          {copy.addCar}
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {vehicles.map(vehicle => {
          const readings = odometerForYear(vehicle, taxYear);
          const answers = partIVForYear(vehicle, taxYear);
          const missingOdometer = readings.start === null || readings.end === null;
          return (
            <article key={vehicle.id} className="space-y-3 rounded-xl border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">{vehicle.name}</h3>
                {vehicleNeedsReview(vehicle, taxYear) ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950">{copy.review}</span>
                ) : null}
              </div>
              {vehicle.reviewItems.map(item => (
                <p key={item.id} className="text-sm text-foreground">{item.message}</p>
              ))}
              {detail === 'full' && missingOdometer ? <p className="text-sm text-muted-foreground">{copy.odometerReview}</p> : null}
              {vehicle.legacyBusinessUsePercentage !== null ? (
                <p className="text-sm text-muted-foreground">
                  {copy.legacyPercentage}{' '}
                  <output>{vehicle.legacyBusinessUsePercentage}%</output>
                </p>
              ) : null}
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{copy.vehicleName}</span>
                <input
                  className="h-11 w-full rounded-lg border border-border bg-card px-3 text-base"
                  aria-label={copy.vehicleName}
                  defaultValue={vehicle.name}
                  onBlur={event => onChange(vehicle.id, { name: event.target.value })}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{copy.deductionMethod}</span>
                <select
                  className="h-11 w-full rounded-lg border border-border bg-card px-3 text-base"
                  aria-label={copy.deductionMethod}
                  value={vehicle.method}
                  onChange={event => onChange(vehicle.id, { method: event.target.value as DeductionMethod })}
                >
                  <option value="unset">{copy.notSet}</option>
                  <option value="standard_mileage">{copy.standardMileage}</option>
                  <option value="actual_expense">{copy.actualExpense}</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{copy.ownedOrLeased}</span>
                <select
                  className="h-11 w-full rounded-lg border border-border bg-card px-3 text-base"
                  aria-label={copy.ownedOrLeased}
                  value={vehicle.ownership}
                  onChange={event => onChange(vehicle.id, { ownership: event.target.value as VehicleOwnership })}
                >
                  <option value="not_answered">{copy.notAnswered}</option>
                  <option value="owned">{copy.owned}</option>
                  <option value="leased">{copy.leased}</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{copy.dateFirstUsed}</span>
                <input
                  className="h-11 w-full rounded-lg border border-border bg-card px-3 text-base"
                  aria-label={copy.dateFirstUsed}
                  type="date"
                  defaultValue={vehicle.datePlacedInService}
                  onBlur={event => onChange(vehicle.id, { datePlacedInService: event.target.value })}
                />
              </label>
              {detail === 'full' ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">{copy.odometerJan1}</span>
                      <input
                        className="h-11 w-full rounded-lg border border-border bg-card px-3 text-base"
                        aria-label={copy.odometerJan1}
                        inputMode="decimal"
                        defaultValue={readings.start ?? ''}
                        onBlur={event => onChange(vehicle.id, { taxYear, odometerStart: event.target.value.trim() === '' ? null : Number(event.target.value) })}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">{copy.odometerDec31}</span>
                      <input
                        className="h-11 w-full rounded-lg border border-border bg-card px-3 text-base"
                        aria-label={copy.odometerDec31}
                        inputMode="decimal"
                        defaultValue={readings.end ?? ''}
                        onBlur={event => onChange(vehicle.id, { taxYear, odometerEnd: event.target.value.trim() === '' ? null : Number(event.target.value) })}
                      />
                    </label>
                  </div>
                  {([
                    ['offDutyPersonalUse', copy.partIVOffDuty, answers.offDutyPersonalUse],
                    ['otherVehicleForPersonalUse', copy.partIVOtherCar, answers.otherVehicleForPersonalUse],
                    ['hasEvidence', copy.partIVEvidence, answers.hasEvidence],
                    ['evidenceWritten', copy.partIVWritten, answers.evidenceWritten],
                  ] as const).map(([key, label, value]) => (
                    <label key={key} className="block space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">{label}</span>
                      <select
                        className="h-11 w-full rounded-lg border border-border bg-card px-3 text-base"
                        aria-label={label}
                        value={answerValue(value)}
                        onChange={event => onChange(vehicle.id, { taxYear, partIV: { [key]: answerPatch(event.target.value) } })}
                      >
                        <option value="">{copy.notAnswered}</option>
                        <option value="yes">{copy.yes}</option>
                        <option value="no">{copy.no}</option>
                      </select>
                    </label>
                  ))}
                </>
              ) : null}
              {errors[vehicle.id] ? <p role="alert" className="text-sm text-destructive">{errors[vehicle.id]}</p> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
