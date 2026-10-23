/**
 * Live confirm path for a posted bank credit-card payment.
 * Start the Firestore and Auth emulators with this repo's rules and indexes, then run:
 * WRITEOFF_RULES_EMULATOR_TESTS=1 npx vitest run tests/loan-payment-confirm-path.emulator.test.ts
 * Defaults: Firestore 127.0.0.1:8180, Auth 127.0.0.1:9099, project demo-writeoff-security.
 * Only a synthetic profile under a fresh uid is written, then removed.
 * No network requests, SDK initialization, or production configuration when disabled.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import type { Auth } from 'firebase-admin/auth';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import {
  CREDIT_CARD_PAYMENT_AMOUNT,
  CREDIT_CARD_PAYMENT_CATEGORY,
  CREDIT_CARD_PAYMENT_DATE,
  bankSyncCreditCardPaymentWrite,
  expectCreditCardPaymentOnReviewWithNoScheduleCLine,
} from './loan-payment-confirm-path';

const enabled = process.env.WRITEOFF_RULES_EMULATOR_TESTS === '1';
const projectId = process.env.WRITEOFF_RULES_PROJECT_ID || 'demo-writeoff-security';
const firestorePort = Number(process.env.WRITEOFF_RULES_FIRESTORE_PORT || 8180);
const authPort = Number(process.env.WRITEOFF_RULES_AUTH_PORT || 9099);
if (enabled && (!/^demo-[a-z0-9-]+$/.test(projectId) ||
    [firestorePort, authPort].some(port => !Number.isInteger(port) || port < 1024 || port > 65535))) {
  throw new Error('Credit card payment emulator tests require a demo project and valid local emulator ports.');
}

const suffix = randomBytes(4).toString('hex');
const uid = `ccpay_${suffix}`;
const accountId = 'checking';
const transId = `ccpay-tx-${suffix}`;
let adminDb: Firestore;
let adminAuth: Auth;
let adminApp: App;
let createTransactionServer: typeof import('@/lib/firebase/transactions-server').createTransactionServer;
let putTransaction: typeof import('@/app/api/transactions/[id]/route').PUT;

function emulatorEnv() {
  process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${firestorePort}`;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${authPort}`;
  process.env.GCLOUD_PROJECT = projectId;
  process.env.GOOGLE_CLOUD_PROJECT = projectId;
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
  // The Admin singleton is created on import. Point it at the demo emulator
  // before that, and drop credential env so a developer shell cannot select another project.
  delete process.env.FIREBASE_ADMIN_PROJECT_ID;
  delete process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  delete process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (process.env.WRITEOFF_ENV === 'staging') delete process.env.WRITEOFF_ENV;
  if (process.env.WRITEOFF_LOCAL_ACCOUNT_PREVIEW === 'true') delete process.env.WRITEOFF_LOCAL_ACCOUNT_PREVIEW;
}

async function verifiedIdToken(): Promise<string> {
  const email = `${uid}@example.com`;
  await adminAuth.createUser({ uid, email, emailVerified: true, password: 'synthetic-password-1' });
  const response = await fetch(
    `http://127.0.0.1:${authPort}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'synthetic-password-1', returnSecureToken: true }),
    },
  );
  expect(response.status).toBe(200);
  const body = await response.json() as { idToken?: string };
  expect(typeof body.idToken).toBe('string');
  return body.idToken as string;
}

// No network requests, SDK initialization or production configuration when disabled.
(enabled ? describe : describe.skip)('live confirm path for a posted bank credit card payment', () => {
  beforeAll(async () => {
    emulatorEnv();
    const [admin, transactions, route] = await Promise.all([
      import('@/lib/firebase/admin'),
      import('@/lib/firebase/transactions-server'),
      import('@/app/api/transactions/[id]/route'),
    ]);
    adminApp = admin.adminApp;
    adminDb = admin.adminDb;
    adminAuth = admin.adminAuth;
    createTransactionServer = transactions.createTransactionServer;
    putTransaction = route.PUT;
  });

  afterAll(async () => {
    if (adminDb) {
      await adminDb.recursiveDelete(adminDb.doc(`user_profiles/${uid}`)).catch(() => undefined);
      const corrections = await adminDb.collection('user_corrections').where('userId', '==', uid).get().catch(() => null);
      if (corrections) await Promise.all(corrections.docs.map(doc => doc.ref.delete()));
      await adminDb.doc(`learning_patterns/${uid}`).delete().catch(() => undefined);
    }
    if (adminAuth) await adminAuth.deleteUser(uid).catch(() => undefined);
    if (adminApp) {
      const { deleteApp } = await import('firebase-admin/app');
      await deleteApp(adminApp).catch(() => undefined);
    }
  });

  it('PUT { is_deductible: true } confirms a posted 2025 credit card payment with $0 on every Schedule C line and the amount still on the review list', async () => {
    await adminDb.doc(`user_profiles/${uid}/accounts/${accountId}`).set({ userId: uid, user_id: uid, name: 'Checking' });
    const write = bankSyncCreditCardPaymentWrite(transId);
    expect(write).not.toHaveProperty('transaction_kind');
    const created = await createTransactionServer(uid, accountId, write);
    expect(created.error).toBeNull();
    const ref = adminDb.doc(`user_profiles/${uid}/accounts/${accountId}/transactions/${transId}`);
    const seeded = (await ref.get()).data();
    expect(seeded).toMatchObject({
      category: CREDIT_CARD_PAYMENT_CATEGORY,
      amount: CREDIT_CARD_PAYMENT_AMOUNT,
      date: CREDIT_CARD_PAYMENT_DATE,
      is_deductible: null,
      pending: false,
      userId: uid,
      account_id: accountId,
    });
    expect(seeded).not.toHaveProperty('transaction_kind');
    expect(seeded?.review_status).toBeUndefined();

    const token = await verifiedIdToken();
    const response = await putTransaction(
      new NextRequest(`http://127.0.0.1/api/transactions/${transId}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ is_deductible: true }),
      }),
      { params: Promise.resolve({ id: transId }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { success?: boolean; transaction?: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.transaction).toMatchObject({
      is_deductible: true,
      review_status: 'confirmed',
      tax_review_required: false,
      amount: CREDIT_CARD_PAYMENT_AMOUNT,
      category: CREDIT_CARD_PAYMENT_CATEGORY,
    });

    const saved = (await ref.get()).data();
    expect(saved?.review_status).toBe('confirmed');
    expect(saved?.review_source).toBe('user_decision');
    expect(typeof saved?.reviewed_at).toBe('string');
    expectCreditCardPaymentOnReviewWithNoScheduleCLine(saved as never);
    expectCreditCardPaymentOnReviewWithNoScheduleCLine(body.transaction as never);
  });
});
