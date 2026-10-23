import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const worker = vi.hoisted(() => ({ recognize: vi.fn(), terminate: vi.fn() }));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createTransaction: vi.fn(), getTransaction: vi.fn(), getTransactions: vi.fn(), updateTransaction: vi.fn(),
  collection: vi.fn(), runTransaction: vi.fn(), accountGet: vi.fn(), accountCreate: vi.fn(), receiptCreate: vi.fn(), receiptDelete: vi.fn(),
  bucket: vi.fn(), storageFile: vi.fn(), storageSave: vi.fn(), storageDelete: vi.fn(),
}));
vi.mock('tesseract.js', () => ({ default: { createWorker: vi.fn(async () => worker) } }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock('@/lib/firebase/transactions-server', () => ({
  createTransactionServer: mocks.createTransaction,
  getTransactionServer: mocks.getTransaction,
  getTransactionsServer: mocks.getTransactions,
  updateTransactionServerWithUserId: mocks.updateTransaction,
}));
vi.mock('@/lib/firebase/admin', () => ({ adminApp: { name: 'firebase-frameworks' }, adminDb: { collection: mocks.collection, runTransaction: mocks.runTransaction } }));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: mocks.bucket, app: { options: {} } }) }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
import { receiptProcessor } from '@/lib/ocr/receipt-processor';
import { POST } from '../app/api/receipts/process/route';
import { resetRateLimitStore } from './fixtures/rate-limit-store';

const normalizeDateToISO = (value: unknown, userTimeZone?: string) =>
  (receiptProcessor as unknown as { normalizeDateToISO(dateLike: unknown, userTimeZone?: string): string | null }).normalizeDateToISO(value, userTimeZone);
const extractDate = (text: string) =>
  (receiptProcessor as unknown as { extractDate(text: string): string }).extractDate(text);

const owner = 'receipt-parsed-date-owner';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const KEPT: Array<[string, string]> = [
  ['01/15/2026', '2026-01-15'],
  ['1/1/2026', '2026-01-01'],
  ['Jan 1, 2026', '2026-01-01'],
  ['January 15, 2026', '2026-01-15'],
  ['1/15/26', '2026-01-15'],
  ['2026-1-5', '2026-01-05'],
  ['Dec 31, 2026', '2026-12-31'],
  ['01/02/2026', '2026-01-02'],
  ['Sept 5, 2026', '2026-09-05'],
  ['SEPT. 5, 2026', '2026-09-05'],
  ['sept. 5, 2026', '2026-09-05'],
  ['Jan. 1, 2026', '2026-01-01'],
  ['Jan 5 2026', '2026-01-05'],
  ['JAN 5 2026', '2026-01-05'],
  ['January 5 2026', '2026-01-05'],
  ['Sep 5 2026', '2026-09-05'],
  ['Sept 5 2026', '2026-09-05'],
  ['SEPT 5 2026', '2026-09-05'],
  ['Jan 5, 26', '2026-01-05'],
  ['Sept 5, 26', '2026-09-05'],
  ['5 Jan 2026', '2026-01-05'],
  ['5 Jan. 2026', '2026-01-05'],
  ['5 Sept 2026', '2026-09-05'],
  ['5 Sept. 2026', '2026-09-05'],
  ['05 January 2026', '2026-01-05'],
  ['01-15-2026', '2026-01-15'],
  ['01-15-26', '2026-01-15'],
  ['1-5-2026', '2026-01-05'],
  ['12-31-2026', '2026-12-31'],
];
const ISO_TIMESTAMPS: Array<[string, string, string]> = [
  ['Paid 2026-01-15T10:00:00Z', '2026-01-15T10:00:00Z', '2026-01-15'],
  ['2012-01-15T09:00:00', '2012-01-15T09:00:00', '2012-01-15'],
];
const STREET: Array<[string, string]> = [
  ['Jan. 5, 2026', '2026-01-05'],
  ['Jan. 1, 2026', '2026-01-01'],
  ['Sep. 5, 2026', '2026-09-05'],
  ['Sept. 5, 2026', '2026-09-05'],
  ['SEPT. 5, 2026', '2026-09-05'],
  ['sept. 5, 2026', '2026-09-05'],
  ['5 Jan. 2026', '2026-01-05'],
  ['5 Sept. 2026', '2026-09-05'],
  ['5 Jan 2026', '2026-01-05'],
  ['5 Sept 2026', '2026-09-05'],
  ['05 January 2026', '2026-01-05'],
  ['Jan 5 2026', '2026-01-05'],
  ['JAN 5 2026', '2026-01-05'],
  ['January 5 2026', '2026-01-05'],
  ['Sep 5 2026', '2026-09-05'],
  ['Sept 5 2026', '2026-09-05'],
  ['SEPT 5 2026', '2026-09-05'],
  ['Sept 5, 2026', '2026-09-05'],
  ['Jan 5, 26', '2026-01-05'],
  ['Sept 5, 26', '2026-09-05'],
  ['01-15-2026', '2026-01-15'],
  ['01-15-26', '2026-01-15'],
  ['1-5-2026', '2026-01-05'],
  ['12-31-2026', '2026-12-31'],
  ['Paid 2026-01-15T10:00:00Z', '2026-01-15'],
  ['2012-01-15T09:00:00', '2012-01-15'],
];
const REFUSED = ['02/30/2026', '13/01/2026', 'garbage', '05 January. 2026'];
const NEIGHBORS: Array<[string, string]> = [
  ['STORE\nDate: Jan 5, 2026\nJun 30 return deadline\nTotal $1', '2026-01-05'],
  ['STORE\nDate: Jan 5, 2026\nDec 25 holiday hours\nTotal $1', '2026-01-05'],
  ['STORE\nDate: Jan 5, 2026\nMar 12 2026 offer\nTotal $1', '2026-01-05'],
  ['Date: Jan 5, 2026\nTotal 12.34', '2026-01-05'],
  ['Date: Jan 5, 2026\nSubtotal 10.00', '2026-01-05'],
  ['Jan 5, 2026 Store 12\nTotal $12.34', '2026-01-05'],
  ['Sept 5, 2026 Reg 03\nTotal $12.34', '2026-09-05'],
  ['Note 6\nJan 2026 sale\nDate: 5 Jan 2026\n12 items\nTotal $1', '2026-01-05'],
];
const CHOSEN: Array<[string, string]> = [
  ['Dec 30, 2025\nReturns accepted until 01/29/2026\nTotal $12.34', '2025-12-30'],
  ['Dec 28, 2025\nOffer valid thru 2026-01-31\nTotal $12.34', '2025-12-28'],
  ['Check-out 12/31/2025\nFolio printed 2026-01-02\nTotal $12.34', '2025-12-31'],
  ['Return by Feb 4, 2026\nDate: Jan 5, 2026\nTotal $12.34', '2026-01-05'],
  ['Jan 5, 2026\n03/15/2026\nTotal $12.34', '2026-01-05'],
  ['Paid 2026-01-15T10:00:00Z\nTotal $12.34', '2026-01-15'],
];
const MIXED_YEARS = 'Dec 30, 2025\n01/02/2026 12:00\nTotal $12.34';
const CLOCK_NOT_YEAR = [
  '12 Sep 15:30\nTotal $12.34',
  '15 Jan 10:45\nTotal $12.34',
  'Sep 12 15:30\nTotal $12.34',
];
const ITEM_LINE: Array<[string, string]> = [
  ['Jan 15, 2026\n1 Coffee 12.50\nTotal $12.34', '2026-01-15'],
  ['1 Coffee 12.50\nJan 15, 2026\nTotal $12.34', '2026-01-15'],
];
const NUMBERED: Array<[string, string]> = [
  ['Order 10-22-4471\nJan 15, 2026\nTotal $12.34', '2026-01-15'],
  ['Order 3-12-88\nJan 15, 2026\nTotal $12.34', '2026-01-15'],
  ['Table 1/2/25\nJan 15, 2026\nTotal $12.34', '2026-01-15'],
  ['Jan 15, 2026\nexp 12/31/2027\nTotal $12.34', '2026-01-15'],
  ['Check # 4/5/26\nJan 15, 2026\nTotal $12.34', '2026-01-15'],
  ['Invoice 4/5/26\nJan 15, 2026\nTotal $12.34', '2026-04-05'],
  ['Inv 4/5/26\nJan 15, 2026\nTotal $12.34', '2026-01-15'],
  ['Ref 4/5/26\nJan 15, 2026\nTotal $12.34', '2026-01-15'],
  ['Ticket 4/5/26\nJan 15, 2026\nTotal $12.34', '2026-01-15'],
];
const NUMBERED_ALONE = [
  'Order 10-22-4471\nTotal $12.34',
  'Order 3-12-88\nTotal $12.34',
  'Table 1/2/25\nTotal $12.34',
  'exp 12/31/2027\nTotal $12.34',
];
const SKIP_STEP = 'Returns accepted until 03/01/2026\nJan 15, 2026\nTotal $12.34';
const LABEL_STEP = '03/15/2026\nDate: Jan 5, 2026\nTotal $12.34';
const CALENDAR: Array<[string, string, string]> = [
  ['Feb 4, 2026 Jan 5, 2026\nTotal $12.34', 'Feb 4, 2026', '2026-02-04'],
  ['Jan 20, 2026\nJan 3, 2026\nTotal $12.34', 'Jan 20, 2026', '2026-01-20'],
  ['Jan 20, 2026\nJan 5, 2026\nTotal $12.34', 'Jan 20, 2026', '2026-01-20'],
  ['2026-01-05\nJan 5, 2026\nTotal $12.34', '2026-01-05', '2026-01-05'],
  ['Departure 01/05/2026\nArrival 01/02/2026\nTotal $12.34', '01/05/2026', '2026-01-05'],
  ['Check-out 01/05/2026\nCheck-in 01/02/2026\nTotal $12.34', '01/05/2026', '2026-01-05'],
  ['Filled 01/09/2026\nRx written 01/02/2026\nTotal $12.34', '01/09/2026', '2026-01-09'],
  ['Departure 01/08/2026\n01/05/2026\nTotal $12.34', '01/08/2026', '2026-01-08'],
];
const SHIPPING: Array<[string, string, string]> = [
  ['Dec 30, 2025\nCoupon Expiration Date 01/31/2026\nTotal $12.34', 'Dec 30, 2025', '2025-12-30'],
  ['Departure 12/31/2025\nPrint Date 01/02/2026\nTotal $12.34', '12/31/2025', '2025-12-31'],
  ['12/30/2025\nShip Date 01/05/2026\nTotal $12.34', '12/30/2025', '2025-12-30'],
  ['12/30/2025\nEstimated Delivery Date 01/05/2026\nTotal $12.34', '12/30/2025', '2025-12-30'],
  ['12/30/2025\nCoupon Expiration: 01/31/2026\nTotal $12.34', '12/30/2025', '2025-12-30'],
  ['12/30/2025\nExchange by 01/29/2026\nTotal $12.34', '12/30/2025', '2025-12-30'],
  ['12/30/2025\nExpiring 01/05/2026\nTotal $12.34', '12/30/2025', '2025-12-30'],
  ['12/30/2025\nShipped 01/05/2026\nTotal $12.34', '12/30/2025', '2025-12-30'],
  ['12/30/2025\nDelivered 01/05/2026\nTotal $12.34', '12/30/2025', '2025-12-30'],
  ['12/30/2025\nStatement 01/05/2026\nTotal $12.34', '12/30/2025', '2025-12-30'],
  ['12/30/2025\nArrival 01/05/2026\nTotal $12.34', '12/30/2025', '2025-12-30'],
];
const NEXT_TO_DATE: Array<[string, string, string]> = [
  ['Order #4471  01/15/2026 10:42\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Table 5  Server Ann  01/15/2026 7:42 PM\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Check #1042  Jan 15, 2026\nTotal $12.34', 'Jan 15, 2026', '2026-01-15'],
  ['REF 556677  01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Ticket 0042  Date 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Ship to: Ann  01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
];
const STILL_DROPPED = [
  'Order placed 12/29/2025\nTotal $12.34',
  'exp 12/31/2027\nTotal $12.34',
  'Returns accepted until 01/29/2026\nTotal $12.34',
  'Visit by Jun 30 2026\nTotal $12.34',
  'Check #1/15/2026\nTotal $12.34',
  'Order 10-22-4471\nTotal $12.34',
  'Paid, due 01/05/2026\nTotal $12.34',
];
const TIERS: Array<[string, string, string]> = [
  ['Invoice date Jan 15, 2026\nTotal $12.34', 'Jan 15, 2026', '2026-01-15'],
  ['Invoice date 12/15/2025\nPaid 01/10/2026\nTotal $12.34', '01/10/2026', '2026-01-10'],
  ['Date: 12/31/2025\nPaid 01/02/2026\nTotal $12.34', '01/02/2026', '2026-01-02'],
  ['Date: 01/05/2026\nPaid 12/30/2025\nTotal $12.34', '12/30/2025', '2025-12-30'],
  ['Transaction Date 12/31/2025\nPayment Date 01/02/2026\nTotal $12.34', '01/02/2026', '2026-01-02'],
  ['Check-in 01/02/2026\nCheck-out 01/05/2026\nTotal $12.34', '01/05/2026', '2026-01-05'],
  ['Member since 2026-01-10\nMar 2, 2026\nTotal $12.34', 'Mar 2, 2026', '2026-03-02'],
  ['Rx written 01/02/2026\nFilled 01/09/2026\nTotal $12.34', '01/09/2026', '2026-01-09'],
];
const NO_DATE = [
  'Invoice date 12/15/2025\nDue 01/14/2026\nBalance due $400',
  'Date: 12/31/2025\nSale 01/02/2026\nTotal $12.34',
  'Sale ends 01/02/2026\n12/31/2025\nTotal $12.34',
  'Ticket 1/2\nTotal $12.34',
  'Invoice Date 01/10/2026\nPayment Due 02/01/2026\nTotal $12.34',
  'Invoice Date 01/10/2026\nPayment Method: Visa\nDue 02/01/2026\nTotal $12.34',
  'Invoice date Jan 15, 2026\nPayment due Feb 14, 2026\nTotal $12.34',
  'Delivered on 12/31/2025\nTicket 01/02/2026\nTotal $12.34',
  'Ticket 12/31/2025\nRef 01/02/2026\nTotal $12.34',
];
const VERIFIED: Array<[string, string, string]> = [
  ['Invoice Date 01/02/2026\nBalance Due $0.00\nTotal $12.34', '01/02/2026', '2026-01-02'],
  ['Invoice Date 01/02/2026\nAmount Due 0.00\nTotal $12.34', '01/02/2026', '2026-01-02'],
  ['Invoice Date 01/10/2026\nAmount Paid $50.00\nTotal $12.34', '01/10/2026', '2026-01-10'],
  ['12/27/2025\nRewards expire 1-31-26\nTotal $12.34', '12/27/2025', '2025-12-27'],
  ['12/27/2025\nPoints expire on 01/31/2026\nTotal $12.34', '12/27/2025', '2025-12-27'],
  ['December 31, 2025\nRewards expire 1-31-26\nTotal $12.34', 'December 31, 2025', '2025-12-31'],
  ['Return by 02/14/2026\nJan 15, 2026\nTotal $12.34', 'Jan 15, 2026', '2026-01-15'],
  ['Returns by 02/14/2026\nJan 15, 2026\nTotal $12.34', 'Jan 15, 2026', '2026-01-15'],
  ['12/27/2025\nRewards expired 1-31-26\nTotal $12.34', '12/27/2025', '2025-12-27'],
  ['Jan 5, 2026\nExp Date 01/31/2026\nTotal $12.34', 'Jan 5, 2026', '2026-01-05'],
  ['Jan 5, 2026\nStatement Date 01/31/2026\nTotal $12.34', 'Jan 5, 2026', '2026-01-05'],
  ['Jan 5, 2026\nArrival Date 01/31/2026\nTotal $12.34', 'Jan 5, 2026', '2026-01-05'],
  ['Jan 5, 2026\nCheck-in Date 01/31/2026\nTotal $12.34', 'Jan 5, 2026', '2026-01-05'],
  ['Jan 5, 2026\nReturn Date 01/31/2026\nTotal $12.34', 'Jan 5, 2026', '2026-01-05'],
  ['Invoice # 12345 01/20/2026\nTotal $12.34', '01/20/2026', '2026-01-20'],
  ['Invoice # 12345 01/20/2026\nBalance Due $40.00\nTotal $12.34', '01/20/2026', '2026-01-20'],
  ['Invoice # 4471 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Return Date 02/15/2026\n01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['12/30/2025\nExp Date 01/31/2026\nTotal $12.34', '12/30/2025', '2025-12-30'],
  ['12/30/2025\nCoupon expires on 01/31/2026\nTotal $12.34', '12/30/2025', '2025-12-30'],
  ['Statement Date 01/03/2026\n12/30/2025 coffee\nTotal $12.34', '12/30/2025', '2025-12-30'],
  ['Arrival Date 03/01/2026\n01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Check-in Date 03/02/2026\n01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Valid Until Date 06/30/2026\n01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Return by 02/15/2026\n01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['01/02/2026\nCheck-out Date 01/05/2026\nTotal $12.34', '01/05/2026', '2026-01-05'],
  ['Order Date 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Order Date: 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Thank you for your order on 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Your order on Jan 15, 2026\nTotal $12.34', 'Jan 15, 2026', '2026-01-15'],
  ['Thanks for your order by 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Ticket Date 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Ref Date 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Table Date 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Delivered on 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Delivery on Jan 15, 2026\nTotal $12.34', 'Jan 15, 2026', '2026-01-15'],
  ['Offer on 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Order shipped by 01/20/2026\nOrder date 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Delivered on 01/20/2026\nOrder Date 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Delivered on 01/03/2026\nOrder Date 12/30/2025\nTotal $12.34', '12/30/2025', '2025-12-30'],
  ['12/30/2025\nDelivered on 01/05/2026\nTotal $12.34', '12/30/2025', '2025-12-30'],
  ['Order Date 12/29/2025\nDelivered on 01/05/2026\nTotal $12.34', '12/29/2025', '2025-12-29'],
  ['Delivered on 01/05/2026\nTotal $12.34', '01/05/2026', '2026-01-05'],
  ['Purchased 12/20/2025\nTicket Date 01/10/2026\nTotal $12.34', '12/20/2025', '2025-12-20'],
  ['Ticket Date 12/31/2025\nPurchased 01/02/2026\nTotal $12.34', '01/02/2026', '2026-01-02'],
  ['Ticket Date 01/10/2026\n12/20/2025\nTotal $12.34', '12/20/2025', '2025-12-20'],
  ['Date: 12/31/2025\n01/02/2026\nTotal $12.34', '12/31/2025', '2025-12-31'],
  ['Ticket 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Ref 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
  ['Invoice # 01/15/2026\nTotal $12.34', '01/15/2026', '2026-01-15'],
];
const RULING: Array<[string, string]> = [
  ['Order placed 12/29/2025\nPaid Jan 2, 2026\nTotal $12.34', '2026-01-02'],
  ['Visit by Jun 30 2026\nPurchased Jan 5, 2026\nTotal $12.34', '2026-01-05'],
  ['exp 12/31/2027\nJan 5, 2026\nTotal $12.34', '2026-01-05'],
  ['Dec 30, 2025\nPaid Jan 2, 2026\nTotal $12.34', '2026-01-02'],
  ['Visit by Jun 30 2026\nJan 5, 2026\nTotal $12.34', '2026-01-05'],
];

function reference(path: string): object {
  return {
    path,
    collection: (name: string) => reference(`${path}/${name}`),
    doc: (name: string) => reference(`${path}/${name}`),
    create: (data: unknown) => mocks.receiptCreate(path, data),
    delete: () => mocks.receiptDelete(path),
  };
}
function receiptText(line: string) {
  return `SYNTHETIC OFFICE STORE\n${line}\nOffice supplies $25.00\nTOTAL $25.00\nTEST RECEIPT - NO PURCHASE`;
}
function streetReceipt(input: string) {
  return `STORE NAME\n123 Main St\nDate: ${input}\nTotal $12.34`;
}
function recognized(line: string) {
  worker.recognize.mockResolvedValue({ data: { text: receiptText(line), confidence: 95 } });
}
function request(uploadTimeZone?: string) {
  const body = new FormData();
  body.append('file', new File([PNG], 'receipt.png', { type: 'image/png' }));
  if (uploadTimeZone !== undefined) body.append('uploadTimeZone', uploadTimeZone);
  return new NextRequest('https://staging.example/api/receipts/process', { method: 'POST', body });
}
async function saveInstant(instant: Date | number, uploadTimeZone?: string) {
  const processor = receiptProcessor as unknown as {
    parseReceiptText(text: string): { merchant: string; amount: number; date: Date | number; category: string; items: [] };
  };
  const original = processor.parseReceiptText;
  processor.parseReceiptText = () => ({
    merchant: 'SYNTHETIC OFFICE STORE', amount: 12.34, date: instant, category: 'other', items: [],
  });
  try {
    worker.recognize.mockResolvedValue({ data: { text: 'synthetic', confidence: 95 } });
    const response = await POST(request(uploadTimeZone));
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as {
      amount: number; date: string; deductionStatus?: string; tax_review_required?: boolean; uploadTimeZone?: string;
      year?: unknown; taxYear?: unknown; tax_year?: unknown;
    } | undefined;
    return { response, saved };
  } finally {
    processor.parseReceiptText = original;
  }
}
async function expectUndatedReceipt(text: string, amount?: number) {
  worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
  const response = await POST(request());
  expect(response.status).toBe(200);
  const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as {
    amount: number; date: string; deductionStatus?: string; tax_review_required?: boolean;
    year?: unknown; taxYear?: unknown; tax_year?: unknown;
  };
  expect(saved.date).toBe('');
  expect(saved.deductionStatus).toBe('Needs more information');
  expect(saved.tax_review_required).toBe(true);
  expect(saved.year).toBeUndefined();
  expect(saved.taxYear).toBeUndefined();
  expect(saved.tax_year).toBeUndefined();
  expect(Number.isFinite(saved.amount) && saved.amount > 0).toBe(true);
  if (amount !== undefined) expect(saved.amount).toBe(amount);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  expect(JSON.stringify(saved)).not.toContain(today);
  const body = await response.json();
  expect(body.transaction.date).toBe('');
  expect(body.transaction.amount).toBe(saved.amount);
  expect(body.transaction.deductionStatus).toBe('Needs more information');
  expect(body.transaction.year).toBeUndefined();
}

beforeEach(() => {
  resetRateLimitStore();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'demo-receipts.appspot.com');
  mocks.auth.mockResolvedValue({ user: { uid: owner }, error: null });
  mocks.collection.mockImplementation((name: string) => reference(name));
  mocks.bucket.mockReturnValue({ file: mocks.storageFile });
  mocks.storageFile.mockReturnValue({ save: mocks.storageSave, delete: mocks.storageDelete });
  mocks.storageSave.mockResolvedValue(undefined);
  mocks.storageDelete.mockResolvedValue(undefined);
  mocks.receiptCreate.mockResolvedValue(undefined);
  mocks.receiptDelete.mockResolvedValue(undefined);
  mocks.accountGet.mockResolvedValue({ exists: false });
  mocks.runTransaction.mockImplementation(async callback => callback({ get: mocks.accountGet, create: mocks.accountCreate }));
  mocks.createTransaction.mockImplementation(async (_uid, accountId, data) => ({ data: { ...data, userId: owner, account_id: accountId }, error: null }));
  mocks.getTransactions.mockResolvedValue({ data: [], error: null });
});
afterEach(async () => {
  await receiptProcessor.terminate();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('written receipt dates are read by parts', () => {
  it.each(KEPT)('normalizes %s to %s', (input, iso) => {
    expect(normalizeDateToISO(input)).toBe(iso);
  });

  it.each(['02/30/2026', '13/01/2026', 'garbage', '', '2026-01-15abc', '2026-01-15T25:00:00', '02-30-2026', '05 January. 2026', 'January. 5, 2026'])('normalizes %s to null', input => {
    expect(normalizeDateToISO(input)).toBeNull();
  });

  it('keeps the written day of an offset timestamp', () => {
    expect(normalizeDateToISO('2026-01-15T23:30:00-08:00')).toBe('2026-01-15');
  });

  it('reads a leading four digit year as ISO, not as a hyphen month', () => {
    expect(normalizeDateToISO('2026-01-15')).toBe('2026-01-15');
    expect(normalizeDateToISO('2012-01-15')).toBe('2012-01-15');
    expect(normalizeDateToISO('12-01-15')).toBe('2015-12-01');
  });

  it('keeps Jan 1, 2026 when a Tokyo Date parse would move it to the previous year', () => {
    expect(normalizeDateToISO('Jan 1, 2026')).toBe('2026-01-01');
    if (process.env.TZ === 'Asia/Tokyo') {
      expect(new Date('Jan 1, 2026').toISOString().slice(0, 10)).toBe('2025-12-31');
    }
  });

  it.each(ISO_TIMESTAMPS)('keeps the ISO day for %s', async (line, extracted, iso) => {
    expect(extractDate(receiptText(line))).toBe(extracted);
    expect(normalizeDateToISO(extracted)).toBe(iso);
    recognized(line);
    const result = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ merchant: 'SYNTHETIC OFFICE STORE', amount: 25, date: iso });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      merchant_name: 'SYNTHETIC OFFICE STORE', amount: 25, date: iso,
    }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(KEPT)('reads %s from OCR as %s', async (input, iso) => {
    recognized(input);
    const result = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ merchant: 'SYNTHETIC OFFICE STORE', amount: 25, date: iso });
  });

  it.each(REFUSED)('leaves OCR text %s without a date', async input => {
    recognized(input);
    const result = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(result.success).toBe(true);
    expect(result.data?.date).toBe('');
  });

  it('leaves a receipt with no date blank instead of using today', async () => {
    worker.recognize.mockResolvedValue({ data: {
      text: 'SYNTHETIC OFFICE STORE\nOffice supplies $25.00\nTOTAL $25.00',
      confidence: 95,
    } });
    const result = await receiptProcessor.processReceipt(Buffer.from('synthetic input'));
    expect(result.data?.date).toBe('');
  });
});

describe('OCR save uses the printed calendar day', () => {
  it.each(KEPT)('saves %s as %s', async (input, iso) => {
    recognized(input);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      merchant_name: 'SYNTHETIC OFFICE STORE', amount: 25, date: iso,
    }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(NEIGHBORS)('saves the printed day from OCR text %j', async (text, iso) => {
    const extracted = extractDate(text);
    expect(text.includes(extracted)).toBe(true);
    expect(normalizeDateToISO(extracted)).toBe(iso);
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({ date: iso }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(CHOSEN)('saves the purchase date from OCR text %j', async (text, iso) => {
    const extracted = extractDate(text);
    expect(extracted.length).toBeGreaterThan(0);
    expect(text.includes(extracted)).toBe(true);
    expect(normalizeDateToISO(extracted)).toBe(iso);
    if (text.includes('2026-01-15T10:00:00Z')) expect(extracted).toBe('2026-01-15T10:00:00Z');
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({ date: iso }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it('leaves two unlabeled dates from different years for the user to enter', async () => {
    expect(extractDate(MIXED_YEARS)).toBe('');
    await expectUndatedReceipt(MIXED_YEARS, 12.34);
  });

  it.each(CLOCK_NOT_YEAR)('does not save a clock time as the year from %j', async text => {
    expect(extractDate(text)).toBe('');
    await expectUndatedReceipt(text, 12.34);
  });

  it.each(ITEM_LINE)('keeps Jan 15, 2026 when an item line is present in %j', async (text, iso) => {
    const extracted = extractDate(text);
    expect(text.includes(extracted)).toBe(true);
    expect(normalizeDateToISO(extracted)).toBe(iso);
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({ date: iso }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(NUMBERED)('saves the real date from %j', async (text, iso) => {
    const extracted = extractDate(text);
    expect(text.includes(extracted)).toBe(true);
    expect(normalizeDateToISO(extracted)).toBe(iso);
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({ date: iso }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(NUMBERED_ALONE)('saves no date from %j', async text => {
    expect(extractDate(text)).toBe('');
    await expectUndatedReceipt(text, 12.34);
  });

  it('skip words drop a return line and keep the purchase day', async () => {
    const extracted = extractDate(SKIP_STEP);
    expect(normalizeDateToISO(extracted)).toBe('2026-01-15');
    worker.recognize.mockResolvedValue({ data: { text: SKIP_STEP, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).transaction.date).toBe('2026-01-15');
  });

  it('a purchase label beats an earlier unlabeled date in the same year', async () => {
    const extracted = extractDate(LABEL_STEP);
    expect(extracted).toBe('Jan 5, 2026');
    expect(normalizeDateToISO(extracted)).toBe('2026-01-05');
    worker.recognize.mockResolvedValue({ data: { text: LABEL_STEP, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).transaction.date).toBe('2026-01-05');
  });

  it.each(NEXT_TO_DATE)('keeps a date that is not beside the skip phrase in %j', async (text, raw, iso) => {
    const extracted = extractDate(text);
    expect(extracted).toBe(raw);
    expect(normalizeDateToISO(extracted)).toBe(iso);
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({ date: iso }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(STILL_DROPPED)('drops a date that sits next to a skip phrase in %j', async text => {
    expect(extractDate(text)).toBe('');
    await expectUndatedReceipt(text, 12.34);
  });

  it.each(TIERS)('keeps the highest purchase tier in %j', async (text, raw, iso) => {
    const extracted = extractDate(text);
    expect(extracted).toBe(raw);
    expect(normalizeDateToISO(extracted)).toBe(iso);
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({ date: iso }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(NO_DATE)('saves no date for %j', async text => {
    expect(extractDate(text)).toBe('');
    await expectUndatedReceipt(text);
  });

  it.each(VERIFIED)('keeps the purchase day in %j', async (text, raw, iso) => {
    const extracted = extractDate(text);
    expect(extracted).toBe(raw);
    expect(normalizeDateToISO(extracted)).toBe(iso);
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({ date: iso }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(SHIPPING)('keeps the purchase day and skips the later line in %j', async (text, raw, iso) => {
    const extracted = extractDate(text);
    expect(extracted).toBe(raw);
    expect(normalizeDateToISO(extracted)).toBe(iso);
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({ date: iso }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(CALENDAR)('saves the first printed date from %j', async (text, raw, iso) => {
    const extracted = extractDate(text);
    expect(extracted).toBe(raw);
    expect(normalizeDateToISO(extracted)).toBe(iso);
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({ date: iso }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(RULING)('saves the paid or purchased day from %j', async (text, iso) => {
    const extracted = extractDate(text);
    expect(text.includes(extracted)).toBe(true);
    expect(normalizeDateToISO(extracted)).toBe(iso);
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({ date: iso }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(STREET)('saves the printed day for %s from a street receipt', async (input, iso) => {
    const text = streetReceipt(input);
    const extracted = extractDate(text);
    expect(text.includes(extracted)).toBe(true);
    expect(normalizeDateToISO(extracted)).toBe(iso);
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      merchant_name: 'STORE NAME', amount: 12.34, date: iso,
    }));
    expect((await response.json()).transaction.date).toBe(iso);
  });

  it.each(REFUSED)('saves OCR text %s with no readable date', async input => {
    expect(extractDate(receiptText(input))).toBe('');
    await expectUndatedReceipt(receiptText(input), 25);
  });

  it('saves a Los Angeles upload at 2027-01-01T07:30:00Z as 2026-12-31', async () => {
    const instant = new Date('2027-01-01T07:30:00Z');
    expect(normalizeDateToISO(instant, 'America/Los_Angeles')).toBe('2026-12-31');
    expect(normalizeDateToISO(instant, 'UTC')).toBe('2027-01-01');
    const dated = await saveInstant(instant, 'America/Los_Angeles');
    expect(dated.response.status).toBe(200);
    expect(dated.saved).toMatchObject({ date: '2026-12-31', uploadTimeZone: 'America/Los_Angeles', amount: 12.34 });
    expect(dated.saved?.deductionStatus).toBeUndefined();
    const numbered = await saveInstant(instant.getTime(), 'America/Los_Angeles');
    expect(numbered.saved?.date).toBe('2026-12-31');
    expect(numbered.saved?.uploadTimeZone).toBe('America/Los_Angeles');
  });

  it('keeps a no-zone row at 18:00Z on the shared calendar day', async () => {
    const instant = new Date('2027-01-01T18:00:00Z');
    expect(normalizeDateToISO(instant)).toBe('2027-01-01');
    const dated = await saveInstant(instant);
    expect(dated.response.status).toBe(200);
    expect(dated.saved).toMatchObject({ date: '2027-01-01', amount: 12.34 });
    expect(dated.saved?.uploadTimeZone).toBeUndefined();
    expect(dated.saved?.deductionStatus).toBeUndefined();
    const invalid = await saveInstant(instant.getTime(), 'Not/AZone');
    expect(invalid.saved?.date).toBe('2027-01-01');
    expect(invalid.saved?.uploadTimeZone).toBeUndefined();
  });

  it('does not store est and saves 2026-07-15T04:30Z in Needs more information', async () => {
    const instant = new Date('2026-07-15T04:30:00Z');
    expect(normalizeDateToISO(instant, 'est')).toBeNull();
    expect(normalizeDateToISO(instant, 'America/New_York')).toBe('2026-07-15');
    const rejected = await saveInstant(instant, 'est');
    expect(rejected.response.status).toBe(200);
    expect(rejected.saved?.date).toBe('');
    expect(rejected.saved?.uploadTimeZone).toBeUndefined();
    expect(rejected.saved?.deductionStatus).toBe('Needs more information');
    expect(rejected.saved?.tax_review_required).toBe(true);
    const eastern = await saveInstant(instant, 'America/New_York');
    expect(eastern.response.status).toBe(200);
    expect(eastern.saved).toMatchObject({ date: '2026-07-15', uploadTimeZone: 'America/New_York', amount: 12.34 });
    expect(eastern.saved?.deductionStatus).toBeUndefined();
  });

  it('does not store est and saves 2026-06-01T04:30Z in Needs more information', async () => {
    const instant = new Date('2026-06-01T04:30:00Z');
    expect(normalizeDateToISO(instant, 'est')).toBeNull();
    expect(normalizeDateToISO(instant, 'America/New_York')).toBe('2026-06-01');
    const rejected = await saveInstant(instant, 'est');
    expect(rejected.response.status).toBe(200);
    expect(rejected.saved?.date).toBe('');
    expect(rejected.saved?.uploadTimeZone).toBeUndefined();
    expect(rejected.saved?.deductionStatus).toBe('Needs more information');
    const eastern = await saveInstant(instant, 'America/New_York');
    expect(eastern.saved).toMatchObject({ date: '2026-06-01', uploadTimeZone: 'America/New_York' });
  });

  it('saves a no-zone row at 05:00Z in Needs more information', async () => {
    const instant = new Date('2027-01-01T05:00:00Z');
    expect(normalizeDateToISO(instant)).toBeNull();
    expect(normalizeDateToISO(instant.getTime())).toBeNull();
    const dated = await saveInstant(instant);
    expect(dated.response.status).toBe(200);
    expect(dated.saved?.date).toBe('');
    expect(dated.saved?.deductionStatus).toBe('Needs more information');
    expect(dated.saved?.tax_review_required).toBe(true);
    expect(dated.saved?.uploadTimeZone).toBeUndefined();
    expect(dated.saved?.year).toBeUndefined();
    expect(dated.saved?.taxYear).toBeUndefined();
    expect(dated.saved?.tax_year).toBeUndefined();
    expect(dated.saved?.amount).toBe(12.34);
    const numbered = await saveInstant(instant.getTime(), 'Not/AZone');
    expect(numbered.saved?.date).toBe('');
    expect(numbered.saved?.deductionStatus).toBe('Needs more information');
    expect(numbered.saved?.uploadTimeZone).toBeUndefined();
  });

  it('stores the upload zone without changing a printed date', async () => {
    const text = 'SYNTHETIC OFFICE STORE\n01/15/2026\nTotal $12.34';
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request('America/Los_Angeles'));
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      date: '2026-01-15', uploadTimeZone: 'America/Los_Angeles',
    }));
  });

  it('saves a receipt that has no date', async () => {
    const text = 'SYNTHETIC OFFICE STORE\nOffice supplies $25.00\nTOTAL $25.00';
    expect(extractDate(text)).toBe('');
    await expectUndatedReceipt(text, 25);
  });

  it('keeps the 2026 purchase date when the receipt says RETURN BY 12/31/2026', async () => {
    const text = 'SYNTHETIC OFFICE STORE\nRETURN BY 12/31/2026\nPurchased 06/15/2026\nTotal $12.34';
    const extracted = extractDate(text);
    expect(extracted).toBe('06/15/2026');
    expect(normalizeDateToISO(extracted)).toBe('2026-06-15');
    expect(normalizeDateToISO('12/31/2026')).toBe('2026-12-31');
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      amount: 12.34, date: '2026-06-15',
    }));
    const saved = mocks.createTransaction.mock.calls.at(-1)?.[2] as { date: string };
    expect(saved.date).not.toBe('2026-12-31');
    expect((await response.json()).transaction.date).toBe('2026-06-15');
  });

  it('saves 01/01/2027 as 2027-01-01', async () => {
    const text = 'SYNTHETIC OFFICE STORE\n01/01/2027\nTotal $12.34';
    const extracted = extractDate(text);
    expect(extracted).toBe('01/01/2027');
    expect(normalizeDateToISO(extracted)).toBe('2027-01-01');
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      amount: 12.34, date: '2027-01-01',
    }));
    expect((await response.json()).transaction.date).toBe('2027-01-01');
  });

  it('saves 12/31/2026 as 2026-12-31', async () => {
    const text = 'SYNTHETIC OFFICE STORE\n12/31/2026\nTotal $12.34';
    const extracted = extractDate(text);
    expect(extracted).toBe('12/31/2026');
    expect(normalizeDateToISO(extracted)).toBe('2026-12-31');
    worker.recognize.mockResolvedValue({ data: { text, confidence: 95 } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.createTransaction).toHaveBeenCalledWith(owner, 'manual', expect.objectContaining({
      amount: 12.34, date: '2026-12-31',
    }));
    expect((await response.json()).transaction.date).toBe('2026-12-31');
  });
});
