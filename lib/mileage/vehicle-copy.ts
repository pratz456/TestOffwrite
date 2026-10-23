/** User visible mileage vehicle copy. Off unless NEXT_PUBLIC_MILEAGE_VEHICLE_COPY is "1". */
export const MILEAGE_VEHICLE_COPY_FLAG = 'NEXT_PUBLIC_MILEAGE_VEHICLE_COPY';

export const MILEAGE_VEHICLE_COPY = {
  pickTripType: 'Pick a trip type so we know whether these miles count.',
  homePrompt: 'Where did this trip from home go? Your regular work place (commute), a temporary work location, or a second work location?',
  methodDisagree: 'Your settings had two different methods for this car. Pick the one you used.',
  odometerReview: 'Add your start and end odometer readings for this year. We need them to work out your business share.',
  legacyPercentage: 'Percentage you entered before. We now use your trip log instead.',
  vehicleName: 'Vehicle name',
  deductionMethod: 'Deduction method',
  ownedOrLeased: 'Owned or leased',
  dateFirstUsed: 'Date first used for business',
  odometerJan1: 'Odometer at start of year (or when first used)',
  odometerDec31: 'Odometer at end of year (or when sold)',
  dateSold: 'Date sold or stopped using',
  midYearMethod: 'A change partway through the year is not split. This car keeps one method for the whole year.',
  invalidMethodDate: 'Enter a date in this tax year, or leave it blank.',
  partIVOffDuty: "Was this car available for personal use when you weren't working?",
  partIVOtherCar: 'Do you or your spouse have another car for personal use?',
  partIVEvidence: 'Do you have records to back up your mileage?',
  partIVWritten: 'Are those records written?',
  sortTitle: 'Sort your trips',
  yourCars: 'Your cars',
  addCar: 'Add a car',
  repeatedTrips: "Trips you've driven more than once",
  oneOffTrips: 'One-off trips',
  business: 'Business',
  commute: 'Commute',
  personal: 'Personal',
  notSure: 'Not sure',
  review: 'Review',
  notSet: 'Not set',
  standardMileage: 'Standard mileage',
  actualExpense: 'Actual expense',
  owned: 'Owned',
  leased: 'Leased',
  notAnswered: 'Not answered',
  yes: 'Yes',
  no: 'No',
  regularWork: 'Your regular work place (commute)',
  temporaryWork: 'a temporary work location',
  secondWork: 'a second work location',
  vehicleFallbackName: 'Vehicle 1',
  miles: 'miles',
  to: 'to',
  enterName: 'Enter a vehicle name.',
  vehicleMissing: 'That car could not be found.',
  invalidMethod: 'Choose a valid deduction method.',
  invalidOwnership: 'Choose owned, leased, or leave this unanswered.',
  invalidDate: 'Enter a valid date first used for business, or leave it blank.',
  invalidOdometer: 'Enter odometer readings as numbers, or leave them blank.',
  invalidAnswer: 'Answer yes or no, or leave the question unanswered.',
  saveFailed: 'Could not save this car.',
  addFailed: 'Could not add a car.',
  loadFailed: 'Could not load your cars.',
  sortFailed: 'Could not sort these trips.',
  invalidVehicleUpdate: 'Provide a valid car update.',
  invalidSort: 'Provide a valid trip sort.',
  macrsLock: 'This car used actual expenses in its first business year, so it can\'t switch to the standard mileage rate.',
  ownedFirstYear: 'An owned car can use the standard mileage rate only when that rate was used in the first year the car was used for business.',
  leaseStay: 'A leased car on the standard mileage rate has to stay on it for the whole lease, including renewals.',
  leaseWhole: 'A leased car can use the standard mileage rate only when that rate is used for the whole lease, including renewals.',
  fiveVehicles: 'Five or more vehicles in business use at the same time cannot use the standard mileage rate.',
  fiveAtOnceQuestion: 'Do you use 5 or more of these for business at the same time?',
  banner(count: number) {
    return `You have ${count} trips to sort. Pick a car and a trip type so they can count.`;
  },
  progress(done: number, total: number) {
    return `${done} of ${total} trips sorted. Trips you haven't sorted don't count yet.`;
  },
  vehicleNumber(count: number) {
    return count === 1 ? MILEAGE_VEHICLE_COPY.vehicleFallbackName : `Vehicle ${count}`;
  },
} as const;

const STATIC_COPY_KEYS = [
  'pickTripType', 'homePrompt', 'methodDisagree', 'odometerReview', 'legacyPercentage',
  'vehicleName', 'deductionMethod', 'ownedOrLeased', 'dateFirstUsed', 'odometerJan1', 'odometerDec31', 'dateSold', 'midYearMethod', 'invalidMethodDate',
  'partIVOffDuty', 'partIVOtherCar', 'partIVEvidence', 'partIVWritten', 'sortTitle', 'yourCars', 'addCar',
  'repeatedTrips', 'oneOffTrips', 'business', 'commute', 'personal', 'notSure', 'review', 'notSet',
  'standardMileage', 'actualExpense', 'owned', 'leased', 'notAnswered', 'yes', 'no', 'regularWork',
  'temporaryWork', 'secondWork', 'vehicleFallbackName', 'miles', 'to', 'enterName', 'vehicleMissing',
  'invalidMethod', 'invalidOwnership', 'invalidDate', 'invalidOdometer', 'invalidAnswer', 'saveFailed',
  'addFailed', 'loadFailed', 'sortFailed', 'invalidVehicleUpdate', 'invalidSort', 'macrsLock', 'ownedFirstYear', 'leaseStay', 'leaseWhole', 'fiveVehicles', 'fiveAtOnceQuestion',
] as const;

/** Every new user visible string. Empty when the copy flag is off. */
export function mileageVehicleCopyCatalog(enabled: boolean): string[] {
  if (!enabled) return [];
  const copy = MILEAGE_VEHICLE_COPY;
  return [
    ...STATIC_COPY_KEYS.map(key => copy[key]),
    copy.banner(3),
    copy.progress(1, 4),
    copy.vehicleNumber(2),
  ];
}

export function mileageVehicleCopyEnabled(
  env: { NEXT_PUBLIC_MILEAGE_VEHICLE_COPY?: string } = {
    NEXT_PUBLIC_MILEAGE_VEHICLE_COPY: process.env.NEXT_PUBLIC_MILEAGE_VEHICLE_COPY,
  },
): boolean {
  return env.NEXT_PUBLIC_MILEAGE_VEHICLE_COPY === '1';
}
