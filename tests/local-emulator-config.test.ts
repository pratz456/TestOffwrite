import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { resolveLocalEmulatorConfig, assertLocalEmulatorApp, connectLocalEmulatorOnce, LOCAL_FIREBASE_OPTIONS } from '@/lib/firebase/local-emulator-config';

const env = { enabled: 'true', nodeEnv: 'development', appEnv: 'local', ...LOCAL_FIREBASE_OPTIONS };
afterEach(() => vi.unstubAllEnvs());
describe('local Firebase emulator configuration boundary', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])('allows only the fixed demo endpoints on %s', hostname => {
    expect(resolveLocalEmulatorConfig(env, hostname)).toMatchObject({ authOrigin: 'http://127.0.0.1:9099', firestoreOrigin: 'http://127.0.0.1:8180', storageOrigin: 'http://127.0.0.1:9299' });
  });
  it('validates server rendering without needing a window and supplies dummy identifiers only', () => {
    expect(resolveLocalEmulatorConfig({ enabled: 'true', nodeEnv: 'development', projectId: 'demo-writeoff-security' }, null)).not.toBeNull();
    expect(LOCAL_FIREBASE_OPTIONS.apiKey).toBe('demo-key'); expect(LOCAL_FIREBASE_OPTIONS.appId).toBe('demo-app');
  });
  it.each(['production', 'test', undefined])('rejects explicit emulator mode outside development: %s', nodeEnv => {
    expect(() => resolveLocalEmulatorConfig({ ...env, nodeEnv }, 'localhost')).toThrow('development build');
  });
  it.each(['writeoff-production-testing', 'writeoff-23910', 'demo-other', undefined])('rejects non-approved project: %s', projectId => {
    expect(() => resolveLocalEmulatorConfig({ ...env, projectId }, 'localhost')).toThrow('local demo project');
  });
  it.each(['example.com', 'localhost.example.com', '127.0.0.2', '0.0.0.0', 'localhost.', 'localhost:3000', '::1', '', 'https://localhost'])('rejects non-loopback browser hostname %s', hostname => {
    expect(() => resolveLocalEmulatorConfig(env, hostname)).toThrow('loopback');
  });
  it.each(['apiKey', 'appId', 'authDomain', 'storageBucket'])('rejects inherited real or arbitrary %s', key => {
    expect(() => resolveLocalEmulatorConfig({ ...env, [key]: 'unapproved-fixture' }, 'localhost')).toThrow('demo configuration');
  });
  it.each(['staging', 'production'])('does not allow the flag to override %s isolation', appEnv => {
    expect(() => resolveLocalEmulatorConfig({ ...env, appEnv }, 'localhost')).toThrow('development build');
  });
  it('does not change normal Firebase configuration when the flag is absent or false', () => {
    expect(resolveLocalEmulatorConfig({ nodeEnv: 'production', projectId: 'writeoff-23910' }, 'writeoffapp.com')).toBeNull();
    expect(resolveLocalEmulatorConfig({ ...env, enabled: 'false' }, 'example.com')).toBeNull();
    expect(() => resolveLocalEmulatorConfig({ ...env, enabled: '1' }, 'localhost')).toThrow('explicitly');
  });
  it('rejects a pre-existing real SDK app and disabling local mode without a reload', () => {
    const config = resolveLocalEmulatorConfig(env, 'localhost');
    expect(() => assertLocalEmulatorApp({ ...LOCAL_FIREBASE_OPTIONS, projectId: 'writeoff-23910' }, config)).toThrow('existing Firebase app');
    expect(() => assertLocalEmulatorApp(LOCAL_FIREBASE_OPTIONS, null)).toThrow('explicit local');
    expect(() => assertLocalEmulatorApp(LOCAL_FIREBASE_OPTIONS, config)).not.toThrow();
  });
  it('records successful connection once and retries a failed public connector without swallowing errors', () => {
    const config = resolveLocalEmulatorConfig(env, 'localhost')!, handle = {}, connect = vi.fn().mockImplementationOnce(() => { throw Error('already in use'); });
    expect(() => connectLocalEmulatorOnce(handle, 'auth', config, connect)).toThrow('already in use');
    connectLocalEmulatorOnce(handle, 'auth', config, connect); connectLocalEmulatorOnce(handle, 'auth', config, connect);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(() => connectLocalEmulatorOnce(handle, 'storage', config, connect)).toThrow('connection changed');
  });
});

function localEnv() {
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATORS', 'true'); vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'local');
  for (const [name, value] of Object.entries({ PROJECT_ID: LOCAL_FIREBASE_OPTIONS.projectId, API_KEY: LOCAL_FIREBASE_OPTIONS.apiKey, APP_ID: LOCAL_FIREBASE_OPTIONS.appId, AUTH_DOMAIN: LOCAL_FIREBASE_OPTIONS.authDomain, STORAGE_BUCKET: LOCAL_FIREBASE_OPTIONS.storageBucket })) vi.stubEnv(`NEXT_PUBLIC_FIREBASE_${name}`, value);
}
function policy(host = 'localhost') { return middleware(new NextRequest(`http://${host}:3000/auth/login`)).headers.get('content-security-policy')!; }
describe('local emulator CSP scope', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])('allows only fixed loopback service origins for validated %s', hostname => {
    localEnv(); const csp = policy(hostname);
    const sources = (name: string) => csp.split('; ').find(directive => directive.startsWith(`${name} `))!;
    expect(sources('connect-src')).toContain('http://127.0.0.1:9099 http://127.0.0.1:8180 http://127.0.0.1:9299');
    expect(sources('img-src')).toContain('http://127.0.0.1:9299'); expect(sources('frame-src')).toContain('http://127.0.0.1:9099');
    expect(csp).not.toContain('upgrade-insecure-requests'); expect(csp).not.toContain('http://*'); expect(csp).toContain("frame-ancestors 'none'");
  });
  it.each(['flag-off', 'production', 'staging', 'wrong-project', 'remote-host'])('keeps the default policy when %s', reason => {
    localEnv();
    if (reason === 'flag-off') vi.stubEnv('NEXT_PUBLIC_USE_FIREBASE_EMULATORS', 'false');
    if (reason === 'production') vi.stubEnv('NODE_ENV', 'production');
    if (reason === 'staging') vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'staging');
    if (reason === 'wrong-project') vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'writeoff-23910');
    const csp = policy(reason === 'remote-host' ? 'example.com' : 'localhost');
    expect(csp).not.toContain('http://127.0.0.1:'); expect(csp).toContain('upgrade-insecure-requests');
  });
});
