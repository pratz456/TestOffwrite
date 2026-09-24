import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privacyRuntimeCaching } from '../lib/pwa/cache-policy';

const h = vi.hoisted(() => ({ effect: null as null | (() => void | (() => void)), info: vi.fn(), dismiss: vi.fn() }));
vi.mock('react', () => ({ useEffect: (effect: () => void) => { h.effect = effect; } }));
vi.mock('sonner', () => ({ toast: { info: h.info, dismiss: h.dismiss } }));
import { PwaRegisterSw } from '../components/pwa-register-sw';

class Worker extends EventTarget { postMessage = vi.fn(); }
class Registration extends EventTarget { waiting: Worker | null = null; installing: Worker | null = null; }
class ServiceWorkers extends EventTarget {
  controller: Worker | null = new Worker();
  register = vi.fn();
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
let serviceWorker: ServiceWorkers;
let registration: Registration;
let browser: EventTarget & { location: { reload: ReturnType<typeof vi.fn> } };
let stop: undefined | (() => void);
function mount() { PwaRegisterSw(); stop = h.effect?.() || undefined; }
function refreshAction() { return h.info.mock.calls.at(-1)![1].action.onClick; }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('NODE_ENV', 'production');
  serviceWorker = new ServiceWorkers(); registration = new Registration();
  serviceWorker.register.mockResolvedValue(registration);
  browser = Object.assign(new EventTarget(), { location: { reload: vi.fn() } });
  vi.stubGlobal('window', browser); vi.stubGlobal('navigator', { serviceWorker });
  vi.stubGlobal('document', { readyState: 'complete' });
});
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('PWA updates preserve in-progress work', () => {
  it('registers after hydration even when the load event already happened', async () => {
    mount(); await flush();
    expect(serviceWorker.register).toHaveBeenCalledExactlyOnceWith('/sw.js', { scope: '/' });
    expect(h.info).not.toHaveBeenCalled(); expect(browser.location.reload).not.toHaveBeenCalled();
  });
  it('does not reload active bank consent or form state on controller change or reconnect', async () => {
    registration.waiting = new Worker();
    const form = { bankConsent: true, editedAmount: '42.00' };
    // A document reload is what erased the real Link screen's component state.
    browser.location.reload.mockImplementation(() => { form.bankConsent = false; form.editedAmount = ''; });
    mount(); await flush();
    serviceWorker.dispatchEvent(new Event('controllerchange')); browser.dispatchEvent(new Event('online'));
    expect(form).toEqual({ bankConsent: true, editedAmount: '42.00' });
    expect(browser.location.reload).not.toHaveBeenCalled(); expect(registration.waiting.postMessage).not.toHaveBeenCalled();
    expect(h.info).toHaveBeenCalledOnce();
    expect(h.info).toHaveBeenCalledWith('WriteOff update ready', expect.objectContaining({ duration: Infinity, description: expect.stringContaining('Finish') }));
  });
  it('waits for an explicit refresh before activating the update, then reloads once', async () => {
    const waiting = new Worker(); registration.waiting = waiting; mount(); await flush();
    const refresh = refreshAction(); refresh(); refresh();
    expect(waiting.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' });
    expect(browser.location.reload).not.toHaveBeenCalled();
    serviceWorker.dispatchEvent(new Event('controllerchange')); serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(browser.location.reload).toHaveBeenCalledOnce();
  });
  it('only refreshes the current tab on user request if another tab already activated the update', async () => {
    registration.waiting = new Worker(); mount(); await flush();
    registration.waiting = null; serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(browser.location.reload).not.toHaveBeenCalled(); refreshAction()();
    expect(browser.location.reload).toHaveBeenCalledOnce();
  });
  it('observes an update installed later and deduplicates repeated worker events', async () => {
    mount(); await flush(); const installing = new Worker(); registration.installing = installing;
    registration.dispatchEvent(new Event('updatefound')); expect(h.info).not.toHaveBeenCalled();
    registration.waiting = installing; installing.dispatchEvent(new Event('statechange')); installing.dispatchEvent(new Event('statechange'));
    registration.dispatchEvent(new Event('updatefound'));
    expect(h.info).toHaveBeenCalledOnce(); expect(installing.postMessage).not.toHaveBeenCalled();
  });
  it('does not reload or announce a first installation as an update', async () => {
    serviceWorker.controller = null; mount(); await flush();
    serviceWorker.controller = new Worker(); serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(h.info).not.toHaveBeenCalled(); expect(browser.location.reload).not.toHaveBeenCalled();
  });
  it('removes load, worker and registration listeners and disables a stale action on unmount', async () => {
    registration.waiting = new Worker(); registration.installing = registration.waiting;
    mount(); await flush(); const refresh = refreshAction(); stop!(); stop = undefined;
    h.info.mockClear(); browser.dispatchEvent(new Event('load'));
    serviceWorker.dispatchEvent(new Event('controllerchange')); registration.dispatchEvent(new Event('updatefound'));
    registration.installing.dispatchEvent(new Event('statechange')); refresh();
    expect(h.info).not.toHaveBeenCalled(); expect(browser.location.reload).not.toHaveBeenCalled();
    expect(registration.waiting.postMessage).not.toHaveBeenCalled(); expect(serviceWorker.register).toHaveBeenCalledOnce();
    expect(h.dismiss).toHaveBeenCalledWith('writeoff-service-worker-update');
  });
  it('registers once on load and cancels that listener if unmounted before load', async () => {
    vi.stubGlobal('document', { readyState: 'loading' }); mount();
    expect(serviceWorker.register).not.toHaveBeenCalled(); browser.dispatchEvent(new Event('load')); browser.dispatchEvent(new Event('load')); await flush();
    expect(serviceWorker.register).toHaveBeenCalledOnce(); stop!(); stop = undefined;
    serviceWorker.register.mockClear(); mount(); stop!(); stop = undefined; browser.dispatchEvent(new Event('load'));
    expect(serviceWorker.register).not.toHaveBeenCalled();
  });
  it('ignores registration completion after unmount', async () => {
    let finish!: (registration: Registration) => void;
    serviceWorker.register.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    registration.waiting = new Worker(); mount(); stop!(); stop = undefined; finish(registration); await flush();
    registration.dispatchEvent(new Event('updatefound')); expect(h.info).not.toHaveBeenCalled();
    expect(registration.waiting.postMessage).not.toHaveBeenCalled();
  });
  it('does not register in development', () => {
    vi.stubEnv('NODE_ENV', 'development'); mount(); expect(serviceWorker.register).not.toHaveBeenCalled();
  });
});

// Read actual Next configuration and run the installed next-pwa browser entry so
// the plugin's default online reload cannot silently undo the component fix.
function configuredPwaOptions() {
  let options: any;
  const compiled = ts.transpileModule(fs.readFileSync('next.config.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(compiled, { module: loadedModule, exports: loadedModule.exports, process: { env: { NODE_ENV: 'production' } }, require: (name: string) => {
    if (name === '@ducanh2912/next-pwa') return { default: (value: any) => { options = value; return (config: any) => config; } };
    if (name === './lib/pwa/cache-policy') return { privacyRuntimeCaching };
    throw new Error(`Unexpected config dependency ${name}`);
  } });
  return options;
}
function runPluginEntry(options: any) {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('@ducanh2912/next-pwa').replace(/index\.(c?js)$/, 'sw-entry.js');
  const source = fs.readFileSync(entry, 'utf8').replace(/^import \{Workbox\}from'workbox-window';/, '');
  const register = vi.fn();
  vm.runInNewContext(source, { window: browser, location: browser.location, navigator: { serviceWorker }, caches: {},
    Workbox: class { register = register; },
    __PWA_SW_ENTRY_WORKER__: false, __PWA_SW__: '/sw.js', __PWA_SCOPE__: '/',
    __PWA_ENABLE_REGISTER__: options.register, __PWA_RELOAD_ON_ONLINE__: options.reloadOnOnline,
    __PWA_CACHE_ON_FRONT_END_NAV__: options.cacheOnFrontEndNav, __PWA_START_URL__: false,
  });
  return register;
}
describe('generated PWA entry update policy', () => {
  it('keeps one registration owner, waits to activate updates, and preserves private-route caching rules', () => {
    const options = configuredPwaOptions(); const register = runPluginEntry(options);
    browser.dispatchEvent(new Event('online'));
    expect(register).not.toHaveBeenCalled(); expect(browser.location.reload).not.toHaveBeenCalled();
    expect(options.workboxOptions.skipWaiting).toBe(false);
    expect(options.workboxOptions.runtimeCaching).toBe(privacyRuntimeCaching);
    expect(options.extendDefaultRuntimeCaching).toBe(false); expect(options.cacheStartUrl).toBe(false);
  });
  it('reproduces the plugin online-event reload when its old default is enabled', () => {
    runPluginEntry({ ...configuredPwaOptions(), reloadOnOnline: true }); browser.dispatchEvent(new Event('online'));
    expect(browser.location.reload).toHaveBeenCalledOnce();
  });
});
