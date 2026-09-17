/**
 * Redacted per-user support summary, built server-side with the Admin SDK.
 *
 * Every field below is an explicit allowlist: nothing is copied from a
 * document wholesale. Provider tokens, encrypted tokens, sync cursors, taxpayer
 * identifiers (SSN/EIN), Stripe secrets and transaction amounts are never read
 * into the result. Provider identifiers (Plaid item IDs, Stripe customer and
 * subscription IDs) are included because the runbook procedures need them to
 * act on exactly one record.
 */
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { evaluateEntitlements } from '@/lib/subscriptions/entitlements';

const UID = /^[^/\\\u0000-\u001f\u007f]{1,128}$/;
const TASK_SCAN_LIMIT = 2_000;
const ANALYSIS_TASK_STATUSES = ['queued', 'running', 'retry_wait', 'paused', 'failed', 'completed', 'skipped'] as const;

type Data = Record<string, unknown>;

export interface BankConnectionDiagnostics {
  itemId: string;
  institutionId: string | null;
  /** Raw stored status: active, relink_required, revocation_required, disconnecting, disconnected. */
  status: string | null;
  /** Credentials belong to the configured Plaid client and environment. */
  currentProvider: boolean;
  reauthenticationRequired: boolean;
  accountCount: number;
  hasEncryptedToken: boolean;
  hasCursor: boolean;
  leaseActive: boolean;
  connectedAt: string | null;
  lastSync: string | null;
  updatedAt: string | null;
}

export interface AccountDiagnostics {
  generatedAt: string;
  uid: string;
  auth: { exists: boolean; emailMasked: string | null; emailVerified: boolean | null; disabled: boolean | null;
    providers: string[]; createdAt: string | null; lastSignInAt: string | null };
  profile: { exists: boolean; emailMasked: string | null; bankConnected: boolean | null; legacyCredentialsPresent: boolean;
    legacyCredentialsMigrated: boolean; lastSync: string | null; lastSyncSource: string | null; lastImportTimeframe: string | null };
  entitlement: { plan: string; status: string; reason: string; hasAccess: boolean; isTrial: boolean; isPaid: boolean;
    trialStart: string | null; trialEnd: string | null; subscriptionEnd: string | null };
  billing: { stripeCustomerId: string | null; stripeSubscriptionId: string | null; stripeSubscriptionStatus: string | null;
    subscriptionPlan: string | null; subscriptionStatus: string | null; hasHistoricalAccess: boolean | null;
    syncRevision: number; lastWebhookEventId: string | null; lastWebhookEventAt: string | null };
  bankConnections: BankConnectionDiagnostics[];
  deletion: {
    requested: boolean;
    linkOperations: Array<{ id: string; state: string | null; startedAt: string | null }>;
    billingOperations: Array<{ id: string; state: string | null; startedAt: string | null; customerId: string | null; recoveryRequired: boolean }>;
    revocationRecords: Array<{ id: string; status: string | null; itemId: string | null; currentProvider: boolean; createdAt: string | null }>;
    /** Deletion is blocked until every unresolved operation is finished or reviewed. */
    blockedByOperations: boolean;
  };
  analysis: { tasks: Record<typeof ANALYSIS_TASK_STATUSES[number], number>; truncated: boolean; lastErrorCodes: string[];
    activeJobs: number };
}

export function validSupportUid(value: unknown): value is string {
  return typeof value === 'string' && UID.test(value) && value !== '.' && value !== '..';
}

export function maskEmail(value: unknown): string | null {
  if (typeof value !== 'string' || !value.includes('@')) return null;
  const [local, domain] = value.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export function isoDate(value: unknown): string | null {
  try {
    const normalized = value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate() : value;
    if (!(normalized instanceof Date) && typeof normalized !== 'number' && typeof normalized !== 'string') return null;
    const date = new Date(normalized);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  } catch { return null; }
}

const text = (value: unknown): string | null => typeof value === 'string' && value ? value : null;
const flag = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const currentProvider = (data: Data) => Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_ENV
  && data.clientId === process.env.PLAID_CLIENT_ID && data.environment === process.env.PLAID_ENV);

async function authSummary(uid: string): Promise<AccountDiagnostics['auth']> {
  try {
    const record = await adminAuth.getUser(uid);
    return { exists: true, emailMasked: maskEmail(record.email), emailVerified: record.emailVerified, disabled: record.disabled,
      providers: (record.providerData ?? []).map(provider => provider.providerId), createdAt: isoDate(record.metadata?.creationTime),
      lastSignInAt: isoDate(record.metadata?.lastSignInTime) };
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') {
      return { exists: false, emailMasked: null, emailVerified: null, disabled: null, providers: [], createdAt: null, lastSignInAt: null };
    }
    throw error;
  }
}

function operations(value: unknown): Array<[string, Data]> {
  return value && typeof value === 'object' ? Object.entries(value as Record<string, Data>) : [];
}

/** Read-only. Never writes, never contacts Plaid or Stripe. */
export async function buildAccountDiagnostics(uid: string): Promise<AccountDiagnostics> {
  if (!validSupportUid(uid)) throw new Error('Invalid account identifier');
  const [auth, profileSnapshot, syncState, deletionSnapshot, revocations, banks, tasks, jobs] = await Promise.all([
    authSummary(uid),
    adminDb.doc(`user_profiles/${uid}`).get(),
    adminDb.doc(`user_profiles/${uid}/stripe_sync/state`).get(),
    adminDb.doc(`account_deletions/${uid}`).get(),
    adminDb.collection(`account_deletions/${uid}/plaid_revocations`).get(),
    adminDb.collection('plaid_connections').where('uid', '==', uid).get(),
    adminDb.collection('analysis_tasks').where('userId', '==', uid).limit(TASK_SCAN_LIMIT).get(),
    adminDb.collection('analysis_jobs').where('userId', '==', uid).get(),
  ]);
  const profile: Data = profileSnapshot.data() ?? {};
  const sync: Data = syncState.data() ?? {};
  const deletion: Data = deletionSnapshot.data() ?? {};
  const entitlement = evaluateEntitlements(profile);
  const linkOperations = operations(deletion.linkOperations).map(([id, operation]) => ({ id, state: text(operation.state), startedAt: isoDate(operation.startedAt) }));
  const billingOperations = operations(deletion.billingOperations).map(([id, operation]) => ({ id, state: text(operation.state),
    startedAt: isoDate(operation.startedAt), customerId: text(operation.customerId), recoveryRequired: operation.recoveryRequired === true }));
  const taskCounts = Object.fromEntries(ANALYSIS_TASK_STATUSES.map(status => [status, 0])) as AccountDiagnostics['analysis']['tasks'];
  const errorCodes = new Set<string>();
  for (const task of tasks.docs) {
    const data: Data = task.data() ?? {};
    if (typeof data.status === 'string' && data.status in taskCounts) taskCounts[data.status as keyof typeof taskCounts] += 1;
    if (typeof data.lastErrorCode === 'string' && data.lastErrorCode) errorCodes.add(data.lastErrorCode);
  }
  return {
    generatedAt: new Date().toISOString(),
    uid,
    auth,
    profile: {
      exists: profileSnapshot.exists, emailMasked: maskEmail(profile.email), bankConnected: flag(profile.bankConnected),
      legacyCredentialsPresent: Boolean(profile.plaid_token || profile.access_token),
      legacyCredentialsMigrated: profile.plaid_credentials_migrated === true,
      lastSync: isoDate(profile.last_sync), lastSyncSource: text(profile.last_sync_source), lastImportTimeframe: text(profile.last_import_timeframe),
    },
    entitlement: {
      plan: entitlement.plan, status: entitlement.status, reason: entitlement.reason, hasAccess: entitlement.hasAccess,
      isTrial: entitlement.isTrial, isPaid: entitlement.isPaid, trialStart: isoDate(entitlement.trialStart),
      trialEnd: isoDate(entitlement.trialEnd), subscriptionEnd: isoDate(entitlement.subscriptionEnd),
    },
    billing: {
      stripeCustomerId: text(profile.stripeCustomerId), stripeSubscriptionId: text(profile.stripeSubscriptionId),
      stripeSubscriptionStatus: text(profile.stripeSubscriptionStatus), subscriptionPlan: text(profile.subscriptionPlan),
      subscriptionStatus: text(profile.subscriptionStatus), hasHistoricalAccess: flag(profile.hasHistoricalAccess),
      syncRevision: Number(sync.revision) || 0, lastWebhookEventId: text(sync.eventId),
      lastWebhookEventAt: typeof sync.eventCreated === 'number' ? isoDate(sync.eventCreated * 1000) : null,
    },
    bankConnections: banks.docs.map((doc): BankConnectionDiagnostics => {
      const data: Data = doc.data() ?? {};
      return {
        itemId: text(data.itemId) ?? doc.id, institutionId: text(data.institutionId), status: text(data.status),
        currentProvider: currentProvider(data), reauthenticationRequired: data.reauthenticationRequired === true,
        accountCount: Array.isArray(data.accountIds) ? data.accountIds.length : 0,
        hasEncryptedToken: typeof data.encryptedAccessToken === 'string' && data.encryptedAccessToken.length > 0,
        hasCursor: typeof data.cursor === 'string' && data.cursor.length > 0,
        leaseActive: typeof data.leaseExpiresAt === 'number' && data.leaseExpiresAt > Date.now(),
        connectedAt: isoDate(data.connectedAt), lastSync: isoDate(data.lastSync), updatedAt: isoDate(data.updatedAt),
      };
    }).sort((a, b) => a.itemId.localeCompare(b.itemId)),
    deletion: {
      requested: deletion.deletionRequested === true,
      linkOperations, billingOperations,
      revocationRecords: revocations.docs.map(doc => {
        const data: Data = doc.data() ?? {};
        return { id: doc.id, status: text(data.status), itemId: text(data.itemId), currentProvider: currentProvider(data), createdAt: isoDate(data.createdAt) };
      }).sort((a, b) => a.id.localeCompare(b.id)),
      blockedByOperations: linkOperations.length > 0 || billingOperations.length > 0,
    },
    analysis: {
      tasks: taskCounts, truncated: tasks.docs.length >= TASK_SCAN_LIMIT, lastErrorCodes: [...errorCodes].sort(),
      activeJobs: jobs.docs.filter(doc => doc.data()?.status === 'running').length,
    },
  };
}

/**
 * Field names that must never appear in a support summary. Boolean presence
 * flags (`hasEncryptedToken`, `hasCursor`) are the only permitted mentions.
 */
export const FORBIDDEN_DIAGNOSTIC_KEY = /token|secret|ssn|cursor|amount|password|private|encrypted/i;

/** Defense in depth for the route: throws if a future field leaks sensitive material. */
export function assertRedacted(value: unknown, path = 'diagnostics'): void {
  if (Array.isArray(value)) { value.forEach((entry, index) => assertRedacted(entry, `${path}[${index}]`)); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_DIAGNOSTIC_KEY.test(key) && !(/^has[A-Z]/.test(key) && typeof entry === 'boolean')) {
      throw new Error(`Support summary contains a forbidden field at ${path}.${key}`);
    }
    assertRedacted(entry, `${path}.${key}`);
  }
}
