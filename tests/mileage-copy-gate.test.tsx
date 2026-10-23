import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { MILEAGE_VEHICLE_COPY, mileageVehicleCopyCatalog } from '@/lib/mileage/vehicle-copy';

const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void>,
  profile: vi.fn(async () => ({ data: null, error: { code: 'PROFILE_NOT_FOUND' } })),
  request: vi.fn(async () => ({ ok: true, json: async () => [] })),
}));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (left: unknown[] | undefined, right: unknown[]) => left?.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    useState(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [harness.slots[index], (next: unknown) => {
        harness.slots[index] = typeof next === 'function' ? (next as (value: unknown) => unknown)(harness.slots[index]) : next;
      }];
    },
    useRef(initial: unknown) {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = { current: initial };
      return harness.slots[index];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const index = harness.cursor++;
      const stored = harness.slots[index] as { deps?: unknown[]; callback: unknown } | undefined;
      if (!same(stored?.deps, deps)) harness.slots[index] = { deps, callback };
      return (harness.slots[index] as { callback: unknown }).callback;
    },
    useMemo(factory: () => unknown, deps: unknown[]) {
      const index = harness.cursor++;
      const stored = harness.slots[index] as { deps?: unknown[]; value: unknown } | undefined;
      if (!same(stored?.deps, deps)) harness.slots[index] = { deps, value: factory() };
      return (harness.slots[index] as { value: unknown }).value;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = harness.cursor++;
      const previous = harness.slots[index] as { deps?: unknown[]; cleanup?: () => void } | undefined;
      if (!same(previous?.deps, deps)) {
        const next: { deps: unknown[]; cleanup?: () => void } = { deps };
        harness.slots[index] = next;
        harness.effects.push(() => { previous?.cleanup?.(); next.cleanup = effect() as (() => void) | undefined; });
      }
    },
    useLayoutEffect(effect: () => void | (() => void), deps: unknown[]) {
      return hooks.useEffect(effect, deps);
    },
    useId() {
      const index = harness.cursor++;
      if (!(index in harness.slots)) harness.slots[index] = `field-${index}`;
      return harness.slots[index];
    },
    useContext(context: { _currentValue?: unknown }) {
      return context?._currentValue ?? null;
    },
  };
  return { ...actual, ...hooks, default: { ...(actual as { default?: object }).default, ...hooks } };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: (key: string) => key === 'tab' ? 'tax' : null }),
}));
vi.mock('@/lib/hooks/use-subscription', () => ({ useSubscription: () => ({ status: null, isLoading: false, error: null, refetch: vi.fn(), canAccess: () => false }) }));
vi.mock('@/lib/hooks/use-before-unload', () => ({ useBeforeUnload: vi.fn() }));
vi.mock('@/lib/firebase/profiles', () => ({ getUserProfile: harness.profile, upsertUserProfile: vi.fn() }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const database = vi.hoisted(() => ({
  fail: false,
  trips: [] as Array<{ id: string; data: Record<string, unknown> }>,
}));
vi.mock('@/lib/firebase/admin', () => {
  const tripCollection = () => ({
    get: async () => {
      if (database.fail) throw new Error('database down');
      const docs = database.trips.map(trip => ({ id: trip.id, data: () => trip.data }));
      return { docs, forEach(fn: (doc: (typeof docs)[number]) => void) { docs.forEach(fn); } };
    },
    add: async () => {
      if (database.fail) throw new Error('database down');
      return { id: 'created-trip' };
    },
    doc(id?: string) {
      return {
        id: id ?? 'generated',
        get: async () => ({ exists: false, data: () => undefined }),
        delete: async () => { if (database.fail) throw new Error('database down'); },
        collection: tripCollection,
      };
    },
  });
  return {
    adminDb: {
      collection: () => ({ doc: () => ({ collection: tripCollection }) }),
      doc: () => ({ collection: tripCollection }),
    },
    adminAuth: {},
    FieldValue: { delete: () => 'delete', serverTimestamp: () => 'time' },
  };
});
vi.mock('@/lib/firebase/api-auth', () => ({
  getAuthenticatedUser: async () => ({ user: { uid: 'owner', email: 'owner@example.test', emailVerified: true }, error: null }),
}));

import { MileageTrackerScreen } from '@/components/mileage-tracker-screen';
import { SettingsScreen } from '@/components/settings-screen';
import { DELETE as deleteTrip } from '@/app/api/mileage/[id]/route';
import { GET as readMileage, POST as createMileage } from '@/app/api/mileage/route';
import { POST as assignTrips } from '@/app/api/mileage/assignments/route';
import { POST as addVehicle } from '@/app/api/mileage/vehicles/route';
import { PATCH as saveVehicle } from '@/app/api/mileage/vehicles/[id]/route';

const BASE_MILEAGE_ERRORS = [
  'Unauthorized',
  'Provide a valid tax year.',
  'Forbidden',
  'Failed to fetch mileage trips',
  'Internal server error',
  'Provide valid locations, a date (YYYY-MM-DD), and positive finite miles.',
  'Invalid or unauthorized userId',
  'Failed to create mileage trip',
  'Trip ID required',
  'Failed to delete mileage trip',
] as const;

function visible(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(visible).join(' ');
  if (typeof node === 'object' && node && 'props' in node) {
    const props = (node as { props: Record<string, unknown> }).props;
    const options = Array.isArray(props.options) ? props.options.map(option => (option as { label?: string }).label ?? '').join(' ') : '';
    return [props.children, props.label, props.title, props.summary, props.placeholder, props.hint, props['aria-label'], options].map(visible).join(' ');
  }
  return '';
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function renderScreen(component: () => unknown): string {
  harness.cursor = 0;
  const tree = component();
  harness.effects.splice(0).forEach(effect => effect());
  return normalize(visible(tree));
}

const owner = { id: 'owner', email: 'owner@example.test', user_metadata: { name: 'Owner' } };
const switches = [undefined, 'true', '0'] as const;

function useSwitch(value: string | undefined) {
  if (value === undefined) vi.unstubAllEnvs();
  else vi.stubEnv('NEXT_PUBLIC_MILEAGE_VEHICLE_COPY', value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  harness.slots = [];
  harness.cursor = 0;
  harness.effects = [];
  database.fail = false;
  database.trips = [];
});

describe('mileage copy switch off matches the base screens and errors', () => {
  it('renders the mileage and settings screens with the base text for an unset switch, true, and 0', async () => {
    const windowStub = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      location: { assign: () => undefined },
    };
    vi.stubGlobal('window', windowStub);
    const mileageTexts: string[] = [];
    const settingsTexts: string[] = [];
    for (const value of switches) {
      useSwitch(value);
      harness.slots = [];
      mileageTexts.push(renderScreen(() => MileageTrackerScreen({ user: { id: 'owner' }, onBack: vi.fn() })));
      harness.slots = [];
      harness.effects = [];
      renderScreen(() => SettingsScreen({ user: owner, onBack: vi.fn(), onNavigate: vi.fn() }));
      await Promise.resolve();
      await Promise.resolve();
      settingsTexts.push(renderScreen(() => SettingsScreen({ user: owner, onBack: vi.fn(), onNavigate: vi.fn() })));
    }
    expect(mileageTexts[1]).toBe(mileageTexts[0]);
    expect(mileageTexts[2]).toBe(mileageTexts[0]);
    expect(settingsTexts[1]).toBe(settingsTexts[0]);
    expect(settingsTexts[2]).toBe(settingsTexts[0]);
    const year = new Date().getFullYear();
    const baseMileage = [
      'Mileage Tracker',
      'Track business miles for tax deductions',
      `${year} Summary`,
      'Total Business Miles',
      '0',
      'Total Deduction',
      '$',
      '0.00',
      `IRS ${year} rate not yet published`,
      'Trips Logged',
      '0',
      'Trip Log',
      'Add Trip',
      'Logged Trips',
      'Add New Trip',
      'Date',
      'Miles driven',
      '0',
      'Start location',
      'e.g. Home, Office',
      'End location',
      'e.g. Client office, Airport',
      'Business purpose',
      'e.g. Client meeting, Office pickup',
      'Round trip',
      'Double the miles for deduction',
      'Add Trip',
    ].join(' ');
    const mileage = mileageTexts[0];
    const settings = settingsTexts[0];
    const baseSettings = 'Settings Profile Profile Tax Tax Account Account Settings sections 0 Vehicle Business Use % 0-100 Select method Standard Mileage Actual Expense Vehicle Deduction Method Vehicle Deduction Business use & deduction method Select status Standard Deduction Itemized Deductions Itemization Status 0 Prior Year Total Tax From last year\'s return Auto-calculated Tax Bracket Override % Optional, 0-100 Tax Preferences Deduction choice & prior-year tax Entered amounts are subject to eligibility and annual limits. 0 Health Insurance Premiums 0 SEP-IRA Contribution 0 Solo 401(k) Contribution 0 HSA Contribution 0 SIMPLE IRA Contribution Insurance & retirement Insurance, retirement & HSA amounts';
    expect(mileage).toBe(baseMileage);
    expect(settings).toBe(baseSettings);
    // A few catalog words are already inside those base screens (Business, miles, to).
    // Every other switch-on sentence must be absent.
    for (const sentence of mileageVehicleCopyCatalog(true)) {
      if (baseMileage.includes(sentence) || baseSettings.includes(sentence)) continue;
      expect(mileage).not.toContain(sentence);
      expect(settings).not.toContain(sentence);
    }
    for (const heading of ['Your cars', 'Sort your trips', 'Odometer at start of year (or when first used)', 'Pick a trip type so we know whether these miles count.', 'You have 3 trips to sort. Pick a car and a trip type so they can count.']) {
      expect(mileage).not.toContain(heading);
      expect(settings).not.toContain(heading);
    }
  });

  it('returns the base mileage error text when the switch is unset, true, or 0', async () => {
    const catalog = new Set<string>(mileageVehicleCopyCatalog(true));
    catalog.add('Vehicle id required');
    const request = (url: string, body?: unknown, method = 'POST') => new NextRequest(url, body === undefined
      ? { method }
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const tripBody = { userId: 'owner', date: '2026-03-01', startLocation: 'Home', endLocation: 'Client', miles: 8, businessPurpose: 'Client meeting', roundTrip: false };
    for (const value of switches) {
      useSwitch(value);
      database.fail = true;
      expect((await (await readMileage(request('https://writeoff.test/api/mileage?userId=owner', undefined, 'GET'))).json()).error).toBe('Failed to fetch mileage trips');
      expect((await (await createMileage(request('https://writeoff.test/api/mileage', { userId: 'owner' }))).json()).error).toBe('Provide valid locations, a date (YYYY-MM-DD), and positive finite miles.');
      expect((await (await createMileage(request('https://writeoff.test/api/mileage', tripBody))).json()).error).toBe('Failed to create mileage trip');
      expect((await (await deleteTrip(request('https://writeoff.test/api/mileage/trip-1', undefined, 'DELETE'), { params: Promise.resolve({ id: 'trip-1' }) })).json()).error).toBe('Failed to delete mileage trip');
      database.fail = false;
      database.trips = [{ id: 'sorted', data: { date: '2026-01-02', startLocation: 'Home', endLocation: 'Client', miles: 4, businessPurpose: '', roundTrip: false, vehicleId: 'car-1', tripType: 'business' } }];
      const created = await createMileage(request('https://writeoff.test/api/mileage', tripBody));
      expect(created.status).toBe(200);
      expect(JSON.stringify(await created.json())).not.toContain(MILEAGE_VEHICLE_COPY.pickTripType);
      const hiddenVehicle = await saveVehicle(request('https://writeoff.test/api/mileage/vehicles/car-1', {}), { params: Promise.resolve({ id: '' }) });
      expect(hiddenVehicle.status).toBe(400);
      expect((await hiddenVehicle.json()).error).toBe('Internal server error');
      const hiddenAdd = await addVehicle(request('https://writeoff.test/api/mileage/vehicles', { userId: 'owner' }));
      expect(hiddenAdd.status).toBe(400);
      expect((await hiddenAdd.json()).error).toBe('Internal server error');
      const hiddenAssign = await assignTrips(request('https://writeoff.test/api/mileage/assignments', {}));
      expect(hiddenAssign.status).toBe(400);
      expect((await hiddenAssign.json()).error).toBe('Internal server error');
      const bodies = [
        await (await readMileage(request('https://writeoff.test/api/mileage?userId=owner', undefined, 'GET'))).json(),
        await (await saveVehicle(request('https://writeoff.test/api/mileage/vehicles/car-1', { userId: 'owner' }), { params: Promise.resolve({ id: 'car-1' }) })).json(),
      ];
      for (const body of bodies) expect(catalog.has(body.error)).toBe(false);
      expect(BASE_MILEAGE_ERRORS).toContain('Failed to delete mileage trip');
    }
  });
});
