import { describe, expect, it } from 'vitest';
import { receiptCommitForm, reviewedReceiptData } from '../lib/receipts/receipt-review';

const draft = { merchant: ' Corrected merchant ', amount: '123.45', date: '2026-09-15', category: ' office supplies ' };

describe('receipt review and manual recovery', () => {
  it('commits exactly the user-reviewed details with the original receipt file', async () => {
    const file = new File(['receipt image bytes'], 'receipt.png', { type: 'image/png' });
    const form = receiptCommitForm(file, draft, 'expense');
    const decoded = await new Request('https://staging.example/api/receipts/process', { method: 'POST', body: form }).formData();
    expect(decoded.get('mode')).toBe('commit');
    expect(decoded.get('receiptType')).toBe('expense');
    expect(JSON.parse(String(decoded.get('receiptData')))).toEqual({ merchant: 'Corrected merchant', amount: 123.45, date: '2026-09-15', category: 'office supplies' });
    expect(decoded.has('attachTransactionId')).toBe(false);
    expect(await (decoded.get('file') as File).text()).toBe('receipt image bytes');
  });
  it('supports manual entry without any OCR result or confidence value', () => {
    const form = receiptCommitForm(new File(['image'], 'manual.png'), { merchant: 'Client payment', amount: '80', date: '2026-09-01', category: '' }, 'income');
    expect(form.get('receiptType')).toBe('income');
    expect(JSON.parse(String(form.get('receiptData')))).toMatchObject({ amount: 80, category: 'other' });
  });
  it('attaches a receipt without sending replacements for bank-transaction fields', () => {
    const form = receiptCommitForm(new File(['image'], 'receipt.png'), { merchant: '', amount: '', date: '', category: '' }, 'expense', 'owned-transaction');
    expect(form.get('attachTransactionId')).toBe('owned-transaction');
    expect(form.has('receiptData')).toBe(false);
  });
  it.each(['', '0', '-1', 'NaN', 'Infinity'])('does not submit invalid amount %s', amount => {
    expect(() => reviewedReceiptData({ ...draft, amount })).toThrow('amount greater than zero');
  });
  it.each(['', '2026-02-30', '2026-13-01', '2026-2-1', '2026-09-15T12:00:00Z'])('does not submit invalid date %s', date => {
    expect(() => reviewedReceiptData({ ...draft, date })).toThrow('valid receipt date');
  });
  it('requires a merchant and enforces the server text limits', () => {
    expect(() => reviewedReceiptData({ ...draft, merchant: ' ' })).toThrow('merchant');
    expect(() => reviewedReceiptData({ ...draft, merchant: 'x'.repeat(501) })).toThrow('merchant');
    expect(() => reviewedReceiptData({ ...draft, category: 'x'.repeat(201) })).toThrow('category');
  });
});
