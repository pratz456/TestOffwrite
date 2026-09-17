/**
 * Minimal in-memory stand-in for the Admin Firestore surface used by route
 * handlers: document get/set/update/delete/create, equality-filtered
 * collection queries, and `runTransaction` with buffered writes.
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

const DELETE_FIELD = Symbol('fake-firestore-delete-field');
/** Stand-in for the Admin SDK `FieldValue`; `delete()` removes the key on set/update. */
export const fakeFieldValue = { delete: () => DELETE_FIELD as unknown as never };

export function createFakeFirestore(options: FakeFirestoreOptions = {}) {
  const records: FakeRecords = options.records ?? new Map();
  let generated = 0;
  const fail = () => { const error = options.failure?.(); if (error) throw error; };
  const clone = (data: Record<string, any> | undefined) => data === undefined ? undefined : { ...data };

  const snapshot = (path: string) => ({
    id: path.split('/').at(-1), ref: ref(path), exists: records.has(path), data: () => clone(records.get(path)),
  });
  const ref = (path: string): any => ({
    path, id: path.split('/').at(-1),
    get: async () => { fail(); return snapshot(path); },
    set: async (data: Record<string, any>, setOptions?: { merge?: boolean }) => { fail(); write(path, data, setOptions); },
    update: async (data: Record<string, any>) => { fail(); if (!records.has(path)) throw new Error(`No document at ${path}`); write(path, data, { merge: true }); },
    create: async (data: Record<string, any>) => { fail(); if (records.has(path)) throw new Error(`Document exists at ${path}`); write(path, data); },
    delete: async () => { fail(); records.delete(path); },
    collection: (name: string) => query(`${path}/${name}`),
  });
  const write = (path: string, data: Record<string, any>, setOptions?: { merge?: boolean }) => {
    const next: Record<string, any> = { ...(setOptions?.merge ? records.get(path) : {}) };
    for (const [key, value] of Object.entries(data)) { if (value === DELETE_FIELD) delete next[key]; else next[key] = value; }
    records.set(path, next);
  };
  const query = (path: string, filters: Array<[string, unknown]> = [], maximum = Number.POSITIVE_INFINITY): any => ({
    path,
    doc: (id: string) => ref(`${path}/${id}`),
    add: async (data: Record<string, any>) => { fail(); const id = `generated-${++generated}`; write(`${path}/${id}`, data); return ref(`${path}/${id}`); },
    where: (field: string, _operator: string, value: unknown) => query(path, [...filters, [field, value]], maximum),
    limit: (count: number) => query(path, filters, count),
    select: () => query(path, filters, maximum),
    get: async () => {
      fail();
      const depth = path.split('/').length + 1;
      const docs = [...records].filter(([key, data]) => key.startsWith(`${path}/`) && key.split('/').length === depth
        && filters.every(([field, value]) => data[field] === value)).slice(0, maximum).map(([key]) => snapshot(key));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });
  const collectionGroup = (name: string): any => {
    const build = (filters: Array<[string, unknown]> = [], maximum = Number.POSITIVE_INFINITY): any => ({
      where: (field: string, _operator: string, value: unknown) => build([...filters, [field, value]], maximum),
      limit: (count: number) => build(filters, count),
      get: async () => {
        fail();
        const docs = [...records].filter(([key, data]) => key.split('/').at(-2) === name
          && filters.every(([field, value]) => data[field] === value)).slice(0, maximum).map(([key]) => snapshot(key));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    });
    return build();
  };
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
  /** WriteBatch stand-in: writes are buffered and applied together on `commit`. */
  const batch = (): any => {
    const writes: Array<() => void> = [];
    const api = {
      set: (target: any, data: Record<string, any>, setOptions?: { merge?: boolean }) => { writes.push(() => write(target.path, data, setOptions)); return api; },
      update: (target: any, data: Record<string, any>) => { writes.push(() => { if (!records.has(target.path)) throw new Error(`No document at ${target.path}`); write(target.path, data, { merge: true }); }); return api; },
      delete: (target: any) => { writes.push(() => { records.delete(target.path); }); return api; },
      commit: async () => { fail(); writes.forEach(apply => apply()); writes.length = 0; return []; },
    };
    return api;
  };
  return { records, doc: ref, collection: query, collectionGroup, runTransaction, batch,
    recursiveDelete: async (target: any) => { for (const key of [...records.keys()]) if (key === target.path || key.startsWith(`${target.path}/`)) records.delete(key); } };
}

export type FakeFirestore = ReturnType<typeof createFakeFirestore>;
