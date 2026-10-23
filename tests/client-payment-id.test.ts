import { afterEach, describe, expect, it } from 'vitest';
import { newClientPaymentId } from '@/lib/planner/client-payment-id';

const CLIENT_PAYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('client payment ids', () => {
  const original = globalThis.crypto.randomUUID;
  afterEach(() => { globalThis.crypto.randomUUID = original; });

  it('uses randomUUID when it is available', () => {
    expect(newClientPaymentId()).toMatch(CLIENT_PAYMENT_ID);
  });

  it('mints an id when randomUUID is unavailable', () => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined });
    const id = newClientPaymentId();
    expect(typeof globalThis.crypto.randomUUID).not.toBe('function');
    expect(id).toMatch(CLIENT_PAYMENT_ID);
    expect(id).not.toMatch(/^Q[1-4]_\d{4}$/);
  });
});
