import { readFileSync } from 'node:fs';

export const STAGING_FIREBASE_PROJECT = 'writeoff-production-testing';
export const STAGING_FIREBASE_BUCKETS = [
  `${STAGING_FIREBASE_PROJECT}.firebasestorage.app`,
  `${STAGING_FIREBASE_PROJECT}.appspot.com`,
];

type Environment = Record<string, string | undefined>;
type FirebaseOptions = { projectId?: string; storageBucket?: string; credential?: object };

function readConfiguration(value: string, variable: string): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(value.trim().startsWith('{') ? value : readFileSync(value, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid config');
    return data as Record<string, unknown>;
  } catch {
    throw new Error(`Staging isolation: ${variable} must contain a valid configuration`);
  }
}

/** Validate every configured target before constructing an Admin client. Never include values in errors. */
export function assertStagingFirebaseEnvironment(env: Environment = process.env, appOptions?: FirebaseOptions) {
  if (env.WRITEOFF_ENV !== 'staging') return undefined;
  if (appOptions && appOptions.projectId !== STAGING_FIREBASE_PROJECT) {
    throw new Error('Staging isolation: Admin app projectId must explicitly select the staging project');
  }
  const config = env.FIREBASE_CONFIG ? readConfiguration(env.FIREBASE_CONFIG, 'FIREBASE_CONFIG') : {};
  const serviceAccount = env.GOOGLE_APPLICATION_CREDENTIALS
    ? readConfiguration(env.GOOGLE_APPLICATION_CREDENTIALS, 'GOOGLE_APPLICATION_CREDENTIALS') : {};
  const credentialProject = appOptions?.credential && 'projectId' in appOptions.credential ? appOptions.credential.projectId : undefined;
  const projects: Array<[string, unknown]> = [
    ['FIREBASE_ADMIN_PROJECT_ID', env.FIREBASE_ADMIN_PROJECT_ID],
    ['NEXT_PUBLIC_FIREBASE_PROJECT_ID', env.NEXT_PUBLIC_FIREBASE_PROJECT_ID],
    ['GCLOUD_PROJECT', env.GCLOUD_PROJECT], ['GOOGLE_CLOUD_PROJECT', env.GOOGLE_CLOUD_PROJECT],
    ['GCP_PROJECT', env.GCP_PROJECT], ['FIREBASE_CONFIG.projectId', config.projectId],
    ['GOOGLE_APPLICATION_CREDENTIALS.project_id', serviceAccount.project_id],
    ['Admin app projectId', appOptions?.projectId], ['Admin credential projectId', credentialProject],
  ];
  for (const [name, value] of projects) {
    if (value !== undefined && value !== '' && value !== STAGING_FIREBASE_PROJECT) throw new Error(`Staging isolation: ${name} targets an unapproved project`);
  }
  if (!projects.some(([, value]) => value === STAGING_FIREBASE_PROJECT)) throw new Error('Staging isolation: an explicit staging Firebase project is required');
  for (const [name, value] of [
    ['FIREBASE_ADMIN_CLIENT_EMAIL', env.FIREBASE_ADMIN_CLIENT_EMAIL],
    ['GOOGLE_APPLICATION_CREDENTIALS.client_email', serviceAccount.client_email],
  ] as const) {
    if (value && (typeof value !== 'string' || !value.endsWith(`@${STAGING_FIREBASE_PROJECT}.iam.gserviceaccount.com`))) {
      throw new Error(`Staging isolation: ${name} must belong to the staging project`);
    }
  }
  const buckets: Array<[string, unknown]> = [
    ['FIREBASE_STORAGE_BUCKET', env.FIREBASE_STORAGE_BUCKET],
    ['NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET', env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET],
    ['FIREBASE_CONFIG.storageBucket', config.storageBucket],
    ['Admin app storageBucket', appOptions?.storageBucket],
  ];
  for (const [name, value] of buckets) {
    if (value !== undefined && value !== '' && (typeof value !== 'string' || !STAGING_FIREBASE_BUCKETS.includes(value))) {
      throw new Error(`Staging isolation: ${name} targets an unapproved bucket`);
    }
  }
  const storageBucket = buckets.find(([, value]) => typeof value === 'string' && STAGING_FIREBASE_BUCKETS.includes(value))?.[1];
  if (typeof storageBucket !== 'string') throw new Error('Staging isolation: an explicit staging Storage bucket is required');
  return { projectId: STAGING_FIREBASE_PROJECT, storageBucket };
}
