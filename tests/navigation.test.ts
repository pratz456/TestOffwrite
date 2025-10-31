import { describe, it, expect } from 'vitest';
import { buildTransactionDetailUrl } from '../lib/url';

describe('buildTransactionDetailUrl', () => {
  it('uses trans_id when available', () => {
    const tx = { id: '123', trans_id: 'tx_456' };
    const url = buildTransactionDetailUrl(tx, 'review-transactions');
    expect(url).toBe('/protected?screen=transaction-detail&transactionId=tx_456&from=review-transactions');
  });

  it('falls back to id when trans_id missing', () => {
    const tx = { id: '789' };
    const url = buildTransactionDetailUrl(tx, 'dashboard');
    expect(url).toBe('/protected?screen=transaction-detail&transactionId=789&from=dashboard');
  });

  it('returns null when no id present', () => {
    const tx = { merchant_name: 'Coffee' };
    const url = buildTransactionDetailUrl(tx);
    expect(url).toBeNull();
  });
});
