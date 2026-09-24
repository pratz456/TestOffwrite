import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { assertSource, PATCHED_SOURCE_HASH, PATCHED_VERSION, TARBALL, UPSTREAM_SOURCE_HASH, UPSTREAM_VERSION } from '../scripts/build-firebase-frameworks-patch.mjs';

const require = createRequire(import.meta.url);
const frameworkEntry = require.resolve('firebase-frameworks');
const frameworkRequire = createRequire(frameworkEntry);
const installedSource = fs.readFileSync(path.join(path.dirname(frameworkEntry), 'firebase-aware.js'), 'utf8');
const lruSource = fs.readFileSync(frameworkRequire.resolve('lru-cache'), 'utf8');
const constants = Object.fromEntries([...fs.readFileSync(path.join(path.dirname(frameworkEntry), 'constants.js'), 'utf8').matchAll(/export const (\w+) = ([\d *]+);/g)].map(([, name, value]) => [name, vm.runInNewContext(value)]));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Response extends EventEmitter {
  locals: Record<string, any> = {};
  destroyed = false;
  writableFinished = false;
  statusCode = 200;
  cookies: unknown[] = [];
  status(value: number) { this.statusCode = value; return this; }
  cookie(...args: unknown[]) { this.cookies.push(args); return this; }
  clearCookie(name: string) { this.cookies.push([name]); return this; }
  end() { this.writableFinished = true; this.emit('finish'); return this; }
  close() { this.destroyed = true; this.emit('close'); }
}
function harness() {
  let now = 1;
  let timerCallbacks: Array<() => void> = [];
  const lruModule = { exports: {} };
  // Execute the installed LRU implementation with a deterministic clock. No cache
  // methods are mocked, including TTL expiry, capacity eviction and disposal.
  vm.runInNewContext(lruSource, {
    module: lruModule, performance: { now: () => now }, console,
    setTimeout: (callback: () => void) => { timerCallbacks.push(callback); return { unref() {} }; },
  });
  const apps: any[] = [];
  const adminAuth = {
    verifySessionCookie: vi.fn(async (session: string, _checkRevoked?: boolean) => ({ uid: session.split(':')[0] })),
    createCustomToken: vi.fn(async (uid: string) => uid),
    verifyIdToken: vi.fn(async (_token: string) => ({ iat: Date.now() / 1000 })),
    createSessionCookie: vi.fn(async () => 'minted-cookie'),
  };
  const deleteApp = vi.fn(async (app: any) => { app.deleted = true; });
  const getAuth = vi.fn((app: any) => {
    if (app.deleted) throw new Error('app/app-deleted');
    return app.auth;
  });
  const signIn = vi.fn(async (auth: any, uid: string) => {
    if (auth.app.deleted) throw new Error('app/app-deleted');
    auth.currentUser = { uid };
  });
  const imports = installedSource.match(/^import .+;\n/gm) || [];
  expect(imports).toHaveLength(7);
  // Only import bindings and export syntax are adapted for dependency injection;
  // every shipped executable statement is evaluated unchanged.
  const executable = installedSource.replace(/^import .+;\n/gm, '').replace('export const handleFactory', 'const handleFactory');
  const factory = vm.runInNewContext(`${executable}\nhandleFactory;`, {
    ...constants, LRU: lruModule.exports, cookie: frameworkRequire('cookie'),
    getApps: () => [], initializeAdminApp: () => ({}), getAdminAuth: () => adminAuth,
    initializeApp: (_options: unknown, name: string) => {
      const app: any = { name, deleted: false }; app.auth = { app, currentUser: null }; apps.push(app); return app;
    }, deleteApp, getAuth, signInWithCustomToken: signIn, console: { error: vi.fn() },
  });
  const render = vi.fn((_req: any, res: Response) => { if (res.locals.firebaseApp) getAuth(res.locals.firebaseApp); });
  function request(session?: string, renderer: any = render) {
    const response = new Response();
    const done: Promise<void> = factory(renderer)({ url: '/', headers: { cookie: session ? `__session=${session}` : '' } }, response);
    return { response, done };
  }
  async function completed(uid: string) { const result = request(uid); await result.done; result.response.end(); return result; }
  return { apps, adminAuth, deleteApp, getAuth, signIn, render, factory, request, completed,
    advance: (ms: number) => { now += ms; const callbacks = timerCallbacks; timerCallbacks = []; callbacks.forEach(callback => callback()); },
  };
}

describe('shipped firebase-frameworks auth cache', () => {
  it('installs the reviewed bytes from the committed production tarball', () => {
    assertSource(installedSource, PATCHED_VERSION, PATCHED_VERSION, PATCHED_SOURCE_HASH);
    const packedSource = execFileSync('tar', ['-xOf', `vendor/${TARBALL}`, 'package/dist/firebase-aware.js'], { encoding: 'utf8' });
    expect(packedSource).toBe(installedSource);
    expect(fs.readFileSync('vendor/firebase-frameworks/firebase-aware.js', 'utf8')).toBe(installedSource);
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
    expect(packageJson.dependencies['firebase-frameworks']).toBe(`file:vendor/${TARBALL}`);
    expect(lock.packages['node_modules/firebase-frameworks'].resolved).toBe(`file:vendor/${TARBALL}`);
    expect(lock.packages['node_modules/firebase-frameworks'].version).toBe(PATCHED_VERSION);
  });
  it('rejects a changed upstream version or content before rebuilding', () => {
    expect(() => assertSource('changed', UPSTREAM_VERSION, UPSTREAM_VERSION, UPSTREAM_SOURCE_HASH)).toThrow('Unreviewed');
    expect(() => assertSource(installedSource, '0.11.9', PATCHED_VERSION, PATCHED_SOURCE_HASH)).toThrow('Unreviewed');
  });
  it('survives the installed Firebase CLI SSR packaging step with scripts removed', async () => {
    const source = fs.readFileSync(require.resolve('firebase-tools/lib/frameworks/index.js'), 'utf8');
    const start = source.indexOf('            delete packageJson.scripts;');
    const end = source.indexOf('            let dotEnvContents = "";', start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'writeoff-frameworks-package-test-'));
    try {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      // Execute the actual CLI copy/rewrite code, stopping before environment
      // files, npm or any provider interaction. Upgrades must retain this contract.
      await vm.runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
        packageJson, functionsDist: output, fs_extra_1: require('fs-extra'),
        promises_1: require('node:fs/promises'), path_1: path,
        getProjectPath: (name: string) => path.resolve(name),
      });
      const generated = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'));
      expect(generated.scripts).toBeUndefined(); expect(generated.devDependencies).toBeUndefined();
      expect(generated.dependencies['firebase-frameworks']).toBe(`file:${TARBALL}`);
      expect(fs.readFileSync(path.join(output, TARBALL))).toEqual(fs.readFileSync(`vendor/${TARBALL}`));
      expect(fs.existsSync(path.join(output, '.env'))).toBe(false);
    } finally { fs.rmSync(output, { recursive: true, force: true }); }
  });
  it('expires an idle app without returning the deleted stale app', async () => {
    const h = harness(); const first = await h.completed('owner');
    h.advance(constants.LRU_TTL + 1);
    const second = await h.completed('owner');
    expect(first.response.locals.firebaseApp.deleted).toBe(true);
    expect(second.response.locals.firebaseApp).not.toBe(first.response.locals.firebaseApp);
    expect(second.response.locals.currentUser.uid).toBe('owner');
    expect(h.deleteApp).toHaveBeenCalledTimes(1);
    expect(h.adminAuth.verifySessionCookie.mock.calls.filter(([, revoked]) => revoked)).toHaveLength(2);
  });
  it('coalesces concurrent cold UID misses only after each revocation check passes', async () => {
    const h = harness(); const bothChecking = deferred(); const gate = deferred(); let checks = 0;
    h.adminAuth.verifySessionCookie.mockImplementation(async (session, revoked) => {
      if (revoked) { if (++checks === 2) bothChecking.resolve(); await gate.promise; }
      return { uid: session };
    });
    const first = h.request('owner'); const second = h.request('owner');
    await bothChecking.promise; gate.resolve(); await Promise.all([first.done, second.done]);
    expect(h.apps).toHaveLength(1);
    expect(first.response.locals.firebaseApp).toBe(second.response.locals.firebaseApp);
    expect(h.deleteApp).not.toHaveBeenCalled();
    first.response.end(); second.response.end();
  });
  it('does not reuse a concurrently populated cache for a revoked cookie', async () => {
    const h = harness(); const checking = deferred(); const gate = deferred();
    h.adminAuth.verifySessionCookie.mockImplementation(async (session, revoked) => {
      if (session === 'owner:revoked' && revoked) { checking.resolve(); await gate.promise; throw new Error('revoked'); }
      return { uid: 'owner' };
    });
    const revoked = h.request('owner:revoked'); await checking.promise;
    await h.completed('owner:valid'); gate.resolve(); await revoked.done;
    expect(revoked.response.locals).toEqual({}); expect(h.apps).toHaveLength(1);
    revoked.response.end();
  });
  it('keeps the existing cached-session revocation policy and owner isolation', async () => {
    const h = harness(); const first = await h.completed('alice'); const cached = await h.completed('alice'); const other = await h.completed('bob');
    expect(first.response.locals.firebaseApp).toBe(cached.response.locals.firebaseApp);
    expect(other.response.locals.firebaseApp).not.toBe(first.response.locals.firebaseApp);
    expect(other.response.locals.currentUser.uid).toBe('bob');
    expect(h.adminAuth.verifySessionCookie.mock.calls.filter(([, revoked]) => revoked)).toHaveLength(2);
  });
  it('defers capacity eviction while sign-in is pending, including client disconnect', async () => {
    const h = harness(); const signingIn = deferred(); const gate = deferred();
    h.signIn.mockImplementation(async (auth, uid) => {
      if (uid === 'held') { signingIn.resolve(); await gate.promise; }
      if (auth.app.deleted) throw new Error('app/app-deleted'); auth.currentUser = { uid };
    });
    const held = h.request('held'); await signingIn.promise; const app = h.apps[0];
    held.response.close();
    for (let i = 0; i < constants.LRU_MAX_INSTANCES; i++) await h.completed(`other${i}`);
    expect(app.deleted).toBe(false); gate.resolve(); await held.done;
    expect(app.deleted).toBe(true); expect(h.deleteApp.mock.calls.filter(([value]) => value === app)).toHaveLength(1);
    expect(held.response.listenerCount('close')).toBe(0);
  });
  it('retains expired apps until every streaming response finishes', async () => {
    const h = harness(); const first = h.request('owner'); await first.done;
    const second = h.request('owner'); await second.done; const app = first.response.locals.firebaseApp;
    h.advance(constants.LRU_TTL + 1); await h.completed('owner');
    expect(app.deleted).toBe(false); first.response.end(); expect(app.deleted).toBe(false);
    second.response.end(); second.response.close(); expect(app.deleted).toBe(true);
    expect(h.deleteApp.mock.calls.filter(([value]) => value === app)).toHaveLength(1);
    expect(first.response.listenerCount('close')).toBe(0);
  });
  it('waits for asynchronous rendering even when the response closes first', async () => {
    const h = harness(); const rendering = deferred(); const gate = deferred();
    const held = h.request('owner', async (_req: any, res: Response) => {
      rendering.resolve(); await gate.promise; h.getAuth(res.locals.firebaseApp);
    });
    await rendering.promise; const app = held.response.locals.firebaseApp; held.response.close();
    h.advance(constants.LRU_TTL + 1); await h.completed('owner'); expect(app.deleted).toBe(false);
    gate.resolve(); await held.done; expect(app.deleted).toBe(true);
  });
  it('releases an evicted app when authentication fails', async () => {
    const h = harness(); const signingIn = deferred(); const gate = deferred();
    h.signIn.mockImplementation(async (auth, uid) => {
      if (uid === 'held' && auth.app === h.apps[0]) { signingIn.resolve(); await gate.promise; throw new Error('sign-in failed'); }
      auth.currentUser = { uid };
    });
    const held = h.request('held'); const failure = expect(held.done).rejects.toThrow('sign-in failed'); await signingIn.promise;
    h.advance(constants.LRU_TTL + 1); await h.completed('held:new'); gate.resolve(); await failure;
    expect(h.apps[0].deleted).toBe(true); expect(held.response.listenerCount('finish')).toBe(0);
  });
  it('releases an evicted app when asynchronous rendering rejects', async () => {
    const h = harness(); const rendering = deferred(); const gate = deferred();
    const held = h.request('owner', async () => { rendering.resolve(); await gate.promise; throw new Error('render failed'); });
    const failure = expect(held.done).rejects.toThrow('render failed'); await rendering.promise;
    h.advance(constants.LRU_TTL + 1); await h.completed('owner'); gate.resolve(); await failure;
    expect(h.apps[0].deleted).toBe(true); expect(held.response.listenerCount('close')).toBe(0);
  });
  it('leaves anonymous, invalid-session and cookie-minting behavior intact', async () => {
    const h = harness(); const anonymous = h.request(); await anonymous.done; anonymous.response.end();
    h.adminAuth.verifySessionCookie.mockRejectedValueOnce(new Error('invalid'));
    const invalid = h.request('invalid'); await invalid.done; invalid.response.end();
    expect(h.apps).toHaveLength(0); expect(h.render).toHaveBeenCalledTimes(2);
    const response = new Response();
    await h.factory(h.render)({ url: '/__session', header: () => 'Bearer valid' }, response);
    expect(h.adminAuth.createSessionCookie).toHaveBeenCalledWith('valid', { expiresIn: constants.COOKIE_MAX_AGE });
    expect(response.statusCode).toBe(201);
    expect(response.cookies).toEqual([['__session', 'minted-cookie', { maxAge: constants.COOKIE_MAX_AGE, httpOnly: true, secure: true }]]);
    expect(h.render).toHaveBeenCalledTimes(2);
  });
});
