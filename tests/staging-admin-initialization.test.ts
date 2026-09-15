import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apps: vi.fn(), initialize: vi.fn(), cert: vi.fn(), auth: vi.fn(), firestore: vi.fn() }));
vi.mock('firebase-admin/app', () => ({ getApps: mocks.apps, initializeApp: mocks.initialize, cert: mocks.cert }));
vi.mock('firebase-admin/auth', () => ({ getAuth: mocks.auth }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: mocks.firestore, FieldValue: {}, Timestamp: {} }));
const project = 'writeoff-production-testing';
const bucket = `${project}.firebasestorage.app`;
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  for (const key of ['FIREBASE_CONFIG', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_ADMIN_PROJECT_ID', 'FIREBASE_ADMIN_CLIENT_EMAIL',
    'FIREBASE_ADMIN_PRIVATE_KEY', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT', 'FIREBASE_STORAGE_BUCKET']) vi.stubEnv(key, '');
  vi.stubEnv('WRITEOFF_ENV', 'staging');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', project);
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', bucket);
  mocks.apps.mockReturnValue([]);
  mocks.initialize.mockImplementation(options => ({ options }));
});
afterEach(() => vi.unstubAllEnvs());

describe('staging Admin client construction', () => {
  it('initializes the explicit staging project and bucket before creating service clients', async () => {
    await import('../lib/firebase/admin');
    expect(mocks.initialize).toHaveBeenCalledWith({ projectId: project, storageBucket: bucket });
    expect(mocks.auth).toHaveBeenCalledOnce();
    expect(mocks.firestore).toHaveBeenCalledOnce();
  });
  it('rejects a conflicting runtime project before any Admin initialization', async () => {
    vi.stubEnv('GCLOUD_PROJECT', 'production-fixture');
    await expect(import('../lib/firebase/admin')).rejects.toThrow('unapproved project');
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.firestore).not.toHaveBeenCalled();
  });
  it.each([{ projectId: 'production-fixture' }, {}])('rejects reuse of an existing app with an unapproved or implicit project %s', async options => {
    mocks.apps.mockReturnValue([{ options }]);
    await expect(import('../lib/firebase/admin')).rejects.toThrow('Admin app projectId');
    expect(mocks.firestore).not.toHaveBeenCalled();
  });
  it('reuses a correctly configured staging app', async () => {
    mocks.apps.mockReturnValue([{ options: { projectId: project, storageBucket: bucket } }]);
    await import('../lib/firebase/admin');
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.firestore).toHaveBeenCalledOnce();
  });
});
