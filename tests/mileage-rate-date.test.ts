import fs from 'fs';
import path from 'path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { businessMileageRateForDate } from '../lib/tax-rules/mileage-rates';

const previousTz = process.env.TZ;
process.env.TZ = 'America/Los_Angeles';
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

const firestore = vi.hoisted(() => ({ docs: [] as Array<{ id: string; data: () => Record<string, unknown> }> }));
vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          get: async () => ({
            forEach(callback: (doc: { id: string; data: () => Record<string, unknown> }) => void) {
              firestore.docs.forEach(callback);
            },
          }),
        }),
      }),
    }),
  },
}));

import { getMileageTrips } from '../lib/firebase/mileage-server';

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function callSites(name: string): string[] {
  const hits: string[] = [];
  const roots = ['lib', 'components', 'app'].map(dir => path.join(process.cwd(), dir));
  for (const file of roots.flatMap(sourceFiles)) {
    const rel = path.relative(process.cwd(), file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!line.includes(`${name}(`)) return;
      if (/^\s*import\s/.test(line) || line.includes(`function ${name}`)) return;
      const arg = line.split(`${name}(`)[1]?.split(')')[0]?.trim() ?? '';
      hits.push(`${rel}:${index + 1}:${arg}`);
    });
  }
  return hits.sort();
}

function trip(id: string, date: unknown, extra: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      userId: 'owner',
      date,
      startLocation: 'Office',
      endLocation: 'Client',
      miles: 10,
      businessPurpose: 'Client meeting',
      roundTrip: false,
      ...extra,
    }),
  };
}

const losAngelesEvening = new Date('2026-07-01T03:00:00.000Z');
const ambiguousInstant = new Date('2026-06-30T22:00:00.000Z');

function zoneClock(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function savedZoneView(
  period: { ratePerMile?: unknown; zoneSource?: unknown } | null,
  carrier?: { zoneSource?: unknown },
): { ratePerMile: number | null; zoneSource: 'saved trip zone' | undefined } {
  return {
    ratePerMile: typeof period?.ratePerMile === 'number' ? period.ratePerMile : null,
    zoneSource: period?.zoneSource === 'saved trip zone' || carrier?.zoneSource === 'saved trip zone' ? 'saved trip zone' : undefined,
  };
}

async function pricesSavedZone(date: Date, timeZone: string, id: string) {
  const saved = { date, timeZone };
  firestore.docs = [trip(id, date, { timeZone })];
  const read = await getMileageTrips('owner', 2026);
  const returned = read.data[0] as { date?: unknown; zoneSource?: unknown } | undefined;
  const fromPeriod = returned ? businessMileageRateForDate(returned.date as never) : null;
  const directPeriod = businessMileageRateForDate(saved as never);
  return {
    fromRead: savedZoneView(fromPeriod, returned),
    direct: savedZoneView(directPeriod),
  };
}

async function prices(date: unknown, extra: Record<string, unknown> = {}): Promise<{ fromRead: unknown; direct: unknown }> {
  firestore.docs = [trip('boundary', date, extra)];
  const read = await getMileageTrips('owner', 2026);
  let fromRead: unknown = `omitted:${read.data.length}`;
  if (read.error) fromRead = 'threw';
  else if (read.data.length === 1) {
    try {
      fromRead = businessMileageRateForDate(read.data[0].date as never)?.ratePerMile ?? null;
    } catch (error) {
      fromRead = `threw:${error instanceof Error ? error.message : String(error)}`;
    }
  }
  let direct: unknown;
  try {
    direct = businessMileageRateForDate(date as never)?.ratePerMile ?? null;
  } catch (error) {
    direct = `threw:${error instanceof Error ? error.message : String(error)}`;
  }
  return { fromRead, direct };
}

describe('mileage rate dates in America/Los_Angeles', () => {
  it('confirms the process time zone is America/Los_Angeles', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
    expect(new Date('2026-04-15').getDate()).toBe(14);
  });

  it('locks mileage rate callers to string calendar days', () => {
    expect(callSites('businessMileageRateForDate')).toEqual([
      'components/mileage-tracker-screen.tsx:45:trip.date',
      'lib/reports/audit-support-packet.ts:266:date',
      'lib/tax-rules/mileage-rates.ts:48:trip.date',
    ]);
    expect(callSites('summarizeBusinessMileage')).toEqual([
      'components/mileage-tracker-screen.tsx:156:yearTrips.map(t => ({ date: t.date, miles: getEffectiveMiles(t',
      'lib/reports/audit-support-packet.ts:326:trips',
    ]);
    const packet = fs.readFileSync(path.join(process.cwd(), 'lib/reports/audit-support-packet.ts'), 'utf8');
    expect(packet).toContain('const date = exportDate(trip.date)');
    expect(packet).toContain('if (!date) { undated += 1; continue; }');
  });

  it('rates YYYY-MM-DD trip strings on the published boundary', () => {
    expect(businessMileageRateForDate('2026-06-30')?.ratePerMile).toBe(0.725);
    expect(businessMileageRateForDate('2026-07-01')?.ratePerMile).toBe(0.76);
  });

  it('builds the June 30 2026 8 PM Los Angeles instant and the ambiguous June 30 22:00 UTC instant', () => {
    expect(losAngelesEvening.toISOString()).toBe('2026-07-01T03:00:00.000Z');
    expect(zoneClock(losAngelesEvening, 'America/Los_Angeles')).toBe('2026-06-30 20:00');
    expect(ambiguousInstant.toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(zoneClock(ambiguousInstant, 'Pacific/Guam')).toBe('2026-07-01 08:00');
    expect(zoneClock(ambiguousInstant, 'Pacific/Pago_Pago')).toBe('2026-06-30 11:00');
  });

  const needsInformation = { fromRead: 'needs more information', direct: 'needs more information' };

  // today the code returns 0.76; item 212
  it.fails('item 212 flags a June 30 2026 8 PM Los Angeles Date with no saved zone as needs more information', async () => {
    expect(await prices(losAngelesEvening)).toEqual(needsInformation);
  });

  it.fails('item 212 flags a June 30 2026 8 PM Los Angeles Firestore Timestamp with no saved zone as needs more information', async () => {
    expect(await prices(Timestamp.fromDate(losAngelesEvening))).toEqual(needsInformation);
  });

  it.fails('item 212 flags a June 30 2026 8 PM Los Angeles seconds object with no saved zone as needs more information', async () => {
    const stamp = Timestamp.fromDate(losAngelesEvening);
    expect(await prices({ seconds: stamp.seconds, nanoseconds: stamp.nanoseconds })).toEqual(needsInformation);
  });

  // today the code returns 0.725
  it.fails('item 212 flags 2026-06-30T22:00Z with no saved zone as needs more information', async () => {
    expect(await prices(ambiguousInstant)).toEqual(needsInformation);
  });

  // today the read path returns 0.76 and does not record a zone source. Passing the trip object straight into the lookup returns null. The zone source check is there because item 212 requires the result to say where its zone came from, so a rate-only fix must not turn these green.
  it.fails('item 212 prices a June 30 2026 8 PM Los Angeles trip saved with time zone America/Los_Angeles at 0.725 and records the saved trip zone', async () => {
    expect(await pricesSavedZone(losAngelesEvening, 'America/Los_Angeles', 'los-angeles')).toEqual({
      fromRead: { ratePerMile: 0.725, zoneSource: 'saved trip zone' },
      direct: { ratePerMile: 0.725, zoneSource: 'saved trip zone' },
    });
  });

  // today the code returns 0.725 (the UTC day is June 30). Only the Los Angeles cases return 0.76 today.
  // The zone source check is there because item 212 requires the result to say where its zone came from, so a rate-only fix must not turn these green.
  it.fails('item 212 prices 2026-06-30T22:00Z saved with time zone Pacific/Guam at 0.76 and records the saved trip zone', async () => {
    expect(await pricesSavedZone(ambiguousInstant, 'Pacific/Guam', 'guam')).toEqual({
      fromRead: { ratePerMile: 0.76, zoneSource: 'saved trip zone' },
      direct: { ratePerMile: 0.76, zoneSource: 'saved trip zone' },
    });
  });
});
