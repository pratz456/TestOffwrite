/**
 * First-touch campaign source. Stored in first-party localStorage for 30 days.
 * Values are capped and restricted so the record cannot hold an email, a token,
 * or a full URL. The first successful capture wins until it expires.
 */

export const ACQUISITION_STORAGE_KEY = 'writeoff.acquisition';
export const ACQUISITION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_VALUE_LENGTH = 64;
const UTM_VALUE = /^[a-z0-9_-]{1,64}$/;
const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LANDING_PATH = /^\/[A-Za-z0-9._~/-]{0,63}$/;
const CAPTURED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;
const CREATOR_MEDIUMS = new Set(['creator', 'affiliate']);

export type UtmKey = (typeof UTM_KEYS)[number];

export interface Acquisition {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  /** Flat creator or partner code. Present for a `ref` param, or for a creator/affiliate utm_source. */
  creatorRef?: string;
  referrerHost?: string;
  landingPath?: string;
  capturedAt: string;
}

export interface CaptureSource {
  search: string;
  referrer: string;
  pathname: string;
  hostname: string;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredAcquisition extends Acquisition {
  expiresAt: number;
}

export function sanitizeUtmValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const capped = value.trim().toLowerCase().slice(0, MAX_VALUE_LENGTH);
  return UTM_VALUE.test(capped) ? capped : undefined;
}

export function isOwnReferrerHost(host: string, pageHost?: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  if (normalized === 'writeoffapp.com' || normalized.endsWith('.writeoffapp.com')) return true;
  return Boolean(pageHost && normalized === pageHost.toLowerCase().replace(/\.$/, ''));
}

function referrerHostValue(value: unknown, pageHost?: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('://') || trimmed.startsWith('//')) {
    return externalReferrerHost(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed, pageHost);
  }
  return externalReferrerHost(`https://${trimmed}`, pageHost);
}

/** Hostname only. Paths, queries, and this site's own hosts are dropped. */
export function externalReferrerHost(referrer: unknown, pageHost?: string): string | undefined {
  if (typeof referrer !== 'string' || !referrer.trim() || referrer.length > 2048) return undefined;
  let url: URL;
  try { url = new URL(referrer); } catch { return undefined; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username || url.password) return undefined;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > MAX_VALUE_LENGTH || !HOSTNAME.test(host)) return undefined;
  if (isOwnReferrerHost(host, pageHost)) return undefined;
  return host;
}

export function sanitizeLandingPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/')) return undefined;
  const path = value.split(/[?#]/)[0].slice(0, MAX_VALUE_LENGTH);
  if (path.includes('//') || path.includes('..') || path.includes('@')) return undefined;
  return LANDING_PATH.test(path) ? path : undefined;
}

function validCapturedAt(value: unknown, now: number): string {
  if (typeof value === 'string' && CAPTURED_AT.test(value)) {
    const time = Date.parse(value);
    if (Number.isFinite(time) && time <= now + 5 * 60 * 1000 && time >= now - ACQUISITION_TTL_MS) return value;
  }
  return new Date(now).toISOString();
}

function hasCampaignSource(acquisition: Omit<Acquisition, 'capturedAt'>): boolean {
  return UTM_KEYS.some(key => Boolean(acquisition[key])) || Boolean(acquisition.referrerHost) || Boolean(acquisition.creatorRef);
}

/** Explicit `ref` wins. Otherwise a creator or affiliate medium uses utm_source. */
function creatorRefValue(record: Record<string, unknown>, utmSource?: string, utmMedium?: string): string | undefined {
  const explicit = sanitizeUtmValue(record.creatorRef) ?? sanitizeUtmValue(record.ref);
  if (explicit) return explicit;
  if (utmMedium && CREATOR_MEDIUMS.has(utmMedium) && utmSource) return utmSource;
  return undefined;
}

/** Keeps only known campaign fields. Returns null when no source was captured. */
export function acquisitionFromUnknown(input: unknown, now = Date.now()): Acquisition | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const acquisition: Acquisition = { capturedAt: validCapturedAt(record.capturedAt, now) };
  for (const key of UTM_KEYS) {
    const value = sanitizeUtmValue(record[key]);
    if (value) acquisition[key] = value;
  }
  const creatorRef = creatorRefValue(record, acquisition.utm_source, acquisition.utm_medium);
  if (creatorRef) acquisition.creatorRef = creatorRef;
  const referrerHost = referrerHostValue(record.referrerHost);
  if (referrerHost) acquisition.referrerHost = referrerHost;
  const landingPath = sanitizeLandingPath(record.landingPath);
  if (landingPath) acquisition.landingPath = landingPath;
  return hasCampaignSource(acquisition) ? acquisition : null;
}

function withoutExpiry(stored: StoredAcquisition): Acquisition {
  const acquisition: Acquisition = { capturedAt: stored.capturedAt };
  for (const key of UTM_KEYS) {
    const value = stored[key];
    if (value) acquisition[key] = value;
  }
  if (stored.creatorRef) acquisition.creatorRef = stored.creatorRef;
  if (stored.referrerHost) acquisition.referrerHost = stored.referrerHost;
  if (stored.landingPath) acquisition.landingPath = stored.landingPath;
  return acquisition;
}

function readStored(storage: KeyValueStorage, now: number): StoredAcquisition | null {
  let raw: string | null;
  try { raw = storage.getItem(ACQUISITION_STORAGE_KEY); } catch { return null; }
  if (!raw || raw.length > 2000) {
    if (raw) try { storage.removeItem(ACQUISITION_STORAGE_KEY); } catch { /* ignore */ }
    return null;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    try { storage.removeItem(ACQUISITION_STORAGE_KEY); } catch { /* ignore */ }
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const expiresAt = (parsed as { expiresAt?: unknown }).expiresAt;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    try { storage.removeItem(ACQUISITION_STORAGE_KEY); } catch { /* ignore */ }
    return null;
  }
  if (expiresAt <= now) {
    try { storage.removeItem(ACQUISITION_STORAGE_KEY); } catch { /* ignore */ }
    return null;
  }
  const acquisition = acquisitionFromUnknown(parsed, now);
  if (!acquisition) return null;
  return { ...acquisition, expiresAt };
}

export function readStoredAcquisition(storage: KeyValueStorage, now = Date.now()): Acquisition | null {
  const stored = readStored(storage, now);
  return stored ? withoutExpiry(stored) : null;
}

function captureFromSource(source: CaptureSource, now: number): Acquisition | null {
  const params = new URLSearchParams(source.search.startsWith('?') ? source.search.slice(1) : source.search);
  const record: Record<string, unknown> = {
    referrerHost: externalReferrerHost(source.referrer, source.hostname),
    landingPath: source.pathname,
    capturedAt: new Date(now).toISOString(),
  };
  for (const key of UTM_KEYS) record[key] = params.get(key) ?? undefined;
  record.ref = params.get('ref') ?? undefined;
  return acquisitionFromUnknown(record, now);
}

/** Reads the landing URL once. A later visit does not replace an unexpired capture. */
export function captureFirstTouch(storage: KeyValueStorage, now: number, source: CaptureSource): Acquisition | null {
  const existing = readStored(storage, now);
  if (existing) return withoutExpiry(existing);
  const captured = captureFromSource(source, now);
  if (!captured) return null;
  const stored: StoredAcquisition = { ...captured, expiresAt: now + ACQUISITION_TTL_MS };
  storage.setItem(ACQUISITION_STORAGE_KEY, JSON.stringify(stored));
  return captured;
}
