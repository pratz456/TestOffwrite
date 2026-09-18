import { randomUUID } from 'node:crypto';
import { adminDb } from '@/lib/firebase/admin';

export class CheckoutOperationError extends Error {
  constructor(public readonly code: 'ACCOUNT_DELETION_PENDING' | 'BILLING_OPERATION_PENDING') {
    super(code === 'ACCOUNT_DELETION_PENDING' ? 'Account deletion is pending. New billing cannot be started.'
      : 'A billing operation needs to finish or be reviewed by support before continuing.');
  }
}
function ref(uid: string) {
  if (!/^[^/\\\u0000-\u001f\u007f]{1,128}$/.test(uid) || ['.', '..'].includes(uid)) throw new Error('Invalid account');
  return adminDb.doc(`account_deletions/${uid}`);
}
/** No TTL: an ambiguous customer creation must not be forgotten during deletion. */
export async function beginCheckoutOperation(uid: string): Promise<string> {
  const reference = ref(uid), id = randomUUID();
  await adminDb.runTransaction(async tx => {
    const current = (await tx.get(reference)).data() ?? {};
    if (current.deletionRequested === true) throw new CheckoutOperationError('ACCOUNT_DELETION_PENDING');
    if (Object.keys(current.billingOperations ?? {}).length) throw new CheckoutOperationError('BILLING_OPERATION_PENDING');
    tx.set(reference, { billingOperations: { [id]: { state: 'in_flight', startedAt: Date.now() } } }, { merge: true });
  });
  return id;
}
export async function finishCheckoutOperation(uid: string, id: string): Promise<void> {
  const reference = ref(uid);
  await adminDb.runTransaction(async tx => {
    const current = (await tx.get(reference)).data();
    if (!current?.billingOperations?.[id]) throw new Error('Billing operation missing');
    const next = { ...current.billingOperations }; delete next[id];
    tx.update(reference, { billingOperations: next });
  });
}
export async function retainCheckoutRecovery(uid: string, id: string, customerId?: string): Promise<void> {
  const reference = ref(uid);
  await adminDb.runTransaction(async tx => {
    const current = (await tx.get(reference)).data();
    if (!current?.billingOperations?.[id]) throw new Error('Billing operation missing');
    tx.update(reference, { billingOperations: { ...current.billingOperations, [id]: {
      ...current.billingOperations[id], state: customerId ? 'customer_cleanup_required' : 'customer_create_unknown',
      ...(customerId ? { customerId } : {}), recoveryRequired: true,
    } } });
  });
}
