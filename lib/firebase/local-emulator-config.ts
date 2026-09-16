/** Explicit local-only demo configuration. Never accept arbitrary emulator hosts. */
export const LOCAL_FIREBASE_PROJECT = 'demo-writeoff-security';
export const LOCAL_FIREBASE_OPTIONS = Object.freeze({
  apiKey: 'demo-key', appId: 'demo-app', projectId: LOCAL_FIREBASE_PROJECT,
  authDomain: `${LOCAL_FIREBASE_PROJECT}.firebaseapp.com`,
  storageBucket: `${LOCAL_FIREBASE_PROJECT}.appspot.com`,
});
const endpoints = Object.freeze({ host: '127.0.0.1', authPort: 9099, firestorePort: 8180, storagePort: 9299,
  authOrigin: 'http://127.0.0.1:9099', firestoreOrigin: 'http://127.0.0.1:8180', storageOrigin: 'http://127.0.0.1:9299' });
export type LocalEmulatorConfig = typeof endpoints;
export interface LocalEmulatorEnvironment {
  enabled?: string; nodeEnv?: string; appEnv?: string; projectId?: string;
  authDomain?: string; storageBucket?: string; apiKey?: string; appId?: string;
}
export function isLoopbackHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase());
}
/** hostname=null is server rendering; the browser must independently validate its actual host. */
export function resolveLocalEmulatorConfig(env: LocalEmulatorEnvironment, hostname: string | null): LocalEmulatorConfig | null {
  if (env.enabled === undefined || env.enabled === '' || env.enabled === 'false') return null;
  if (env.enabled !== 'true') throw new Error('Firebase emulator mode must explicitly be true or false.');
  if (env.nodeEnv !== 'development' || env.projectId !== LOCAL_FIREBASE_PROJECT || env.appEnv && env.appEnv !== 'local') {
    throw new Error('Firebase emulators require a development build and the local demo project.');
  }
  if (hostname !== null && !isLoopbackHostname(hostname)) throw new Error('Firebase emulators are available only on a loopback browser hostname.');
  for (const key of ['apiKey', 'appId', 'authDomain', 'storageBucket'] as const) {
    if (env[key] !== undefined && env[key] !== LOCAL_FIREBASE_OPTIONS[key]) throw new Error('Firebase emulator settings must use the local demo configuration.');
  }
  return endpoints;
}
/** Reject a pre-existing real-project app before any SDK service is initialized. */
export function assertLocalEmulatorApp(options: { projectId?: string; apiKey?: string; appId?: string; authDomain?: string; storageBucket?: string }, config: LocalEmulatorConfig | null): void {
  if (!config) {
    if (options.projectId === LOCAL_FIREBASE_PROJECT) throw new Error('Reload with explicit local Firebase emulator mode before using the demo app.');
    return;
  }
  for (const key of ['projectId', 'apiKey', 'appId', 'authDomain', 'storageBucket'] as const) {
    if (options[key] !== LOCAL_FIREBASE_OPTIONS[key]) throw new Error('An existing Firebase app does not match the local demo configuration. Reload the page.');
  }
}
type Service = 'auth' | 'firestore' | 'storage';
type Registry = WeakMap<object, { service: Service; endpoint: string }>;
const registryHost = globalThis as typeof globalThis & { __writeoffLocalFirebaseConnectionsV1?: Registry };
/** Public SDK handles are stable across Fast Refresh. Record only successful synchronous connections. */
export function connectLocalEmulatorOnce(target: object, service: Service, config: LocalEmulatorConfig, connect: () => void): void {
  const registry = registryHost.__writeoffLocalFirebaseConnectionsV1 ??= new WeakMap();
  const endpoint = config[`${service}Origin`];
  const previous = registry.get(target);
  if (previous) {
    if (previous.service !== service || previous.endpoint !== endpoint) throw new Error('Firebase emulator connection changed. Reload the page.');
    return;
  }
  connect();
  registry.set(target, { service, endpoint });
}
