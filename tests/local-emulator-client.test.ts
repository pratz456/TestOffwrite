import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ apps: [] as { options: Record<string, string> }[], calls: [] as string[], authOptions: [] as unknown[], auth: {}, db: {}, storage: {}, authInitialized: false, connected: new Set<object>(), failAuth: false }));
vi.mock('firebase/app', () => ({
  getApps: () => sdk.apps, getApp: () => sdk.apps[0],
  initializeApp: (options: Record<string, string>) => { sdk.calls.push('initializeApp'); const app = { options }; sdk.apps.push(app); return app; },
}));
vi.mock('firebase/auth', () => ({
  indexedDBLocalPersistence: 'indexed', browserLocalPersistence: 'local', browserSessionPersistence: 'session',
  initializeAuth: () => { sdk.calls.push('initializeAuth'); if (sdk.authInitialized) throw { code: 'auth/already-initialized' }; sdk.authInitialized = true; return sdk.auth; },
  getAuth: () => { sdk.calls.push('getAuth'); return sdk.auth; },
  connectAuthEmulator: (target: object, url: string, options: unknown) => { sdk.calls.push(`auth:${url}`); sdk.authOptions.push(options); if (sdk.failAuth) throw Error('auth/emulator-config-failed'); if (sdk.connected.has(target)) throw Error('Duplicate auth connector'); sdk.connected.add(target); },
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => { sdk.calls.push('getFirestore'); return sdk.db; },
  connectFirestoreEmulator: (target: object, host: string, port: number) => { sdk.calls.push(`firestore:${host}:${port}`); if (sdk.connected.has(target)) throw Error('Firestore already in use'); sdk.connected.add(target); },
}));
vi.mock('firebase/storage', () => ({
  getStorage: () => { sdk.calls.push('getStorage'); return sdk.storage; },
  connectStorageEmulator: (target: object, host: string, port: number) => { sdk.calls.push(`storage:${host}:${port}`); if (sdk.connected.has(target)) throw Error('Duplicate storage connector'); sdk.connected.add(target); },
  ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn(), deleteObject: vi.fn(), getMetadata: vi.fn(),
}));
beforeEach(() => {
  vi.resetModules(); sdk.apps = []; sdk.calls = []; sdk.authOptions = []; sdk.auth = {}; sdk.db = {}; sdk.storage = {}; sdk.authInitialized = false; sdk.connected = new Set(); sdk.failAuth = false;
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATORS', 'true'); vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'local');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'demo-writeoff-security'); vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'demo-key'); vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_ID', 'demo-app');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'demo-writeoff-security.firebaseapp.com'); vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'demo-writeoff-security.appspot.com');
  vi.stubGlobal('window', { location: { hostname: 'localhost' } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('Firebase client emulator integration order', () => {
  it('connects each SDK synchronously before exported handles are available, without production analytics defaults', async () => {
    const client = await import('@/lib/firebase/client'); const storage = await import('@/lib/firebase/storage');
    expect(sdk.calls).toEqual(['initializeApp', 'initializeAuth', 'auth:http://127.0.0.1:9099', 'getFirestore', 'firestore:127.0.0.1:8180', 'getStorage', 'storage:127.0.0.1:9299']);
    expect(sdk.authOptions).toEqual([{ disableWarnings: true }]);
    expect(client.auth).toBe(sdk.auth); expect(client.db).toBe(sdk.db); expect(storage.storage).toBe(sdk.storage);
    expect(client.app.options).toMatchObject({ projectId: 'demo-writeoff-security', apiKey: 'demo-key', appId: 'demo-app' });
    expect(client.app.options).not.toHaveProperty('measurementId');
  });
  it('survives Fast Refresh without reconnecting already-used SDK services', async () => {
    const first = await import('@/lib/firebase/client'); await import('@/lib/firebase/storage');
    vi.resetModules(); const second = await import('@/lib/firebase/client'); await import('@/lib/firebase/storage');
    expect(second.app).toBe(first.app); expect(second.auth).toBe(first.auth); expect(second.db).toBe(first.db);
    for (const name of ['auth:', 'firestore:', 'storage:']) expect(sdk.calls.filter(call => call.startsWith(name))).toHaveLength(1);
  });
  it.each(['remote-host', 'production', 'real-project', 'real-api-key'])('fails before SDK initialization with %s', reason => {
    if (reason === 'remote-host') vi.stubGlobal('window', { location: { hostname: 'writeoffapp.com' } });
    if (reason === 'production') vi.stubEnv('NODE_ENV', 'production');
    if (reason === 'real-project') vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'writeoff-23910');
    if (reason === 'real-api-key') vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'unapproved-key');
    return expect(import('@/lib/firebase/client')).rejects.toThrow().then(() => expect(sdk.calls).toEqual([]));
  });
  it('rejects reusing an already initialized real-project app', async () => {
    sdk.apps = [{ options: { projectId: 'writeoff-23910' } }];
    await expect(import('@/lib/firebase/client')).rejects.toThrow('existing Firebase app'); expect(sdk.calls).toEqual([]);
  });
  it('does not swallow SDK errors if another caller already used Auth before emulator connection', async () => {
    sdk.authInitialized = true; sdk.failAuth = true;
    await expect(import('@/lib/firebase/client')).rejects.toThrow('auth/emulator-config-failed');
    expect(sdk.calls).not.toContain('getFirestore');
  });
  it('leaves staging service initialization unchanged when emulator mode is disabled', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATORS', 'false'); vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'staging');
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'writeoff-production-testing'); vi.stubEnv('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'writeoff-production-testing.firebaseapp.com');
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', 'writeoff-production-testing.firebasestorage.app'); vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'staging-key'); vi.stubEnv('NEXT_PUBLIC_FIREBASE_APP_ID', 'staging-app');
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', 'staging-sender');
    vi.stubGlobal('window', { location: { hostname: 'writeoff-production-testing.web.app' } });
    const client = await import('@/lib/firebase/client'); await import('@/lib/firebase/storage');
    expect(client.localEmulatorConfig).toBeNull(); expect(client.app.options.projectId).toBe('writeoff-production-testing');
    expect(sdk.calls).toEqual(['initializeApp', 'initializeAuth', 'getFirestore', 'getStorage']);
    expect(sdk.authOptions).toEqual([]);
  });
});
