import { describe, expect, it } from 'vitest';
import { detectTrips, haversineMeters, localCalendarDay, metersToMiles, TRIP_DETECTION, type LocationSample } from '../mobile/src/trips/geometry';

const start = { latitude: 37.7749, longitude: -122.4194 };
/** Straight-line samples heading north at a steady speed, one per `stepSeconds`. */
function drive(from: { latitude: number; longitude: number }, startAt: number, count: number, speed: number, stepSeconds = 30): LocationSample[] {
  const degreesPerMeter = 1 / 111_320;
  return Array.from({ length: count }, (_, index) => ({
    latitude: from.latitude + speed * stepSeconds * index * degreesPerMeter,
    longitude: from.longitude,
    timestamp: startAt + index * stepSeconds * 1000,
    speed,
    accuracy: 10,
  }));
}
function parked(at: { latitude: number; longitude: number }, startAt: number, count: number, stepSeconds = 60): LocationSample[] {
  return Array.from({ length: count }, (_, index) => ({ ...at, timestamp: startAt + index * stepSeconds * 1000, speed: 0, accuracy: 10 }));
}

describe('trip detection geometry', () => {
  it('measures distance with haversine and rounds to tenths of a mile', () => {
    const oneKmNorth = { latitude: start.latitude + 1000 / 111_320, longitude: start.longitude };
    expect(haversineMeters(start, oneKmNorth)).toBeCloseTo(1000, -1);
    expect(metersToMiles(1609.344)).toBe(1);
    expect(metersToMiles(804)).toBe(0.5);
  });

  it('opens a trip only after sustained driving speed and closes it after a five-minute stop', () => {
    const t0 = Date.parse('2026-09-17T15:00:00Z');
    const driving = drive(start, t0, 20, 15); // ~9,000 m over 10 minutes
    const last = driving[driving.length - 1]!;
    const stopped = parked({ latitude: last.latitude, longitude: last.longitude }, last.timestamp + 60_000, 7);
    const { completed, open } = detectTrips([...parked(start, t0 - 600_000, 3), ...driving, ...stopped]);
    expect(completed).toHaveLength(1);
    expect(completed[0]!.miles).toBeGreaterThan(5);
    expect(completed[0]!.miles).toBeLessThan(6);
    expect(completed[0]!.startedAt).toBe(t0);
    expect(open).toEqual([]);
  });

  it('keeps an unfinished drive open instead of guessing where it ended', () => {
    const t0 = Date.parse('2026-09-17T15:00:00Z');
    const { completed, open } = detectTrips(drive(start, t0, 6, 15));
    expect(completed).toEqual([]);
    expect(open.length).toBe(6);
  });

  it('discards inaccurate samples, one-off speed spikes and sub-half-mile moves', () => {
    const t0 = Date.parse('2026-09-17T15:00:00Z');
    const noisy: LocationSample[] = [
      { ...start, timestamp: t0, speed: 0, accuracy: 10 },
      { latitude: 37.9, longitude: -122.4194, timestamp: t0 + 1000, speed: 40, accuracy: 500 },
      { ...start, timestamp: t0 + 2000, speed: 12, accuracy: 10 },
      { ...start, timestamp: t0 + 3000, speed: 0, accuracy: 10 },
    ];
    expect(detectTrips(noisy).completed).toEqual([]);
    const short = drive(start, t0, 3, 5, 20); // ~200 m
    const end = short[short.length - 1]!;
    const result = detectTrips([...short, ...parked({ latitude: end.latitude, longitude: end.longitude }, end.timestamp + 60_000, 7)]);
    expect(result.completed).toEqual([]);
    expect(TRIP_DETECTION.minimumMiles).toBe(0.5);
  });

  it('records the trip on the device local calendar day', () => {
    const timestamp = new Date(2026, 8, 17, 23, 30).getTime();
    expect(localCalendarDay(timestamp)).toBe('2026-09-17');
  });
});
