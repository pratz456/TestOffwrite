import { describe, it, expect } from 'vitest';
import { buildTransactionDetailUrl, getSafeAuthRedirect } from '../lib/url';

describe('post-login navigation', () => {
  it.each([null, '', 'https://example.com', '//example.com', '/\\example.com', 'javascript:alert(1)', '/\n/example.com'])('rejects unsafe redirect %j', (value) => {
    expect(getSafeAuthRedirect(value)).toBe('/protected');
  });

  it('preserves a local destination and its query and fragment', () => {
    expect(getSafeAuthRedirect('/protected?screen=reports#export')).toBe('/protected?screen=reports#export');
  });
});

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
