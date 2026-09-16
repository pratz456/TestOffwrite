import { describe, expect, it } from 'vitest';
import { validateReceiptPreviewPath } from '../lib/receipts/preview-path';

describe('receipt preview URL boundary', () => {
  it.each([
    '/api/receipts/123e4567-e89b-12d3-a456-426614174000',
    '/api/receipts/stored-receipt',
    '/api/receipts/legacy_receipt.png',
    '/api/receipts/uid/transaction/legacy.png',
    `/api/receipts/${'x'.repeat(600)}`,
  ])('preserves private current or legacy receipt path %s', path => {
    const validated = validateReceiptPreviewPath(path);
    expect(validated).toBe(path);
    const resolved = new URL(validated!, 'https://writeoff.example');
    expect(resolved.origin).toBe('https://writeoff.example');
    expect(resolved.pathname).toBe(path);
    expect(resolved.search).toBe('');
    expect(resolved.hash).toBe('');
  });

  it.each([
    ['/api/receipts/uid/transaction/office%20supplies.png', '/api/receipts/uid/transaction/office%20supplies.png'],
    ['/api/receipts/uid/transaction/caf%C3%A9.png', '/api/receipts/uid/transaction/caf%C3%A9.png'],
    ['/api/receipts/uid/transaction/café.png', '/api/receipts/uid/transaction/caf%C3%A9.png'],
    ['/api/receipts/%72eceipt', '/api/receipts/receipt'],
    ["/api/receipts/uid/transaction/owner's.png", '/api/receipts/uid/transaction/owner%27s.png'],
  ])('canonicalizes each private path segment once: %s', (input, expected) => {
    expect(validateReceiptPreviewPath(input)).toBe(expected);
    const url = new URL(expected, 'https://writeoff.example');
    expect(url.origin).toBe('https://writeoff.example');
    expect(url.pathname).toBe(expected);
  });

  it.each([
    undefined, null, 42, {}, '', '/api/receipts/',
    '/api/receipts/.', '/api/receipts/..', '/api/receipts/../auth/logout',
    '/api/receipts/receipt/../../auth/logout', '/api/receipts/receipt\\..\\auth',
    '/api/receipts/%2e%2e', '/api/receipts/%252e%252e',
    '/api/receipts/receipt%2f..%2fauth', '/api/receipts/receipt%5c..%5cauth',
    '/api/receipts/receipt%3Fredirect=evil', '/api/receipts/receipt%23fragment',
    '/api/receipts/receipt?download=1', '/api/receipts/receipt#fragment',
    '//evil.example/api/receipts/receipt', 'https://evil.example/api/receipts/receipt',
    'https://writeoff.example/api/receipts/receipt', 'javascript:alert(1)', 'data:image/png;base64,aGVsbG8=',
    ' /api/receipts/receipt', '/api/receipts/receipt\n',
    '/api/receipts/receipt\0', '/api/receipts/receipt\u202Epng',
    '/api/receipts/uid%2Ftransaction%2Flegacy.png', '/api/receipts/uid%252Ftransaction%252Flegacy.png',
    '/api/receipts/uid/transaction', '/api/receipts/uid/transaction/file/extra',
    '/api/receipts/uid//file', '/api/receipts/uid/../file', '/api/receipts/uid/%2e%2E/file',
    '/api/receipts/uid/transaction/%2Fother', '/api/receipts/uid/transaction/%5Cother',
    '/api/receipts/uid/transaction/%00file', '/api/receipts/uid/transaction/%23file',
    '/api/receipts/uid/transaction/%3Ffile', '/api/receipts/uid/transaction/%252e%252e',
    '/api/receipts/%', '/api/receipts/%C3', '/api/receipts/\ud800',
    '/api/upload-receipt/receipt', `/api/receipts/${'x'.repeat(601)}`,
  ])('rejects untrusted or ambiguous value %j', value => {
    expect(validateReceiptPreviewPath(value)).toBeNull();
  });
});
