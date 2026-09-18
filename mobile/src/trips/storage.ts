import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationSample, TripCandidate } from './geometry';

const SAMPLES_KEY = 'writeoff.trips.pendingSamples';
const CANDIDATES_KEY = 'writeoff.trips.candidates';
const MAX_SAMPLES = 5_000;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function appendSamples(samples: LocationSample[]): Promise<LocationSample[]> {
  const existing = await readJson<LocationSample[]>(SAMPLES_KEY, []);
  const merged = [...existing, ...samples].slice(-MAX_SAMPLES);
  await AsyncStorage.setItem(SAMPLES_KEY, JSON.stringify(merged));
  return merged;
}

export async function replaceSamples(samples: LocationSample[]): Promise<void> {
  await AsyncStorage.setItem(SAMPLES_KEY, JSON.stringify(samples.slice(-MAX_SAMPLES)));
}

export async function loadCandidates(): Promise<TripCandidate[]> {
  return readJson<TripCandidate[]>(CANDIDATES_KEY, []);
}

export async function addCandidates(candidates: TripCandidate[]): Promise<TripCandidate[]> {
  const existing = await loadCandidates();
  const known = new Set(existing.map(candidate => candidate.id));
  const merged = [...existing, ...candidates.filter(candidate => !known.has(candidate.id))];
  await AsyncStorage.setItem(CANDIDATES_KEY, JSON.stringify(merged));
  return merged;
}

export async function removeCandidate(id: string): Promise<TripCandidate[]> {
  const remaining = (await loadCandidates()).filter(candidate => candidate.id !== id);
  await AsyncStorage.setItem(CANDIDATES_KEY, JSON.stringify(remaining));
  return remaining;
}

/** Location data is deleted locally as soon as the user has classified or dismissed every trip. */
export async function clearAllTripData(): Promise<void> {
  await AsyncStorage.multiRemove([SAMPLES_KEY, CANDIDATES_KEY]);
}
