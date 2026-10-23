import { mkdirSync, writeFileSync } from 'node:fs';
process.env.NEXT_PUBLIC_MILEAGE_VEHICLE_COPY = '1';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VehicleCards } from '../components/mileage/vehicle-cards';
import { MileageUnsortedBanner, TripSortScreen } from '../components/mileage/trip-sort-screen';
import { blankVehicle, groupTrips, planLegacyVehicle, saveVehicle, type MileageTripFields, type VehicleRecord } from '../lib/mileage/vehicles';

const migrated = planLegacyVehicle({
  vehicle_deduction_method: 'standard_mileage',
  vehicle_business_use_percentage: 42,
  business_vehicle: { make: 'Honda', model: 'Civic', year: 2018, deduction_method: 'actual_expense', business_use_percentage: 42 },
}, []).inserted!;

let fleet: VehicleRecord[] = [migrated];
const second = blankVehicle('civic-2', fleet.length);
second.name = 'Studio van';
fleet = [...fleet, second];
const saved = saveVehicle(fleet, second.id, { ownership: 'owned', method: 'standard_mileage', datePlacedInService: '2026-07-01', taxYear: 2026, odometerStart: 24000, odometerEnd: 31000 });
if (!saved.ok) throw new Error(saved.reason);
fleet = saved.vehicles;

const tripRows = [
  ['t1', 'Home', 'Office', '2026-01-06', 12],
  ['t2', 'Office', 'Home', '2026-01-07', 12],
  ['t3', 'Home', 'Office', '2026-01-14', 11],
  ['t4', 'Office', 'Home', '2026-02-02', 12],
  ['t5', 'Home', 'Office', '2026-02-18', 13],
  ['t6', 'Office', 'Home', '2026-03-03', 12],
  ['t7', 'Studio', 'Client', '2026-01-20', 8],
  ['t8', 'Client', 'Studio', '2026-02-11', 8],
  ['t9', 'Studio', 'Client', '2026-03-09', 9],
  ['t10', 'Airport', 'Hotel', '2026-04-02', 18],
] as const;
const trips: MileageTripFields[] = tripRows.map(([id, startLocation, endLocation, date, miles]) => ({
  id, date, startLocation, endLocation, miles, businessPurpose: '', roundTrip: false,
  vehicleId: null, tripType: null, homeDestination: null,
}));
const groups = groupTrips(trips);

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="preview.css"></head><body class="bg-background text-foreground"><main class="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">${body}</main></body></html>`;
}

const settings = renderToStaticMarkup(
  <VehicleCards copyEnabled vehicles={fleet} taxYear={2026} onChange={() => undefined} onAdd={() => undefined} />,
);
const sort = renderToStaticMarkup(
  <div className="space-y-4">
    <MileageUnsortedBanner copyEnabled unsortedCount={trips.length} onSort={() => undefined} />
    <TripSortScreen
      copyEnabled
      vehicles={fleet}
      taxYear={2026}
      repeated={groups.repeated}
      oneOff={groups.oneOff}
      trips={trips}
      done={0}
      total={trips.length}
      openGroupKey={groups.repeated[0]?.key ?? null}
      homePromptKey={groups.repeated[0]?.key ?? null}
      homePromptTripId={null}
      selectedVehicleByGroup={{}}
      selectedTypeByGroup={{}}
      onChangeVehicle={() => undefined}
      onAddVehicle={() => undefined}
      onOpenGroup={() => undefined}
      onSelectVehicle={() => undefined}
      onSelectType={() => undefined}
      onHomeChoice={() => undefined}
      onTripVehicle={() => undefined}
      onTripType={() => undefined}
      onTripHomeChoice={() => undefined}
    />
  </div>,
);

const out = '/tmp/mileage-preview';
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/settings.html`, page('Your cars', settings));
writeFileSync(`${out}/sort.html`, page('Sort your trips', sort));
console.log(out);
