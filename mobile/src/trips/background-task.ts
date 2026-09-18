import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { detectTrips, type LocationSample } from './geometry';
import { addCandidates, appendSamples, replaceSamples } from './storage';

export const TRIP_LOCATION_TASK = 'writeoff-trip-location';

TaskManager.defineTask(TRIP_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  const samples: LocationSample[] = locations.map(location => ({
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    timestamp: location.timestamp,
    speed: location.coords.speed,
    accuracy: location.coords.accuracy,
  }));
  const all = await appendSamples(samples);
  const { completed, open } = detectTrips(all);
  if (completed.length) await addCandidates(completed);
  // Keep only the still-open trip; completed trips are now candidates and raw points are dropped.
  await replaceSamples(open);
});

export async function requestTripPermissions(): Promise<'granted' | 'foreground-only' | 'denied'> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return 'denied';
  const background = await Location.requestBackgroundPermissionsAsync();
  return background.status === 'granted' ? 'granted' : 'foreground-only';
}

export async function isTripDetectionRunning(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(TRIP_LOCATION_TASK);
}

export async function startTripDetection(): Promise<void> {
  if (await isTripDetectionRunning()) return;
  await Location.startLocationUpdatesAsync(TRIP_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    // Automotive activity lets iOS pause updates when the user is not driving.
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: true,
    distanceInterval: 50,
    deferredUpdatesInterval: 60_000,
    deferredUpdatesDistance: 200,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'WriteOff trip detection',
      notificationBody: 'Recording drives so you can classify business mileage later.',
    },
  });
}

export async function stopTripDetection(): Promise<void> {
  if (await isTripDetectionRunning()) await Location.stopLocationUpdatesAsync(TRIP_LOCATION_TASK);
}
