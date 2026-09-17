/**
 * Pure trip-detection logic shared by the background task and tests.
 * Detected trips are candidates only; the user must classify each one and
 * state its business purpose before it becomes a mileage record.
 */
export interface LocationSample {
  latitude: number;
  longitude: number;
  /** Unix epoch milliseconds. */
  timestamp: number;
  /** Meters per second when the platform reports it. */
  speed?: number | null;
  /** Horizontal accuracy in meters; large values are ignored. */
  accuracy?: number | null;
}

export interface TripCandidate {
  id: string;
  startedAt: number;
  endedAt: number;
  miles: number;
  start: { latitude: number; longitude: number };
  end: { latitude: number; longitude: number };
  sampleCount: number;
}

export const TRIP_DETECTION = Object.freeze({
  /** Roughly 10 mph: sustained movement above this starts a trip. */
  drivingSpeedMetersPerSecond: 4.5,
  /** Below roughly 2 mph counts as stationary. */
  stationarySpeedMetersPerSecond: 0.9,
  /** Stationary this long ends the trip. */
  stopGapMs: 5 * 60 * 1000,
  /** Samples less accurate than this are discarded. */
  maxAccuracyMeters: 65,
  /** Shorter trips are noise, parking-lot moves or GPS drift. */
  minimumMiles: 0.5,
  /** Consecutive driving-speed samples needed to open a trip. */
  startConfirmationSamples: 2,
});

const EARTH_RADIUS_METERS = 6_371_008.8;
const METERS_PER_MILE = 1_609.344;

export function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function metersToMiles(meters: number): number {
  return Math.round((meters / METERS_PER_MILE) * 10) / 10;
}

function usable(sample: LocationSample): boolean {
  return Number.isFinite(sample.latitude) && Number.isFinite(sample.longitude) && Number.isFinite(sample.timestamp)
    && (sample.accuracy == null || sample.accuracy <= TRIP_DETECTION.maxAccuracyMeters);
}

/** Speed from the platform when present, otherwise derived from the previous sample. */
function speedOf(previous: LocationSample | undefined, current: LocationSample): number {
  if (typeof current.speed === 'number' && current.speed >= 0) return current.speed;
  if (!previous) return 0;
  const seconds = (current.timestamp - previous.timestamp) / 1000;
  return seconds > 0 ? haversineMeters(previous, current) / seconds : 0;
}

/** Splits an ordered sample stream into completed trip candidates plus any still-open trip. */
export function detectTrips(input: LocationSample[]): { completed: TripCandidate[]; open: LocationSample[] } {
  const samples = input.filter(usable).sort((a, b) => a.timestamp - b.timestamp);
  const completed: TripCandidate[] = [];
  let current: LocationSample[] = [];
  let warmup: LocationSample[] = [];
  let lastMovingAt: number | null = null;

  const close = () => {
    if (current.length >= 2) {
      const trip = summarizeTrip(current);
      if (trip && trip.miles >= TRIP_DETECTION.minimumMiles) completed.push(trip);
    }
    current = [];
    lastMovingAt = null;
  };

  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    const speed = speedOf(samples[index - 1], sample);
    if (current.length) {
      current.push(sample);
      if (speed >= TRIP_DETECTION.stationarySpeedMetersPerSecond) lastMovingAt = sample.timestamp;
      else if (lastMovingAt !== null && sample.timestamp - lastMovingAt >= TRIP_DETECTION.stopGapMs) close();
      continue;
    }
    if (speed >= TRIP_DETECTION.drivingSpeedMetersPerSecond) {
      warmup.push(sample);
      if (warmup.length >= TRIP_DETECTION.startConfirmationSamples) {
        current = [...warmup];
        lastMovingAt = sample.timestamp;
        warmup = [];
      }
    } else {
      warmup = [];
    }
  }
  return { completed, open: current };
}

export function summarizeTrip(samples: LocationSample[]): TripCandidate | null {
  if (samples.length < 2) return null;
  let meters = 0;
  for (let index = 1; index < samples.length; index++) meters += haversineMeters(samples[index - 1]!, samples[index]!);
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  return {
    id: `trip-${first.timestamp}-${last.timestamp}`,
    startedAt: first.timestamp,
    endedAt: last.timestamp,
    miles: metersToMiles(meters),
    start: { latitude: first.latitude, longitude: first.longitude },
    end: { latitude: last.latitude, longitude: last.longitude },
    sampleCount: samples.length,
  };
}

/** Calendar day in the device's local time zone, matching how the web app records manual trips. */
export function localCalendarDay(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
