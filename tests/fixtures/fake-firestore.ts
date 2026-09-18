/**
 * Minimal in-memory stand-in for the Admin Firestore surface used by route
 * handlers: document get/set/update/delete/create, filtered/ordered/paged
 * collection and collection-group queries, `batch`, `getAll`, `count` and
 * `runTransaction` with buffered writes.
 * Synthetic records only; behaviour matches the SDK closely enough for
 * ownership and rate-limit tests without a running emulator.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type FakeRecords = Map<string, Record<string, any>>;

export interface FakeFirestoreOptions {
  records?: FakeRecords;
  /** Throws from every transaction and read; simulates an unavailable database. */
  failure?: () => Error | null;
}

type Filter = [string, string, unknown];
type Order = [string, 'asc' | 'desc'];
interface QueryState { filters: Filter[]; orders: Order[]; maximum: number; skip: number; after?: any[] }

const fieldValue = (data: Record<string, any>, field: string): unknown =>
  field.split('.').reduce<any>((value, key) => (value === undefined || value === null ? undefined : value[key]), data);
const comparable = (value: unknown): number | string => {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && typeof (value as any).toMillis === 'function') return (value as any).toMillis();
  return typeof value === 'number' ? value : String(value ?? '');
};
const matches = (data: Record<string, any>, [field, operator, expected]: Filter): boolean => {
  const actual = fieldValue(data, field);
  switch (operator) {
    case '==': return actual === expected;
    case '!=': return actual !== expected;
    case '>': return actual !== undefined && comparable(actual) > comparable(expected);
    case '>=': return actual !== undefined && comparable(actual) >= comparable(expected);
    case '<': return actual !== undefined && comparable(actual) < comparable(expected);
    case '<=': return actual !== undefined && comparable(actual) <= comparable(expected);
    case 'in': return Array.isArray(expected) && expected.includes(actual);
    case 'not-in': return Array.isArray(expected) && !expected.includes(actual);
    case 'array-contains': return Array.isArray(actual) && actual.includes(expected);
    case 'array-contains-any': return Array.isArray(actual) && Array.isArray(expected) && expected.some(item => actual.includes(item));
    default: throw new Error(`Unsupported operator ${operator} in fake Firestore`);
  }
};
const initialState = (): QueryState => ({ filters: [], orders: [], maximum: Number.POSITIVE_INFINITY, skip: 0 });

const DELETE_FIELD = Symbol('fake-firestore-delete-field');
/** Stand-in for the Admin SDK `FieldValue`; `delete()` removes the key on set/update. */
export const fakeFieldValue = { delete: () => DELETE_FIELD as unknown as never };

export function createFakeFirestore(options: FakeFirestoreOptions = {}) {
  const records: FakeRecords = options.records ?? new Map();
  let generated = 0;
  const fail = () => { const error = options.failure?.(); if (error) throw error; };
  const clone = (data: Record<string, any> | undefined) => data === undefined ? undefined : { ...data };
  const nextId = () => `generated-${++generated}`;

  const snapshot = (path: string) => ({
    id: path.split('/').at(-1), ref: ref(path), exists: records.has(path), data: () => clone(records.get(path)),
    get: (field: string) => fieldValue(records.get(path) ?? {}, field),
  });
  const ref = (path: string): any => ({
    path, id: path.split('/').at(-1),
    parent: query(path.split('/').slice(0, -1).join('/')),
    get: async () => { fail(); return snapshot(path); },
    set: async (data: Record<string, any>, setOptions?: { merge?: boolean }) => { fail(); write(path, data, setOptions); },
    update: async (data: Record<string, any>) => { fail(); if (!records.has(path)) throw new Error(`No document at ${path}`); write(path, data, { merge: true }); },
    create: async (data: Record<string, any>) => { fail(); if (records.has(path)) throw new Error(`Document exists at ${path}`); write(path, data); },
    delete: async () => { fail(); records.delete(path); },
    collection: (name: string) => query(`${path}/${name}`),
    listCollections: async () => { fail(); const depth = path.split('/').length + 1; const names = new Set<string>();
      for (const key of records.keys()) if (key.startsWith(`${path}/`) && key.split('/').length >= depth + 1) names.add(key.split('/')[depth - 1]);
      return [...names].map(name => query(`${path}/${name}`)); },
  });
  const write = (path: string, data: Record<string, any>, setOptions?: { merge?: boolean }) => {
    const next: Record<string, any> = { ...(setOptions?.merge ? records.get(path) : {}) };
    for (const [key, value] of Object.entries(data)) { if (value === DELETE_FIELD) delete next[key]; else next[key] = value; }
    records.set(path, next);
  };
  const select = (entries: Array<[string, Record<string, any>]>, state: QueryState) => {
    let rows = entries.filter(([, data]) => state.filters.every(filter => matches(data, filter)));
    for (const [field, direction] of [...state.orders].reverse()) {
      rows = [...rows].sort(([, a], [, b]) => {
        const left = comparable(fieldValue(a, field)), right = comparable(fieldValue(b, field));
        const order = left < right ? -1 : left > right ? 1 : 0;
        return direction === 'desc' ? -order : order;
      });
    }
    if (state.after) {
      const cursor = state.after[0];
      const index = rows.findIndex(([key]) => key === cursor?.ref?.path || key === cursor?.path);
      rows = index >= 0 ? rows.slice(index + 1) : rows;
    }
    const docs = rows.slice(state.skip, state.skip + state.maximum).map(([key]) => snapshot(key));
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (visit: (doc: any) => void) => docs.forEach(visit) };
  };
  const builder = (path: string, entries: () => Array<[string, Record<string, any>]>, state: QueryState, extra: Record<string, any> = {}): any => ({
    path, ...extra,
    where: (field: string, operator: string, value: unknown) => builder(path, entries, { ...state, filters: [...state.filters, [field, operator, value]] }, extra),
    orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') => builder(path, entries, { ...state, orders: [...state.orders, [field, direction]] }, extra),
    limit: (count: number) => builder(path, entries, { ...state, maximum: count }, extra),
    offset: (count: number) => builder(path, entries, { ...state, skip: count }, extra),
    startAfter: (...cursor: any[]) => builder(path, entries, { ...state, after: cursor }, extra),
    select: () => builder(path, entries, state, extra),
    count: () => ({ get: async () => { fail(); return { data: () => ({ count: select(entries(), state).size }) }; } }),
    get: async () => { fail(); return select(entries(), state); },
  });
  const query = (path: string): any => {
    const depth = path.split('/').length + 1;
    const entries = () => [...records].filter(([key]) => key.startsWith(`${path}/`) && key.split('/').length === depth);
    return builder(path, entries, initialState(), {
      id: path.split('/').at(-1),
      doc: (id: string = nextId()) => ref(`${path}/${id}`),
      add: async (data: Record<string, any>) => { fail(); const id = nextId(); write(`${path}/${id}`, data); return ref(`${path}/${id}`); },
      listDocuments: async () => { fail(); return entries().map(([key]) => ref(key)); },
    });
  };
  const collectionGroup = (name: string): any =>
    builder(name, () => [...records].filter(([key]) => key.split('/').at(-2) === name), initialState());
  const runTransaction = async <T>(work: (tx: any) => Promise<T>): Promise<T> => {
    fail();
    const writes: Array<() => void> = [];
    const result = await work({
      get: (target: any) => target.get(),
      getAll: (...targets: any[]) => Promise.all(targets.map(target => target.get())),
      set: (target: any, data: Record<string, any>, setOptions?: { merge?: boolean }) => writes.push(() => write(target.path, data, setOptions)),
      update: (target: any, data: Record<string, any>) => writes.push(() => write(target.path, data, { merge: true })),
      create: (target: any, data: Record<string, any>) => writes.push(() => { if (records.has(target.path)) throw new Error(`Document exists at ${target.path}`); write(target.path, data); }),
      delete: (target: any) => writes.push(() => { records.delete(target.path); }),
    });
    writes.forEach(apply => apply());
    return result;
  };
  const batch = () => {
    const writes: Array<() => void> = [];
    const self: any = {
      set: (target: any, data: Record<string, any>, setOptions?: { merge?: boolean }) => { writes.push(() => write(target.path, data, setOptions)); return self; },
      update: (target: any, data: Record<string, any>) => { writes.push(() => { if (!records.has(target.path)) throw new Error(`No document at ${target.path}`); write(target.path, data, { merge: true }); }); return self; },
      create: (target: any, data: Record<string, any>) => { writes.push(() => write(target.path, data)); return self; },
      delete: (target: any) => { writes.push(() => { records.delete(target.path); }); return self; },
      commit: async () => { fail(); writes.forEach(apply => apply()); writes.length = 0; return []; },
    };
    return self;
  };
  return { records, doc: ref, collection: query, collectionGroup, runTransaction, batch,
    getAll: async (...targets: any[]) => { fail(); return targets.map(target => snapshot(target.path)); },
    recursiveDelete: async (target: any) => { for (const key of [...records.keys()]) if (key === target.path || key.startsWith(`${target.path}/`)) records.delete(key); } };
}

export type FakeFirestore = ReturnType<typeof createFakeFirestore>;
