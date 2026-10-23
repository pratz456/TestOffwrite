import { describe, expect, it } from 'vitest';
import { categoryScheduleCLine, composeExplanation, type ExplainableResult } from '@/lib/ai/explanation';
import { PLAID_CATEGORY_MAP } from '@/lib/ai/merchant-intelligence';
import { buildEvidenceRecord } from '@/lib/reports/audit-support-packet';
import { generateScheduleCCSV } from '@/lib/reports/schedule-c-csv';
import { taxExportBlockReason } from '@/lib/reports/tax-export-transactions';
import { convertTransactionsToCSV } from '@/lib/reports/transaction-export';
import { aggregateScheduleC, CATEGORY_MAP, type ScheduleCTransactionLike } from '@/lib/schedule-c/aggregate';
import { BUSINESS_SHARE_ONLY_NOTE } from '@/lib/schedule-c/category-rules';
import { scheduleCExportLine } from '@/lib/schedule-c/export-lines';

type Row = ScheduleCTransactionLike & { [key: string]: unknown };

function charge(fields: Record<string, unknown>): Row {
  return {
    amount: 50,
    date: '2025-06-15',
    category: 'SERVICE_ADVERTISING',
    is_deductible: true,
    review_status: 'confirmed',
    tax_review_required: false,
    merchant_name: 'Synthetic merchant',
    ...fields,
  } as Row;
}

function totals(rows: Row[], year = '2025', fuelProfile?: Record<string, unknown> | null) {
  return aggregateScheduleC(rows, year, CATEGORY_MAP, { mode: 'confirmed-only', fuelProfile: fuelProfile ?? null });
}

const cents = (dollars: number) => Math.round(dollars * 100);
const actual = { vehicle_deduction_method: 'actual_expense' as const, vehicle_business_use_percentage: 60 };
const standard = { vehicle_deduction_method: 'standard_mileage' as const, vehicle_business_use_percentage: 60 };

describe('alias head meals, groceries and entertainment', () => {
  it('counts meals_50, coffee and beer and wine on 24b at 50 percent', () => {
    for (const category of ['meals_50', 'FOOD_AND_DRINK_COFFEE', 'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR', 'Food & Drink']) {
      const res = totals([charge({ category, amount: 80, id: category })]);
      expect(cents(res.lineItems['24b']?.deductible ?? -1)).toBe(4000);
      expect(res.totalDeductible).toBe(40);
      expect(res.needsMoreInformation).toEqual([]);
    }
  });

  it('counts each entertainment value at zero', () => {
    const categories = [
      'ENTERTAINMENT_CASINOS_AND_GAMBLING', 'ENTERTAINMENT_MUSIC_AND_AUDIO',
      'ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS', 'ENTERTAINMENT_TV_AND_MOVIES',
      'ENTERTAINMENT_VIDEO_GAMES', 'ENTERTAINMENT_OTHER_ENTERTAINMENT', 'Entertainment',
      'ENTERTAINMENT_MUSIC', 'ENTERTAINMENT_MOVIES_AND_DVDS',
    ];
    const res = totals(categories.map(category => charge({ category, amount: 40, id: category })));
    expect(res.totalDeductible).toBe(0);
    expect(res.totalExpenses).toBe(0);
    expect(res.lineItemsArray).toEqual([]);
    expect(res.needsMoreInformation).toEqual([]);
  });

  it('counts a default grocery charge at zero and a business-marked grocery as needs more information', () => {
    const plain = totals([charge({ category: 'FOOD_AND_DRINK_GROCERIES', amount: 64 })]);
    expect(plain.totalDeductible).toBe(0);
    expect(plain.lineItems['24b']).toBeUndefined();
    expect(plain.needsMoreInformation).toEqual([]);
    const marked = totals([charge({ category: 'FOOD_AND_DRINK_GROCERIES', amount: 64, business_purpose: 'Client tasting' })]);
    expect(marked.totalDeductible).toBe(0);
    expect(marked.lineItems['24b']).toBeUndefined();
    expect(marked.needsMoreInformation).toHaveLength(1);
  });
});

describe('alias head transfers, loans and inflows', () => {
  it('adds nothing for a confirmed transfer or confirmed income under a deductible category', () => {
    const transfer = totals([charge({ amount: 80, transaction_kind: 'transfer', category: 'SERVICE_ADVERTISING' })]);
    expect(transfer.totalDeductible).toBe(0);
    expect(transfer.lineItemsArray).toEqual([]);
    const income = totals([charge({ amount: 80, transaction_kind: 'income', category: 'SERVICE_ADVERTISING' })]);
    expect(income.totalDeductible).toBe(0);
    expect(income.lineItemsArray).toEqual([]);
  });

  it('nets a tied refund on its purchase line and lists an untied refund without changing totals', () => {
    const tied = totals([
      charge({ id: 'ad', amount: 100, date: '2025-03-01', merchant_name: 'Print shop', category: 'SERVICE_ADVERTISING' }),
      charge({ id: 'back', amount: -40, date: '2025-04-01', merchant_name: 'Print shop', category: 'SERVICE_ADVERTISING' }),
    ]);
    expect(tied.totalDeductible).toBe(60);
    expect(tied.lineItems['8']?.deductible).toBe(60);
    expect(tied.possibleRefunds).toEqual([]);
    expect(tied.refundNotice).toBeNull();
    const untied = totals([
      charge({ id: 'ad', amount: 100, date: '2025-03-01', merchant_name: 'Print shop', category: 'SERVICE_ADVERTISING' }),
      charge({ id: 'back', amount: -40, date: '2025-04-01', merchant_name: 'Other shop', category: 'SERVICE_ADVERTISING' }),
    ]);
    expect(untied.totalDeductible).toBe(100);
    expect(untied.possibleRefunds).toEqual([{ amount: 40, merchant: 'Other shop', date: '2025-04-01', category: 'SERVICE_ADVERTISING' }]);
    expect(untied.refundNotice).toContain('These totals do not subtract $40.00 in possible refunds.');
    expect(untied.refundNotice).toContain('A refund of a deducted purchase must reduce that expense.');
    expect(untied.refundNotice).toContain('awaiting copy approval');
  });

  it('leaves 2025 unchanged when the same merchant refunds in 2026', () => {
    const rows = [
      charge({ id: 'ad', amount: 100, date: '2025-12-01', merchant_name: 'Print shop', category: 'SERVICE_ADVERTISING' }),
      charge({ id: 'back', amount: -100, date: '2026-01-15', merchant_name: 'Print shop', category: 'SERVICE_ADVERTISING' }),
    ];
    const year2025 = totals(rows, '2025');
    expect(year2025.totalDeductible).toBe(100);
    expect(year2025.possibleRefunds).toEqual([]);
    const year2026 = totals(rows, '2026');
    expect(year2026.totalDeductible).toBe(0);
    expect(year2026.needsMoreInformation.map(row => row.id)).toEqual(['back']);
    expect(year2026.possibleRefunds).toEqual([{ amount: 100, merchant: 'Print shop', date: '2026-01-15', category: 'SERVICE_ADVERTISING' }]);
  });

  it('nets a $300 printer bought and returned in 2026 to $0 on its line', () => {
    const res = totals([
      charge({ id: 'printer', amount: 300, date: '2026-03-02', merchant_name: 'Printer store', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }),
      charge({ id: 'return', amount: -300, date: '2026-04-01', merchant_name: 'Printer store', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }),
    ], '2026');
    expect(res.lineItems['22']?.total).toBe(0);
    expect(res.lineItems['22']?.deductible).toBe(0);
    expect(res.totalDeductible).toBe(0);
    expect(res.totalExpenses).toBe(0);
    expect(res.possibleRefunds).toEqual([]);
    expect(res.needsMoreInformation).toEqual([]);
  });

  it('adds $0 for a $300 return with no matching purchase and lists it as a possible refund', () => {
    const res = totals([
      charge({ id: 'return', amount: -300, date: '2026-04-01', merchant_name: 'Printer store', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }),
    ], '2026');
    expect(res.totalDeductible).toBe(0);
    expect(res.totalExpenses).toBe(0);
    expect(res.lineItems['22']).toBeUndefined();
    expect(res.needsMoreInformation.map(row => row.id)).toEqual(['return']);
    expect(res.possibleRefunds).toEqual([{ amount: 300, merchant: 'Printer store', date: '2026-04-01', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }]);
  });

  it('caps a refund at that merchant\'s tied charges and keeps every line at $0 or above', () => {
    const over = totals([
      charge({ id: 'printer', amount: 300, date: '2026-03-02', merchant_name: 'Printer store', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }),
      charge({ id: 'return', amount: -400, date: '2026-04-01', merchant_name: 'Printer store', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }),
    ], '2026');
    expect(over.lineItems['22']?.total).toBe(0);
    expect(over.lineItems['22']?.deductible).toBe(0);
    expect(over.totalDeductible).toBe(0);
    expect(over.possibleRefunds).toEqual([{ amount: 100, merchant: 'Printer store', date: '2026-04-01', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }]);

    const shared = totals([
      charge({ id: 'printer', amount: 300, date: '2026-03-02', merchant_name: 'Printer store', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }),
      charge({ id: 'paper', amount: 100, date: '2026-03-03', merchant_name: 'Paper shop', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }),
      charge({ id: 'return', amount: -400, date: '2026-04-01', merchant_name: 'Printer store', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }),
    ], '2026');
    expect(shared.lineItems['22']?.total).toBe(100);
    expect(shared.lineItems['22']?.deductible).toBe(100);
    expect(shared.totalDeductible).toBe(100);
    expect(shared.possibleRefunds).toEqual([{ amount: 100, merchant: 'Printer store', date: '2026-04-01', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }]);

    const split = totals([
      charge({ id: 'a', amount: 100, date: '2026-03-02', merchant_name: 'Printer store', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }),
      charge({ id: 'b', amount: 200, date: '2026-03-04', merchant_name: 'Printer store', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }),
      charge({ id: 'return', amount: -300, date: '2026-04-01', merchant_name: 'Printer store', category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES' }),
    ], '2026');
    expect(split.lineItems['22']?.total).toBe(0);
    expect(split.lineItems['22']?.deductible).toBe(0);
    expect(split.possibleRefunds).toEqual([]);
  });

  it('routes savings to zero, an unnamed transfer to needs more information, and a contractor pick to line 11', () => {
    expect(totals([charge({ category: 'TRANSFER_OUT_SAVINGS', amount: 200 })]).totalDeductible).toBe(0);
    const unnamed = totals([charge({ category: 'TRANSFER_OUT_OTHER_TRANSFER_OUT', amount: 75 })]);
    expect(unnamed.totalDeductible).toBe(0);
    expect(unnamed.needsMoreInformation).toHaveLength(1);
    expect(unnamed.lineItems['27a']).toBeUndefined();
    const contractor = totals([charge({ category: 'TRANSFER_OUT_OTHER_TRANSFER_OUT', amount: 75, notes: 'Paid the contractor' })]);
    expect(contractor.lineItems['11']?.deductible).toBe(75);
    const account = totals([charge({ category: 'TRANSFER_OUT_ACCOUNT_TRANSFER', amount: 75 })]);
    expect(account.needsMoreInformation).toHaveLength(1);
    expect(account.totalDeductible).toBe(0);
  });

  it('keeps card payments and student loans at zero and car payments off line 9', () => {
    expect(totals([charge({ category: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', amount: 400 })]).totalDeductible).toBe(0);
    expect(totals([charge({ category: 'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT', amount: 250 })]).totalDeductible).toBe(0);
    const car = totals([charge({ category: 'LOAN_PAYMENTS_CAR_PAYMENT', amount: 450 })]);
    expect(car.lineItems['9']).toBeUndefined();
    expect(car.needsMoreInformation).toHaveLength(1);
    expect(totals([charge({ category: 'LOAN_PAYMENTS_MORTGAGE_PAYMENT', amount: 900 })]).needsMoreInformation).toHaveLength(1);
    expect(PLAID_CATEGORY_MAP.find(item => item.detailed === 'LOAN_PAYMENTS_CAR_PAYMENT')?.scheduleCLine).toBeNull();
  });
});

describe('alias head fuel', () => {
  const gas = (amount: number, extra: Record<string, unknown> = {}) => charge({ category: 'TRANSPORTATION_GAS', amount, merchant_name: 'Pump', ...extra });

  it('puts actual-expense fuel on line 9, standard mileage at zero, and missing or disagreeing methods in needs more information', () => {
    expect(totals([gas(50)], '2025', actual).lineItems['9']?.deductible).toBe(30);
    expect(totals([gas(50)], '2025', standard).totalDeductible).toBe(0);
    expect(totals([gas(50)], '2025', standard).needsMoreInformation).toEqual([]);
    expect(totals([gas(50)]).needsMoreInformation).toHaveLength(1);
    expect(totals([gas(50)], '2025', { vehicle_deduction_method: 'actual_expense', business_vehicle: { deduction_method: 'standard_mileage' } }).needsMoreInformation).toHaveLength(1);
    expect(totals([gas(50)], '2025', { ...actual, vehicleCount: 2 }).needsMoreInformation).toHaveLength(1);
    for (const category of ['TRANSPORTATION_PARKING', 'TRANSPORTATION_TOLLS']) {
      expect(totals([charge({ category, amount: 12 })], '2025', standard).lineItems['9']?.deductible).toBe(12);
      expect(totals([charge({ category, amount: 12 })], '2025', actual).lineItems['9']?.deductible).toBe(12);
    }
    expect(totals([charge({ category: 'gas', amount: 20 })], '2025', actual).needsMoreInformation).toHaveLength(1);
  });

  it('applies 60 percent once to the yearly fuel total and shows that percentage', () => {
    const rows = [50, 50, 50, 50].map((amount, index) => gas(amount, { id: `g${index}`, date: '2025-04-02' }));
    const res = totals(rows, '2025', actual);
    expect(res.lineItems['9']?.deductible).toBe(120);
    expect(res.fuelSummaries[0]).toMatchObject({ total: 200, percentage: 60, businessShare: 120, vehicleKey: 'vehicle' });
    const odd = totals([10.01, 10.01, 10.01].map((amount, index) => gas(amount, { id: `o${index}` })), '2025', actual);
    expect(cents(odd.lineItems['9']?.deductible ?? 0)).toBe(1802);
    const csv = generateScheduleCCSV(res.lineItemsArray, 2025, res.needsMoreInformation, { fuelSummaries: res.fuelSummaries, exportNotes: res.exportNotes });
    expect(csv).toContain('60%');
    expect(csv).toContain('Included in the fuel summary');
    const lines = csv.split('\r\n').slice(1);
    const amountOf = (line: string) => Number(line.split(',')[4]);
    const kept = lines.filter(line => !line.includes('Included in the fuel summary'));
    const summed = kept.reduce((sum, line) => sum + amountOf(line), 0);
    expect(cents(summed)).toBe(cents(res.totalExpenses));
  });

  it('uses the confirmed amount and the business-share note when the vehicle percentage is missing or the two fields disagree', () => {
    const missing = totals([gas(50)], '2025', { vehicle_deduction_method: 'actual_expense' });
    expect(missing.lineItems['9']?.deductible).toBe(50);
    expect(missing.exportNotes).toContain(BUSINESS_SHARE_ONLY_NOTE);
    expect(missing.fuelSummaries[0]?.percentage).toBeNull();
    const disagree = totals([gas(50)], '2025', {
      vehicle_deduction_method: 'actual_expense',
      vehicle_business_use_percentage: 60,
      business_vehicle: { deduction_method: 'actual_expense', business_use_percentage: 40 },
    });
    expect(disagree.lineItems['9']?.deductible).toBe(50);
    expect(disagree.exportNotes).toContain(BUSINESS_SHARE_ONLY_NOTE);
  });

  it('ignores a charge percentage copied from the account and does not block the fuel export', () => {
    const res = totals([gas(50, { business_use_percentage: 50, businessUsePercent: 50 })], '2025', { vehicle_deduction_method: 'actual_expense' });
    expect(res.lineItems['9']?.deductible).toBe(50);
    expect(res.exportNotes).toContain(BUSINESS_SHARE_ONLY_NOTE);
    expect(taxExportBlockReason({ category: 'TRANSPORTATION_GAS', is_deductible: true, business_use_percentage: 50 })).toBeNull();
    expect(taxExportBlockReason({ category: 'TRANSPORTATION_FUEL', is_deductible: true, business_use_percentage: 40 })).toBeNull();
    const blocked = taxExportBlockReason({ category: 'GENERAL_MERCHANDISE_OFFICE_SUPPLIES', is_deductible: true, business_use_percentage: 50 });
    expect(blocked).toContain('business-use percentage');
  });

  it('follows the same branches for manual fuel and sends automotive charges over 2500 to needs more information', () => {
    expect(totals([charge({ category: 'TRANSPORTATION_FUEL', amount: 80 })], '2025', standard).totalDeductible).toBe(0);
    expect(totals([charge({ category: 'TRANSPORTATION_FUEL', amount: 80 })], '2025', actual).lineItems['9']?.deductible).toBe(48);
    expect(totals([charge({ category: 'GENERAL_SERVICES_AUTOMOTIVE', amount: 2500.01 })], '2025', actual).needsMoreInformation).toHaveLength(1);
    expect(totals([charge({ category: 'GENERAL_SERVICES_AUTOMOTIVE', amount: 80 })], '2025', standard).totalDeductible).toBe(0);
  });
});

describe('alias head bank fees, caps and ruled lines', () => {
  it('puts a business late fee on 16b and a personal late fee at zero', () => {
    const business = totals([charge({ category: 'BANK_FEES_LATE_FEES', amount: 29, date: '2025-07-10', notes: 'Business loan paid from business checking' })]);
    expect(business.lineItems['16b']?.deductible).toBe(29);
    expect(business.lineItems['27a']).toBeUndefined();
    const personal = totals([charge({ category: 'BANK_FEES_LATE_FEES', amount: 29, notes: 'personal' })]);
    expect(personal.totalDeductible).toBe(0);
    expect(personal.needsMoreInformation).toEqual([]);
  });

  it('prints plain bank fees on Part V by year and keeps them off line 10', () => {
    const overdraft = totals([charge({ category: 'BANK_FEES_OVERDRAFT_FEES', amount: 35, date: '2024-03-05' })], '2024');
    expect(overdraft.lineItems['27a']?.deductible).toBe(35);
    expect(overdraft.lineItems['10']).toBeUndefined();
    expect(scheduleCExportLine('27a', 2024)).toBe('27a');
    const foreign = totals([charge({
      category: 'BANK_FEES_FOREIGN_TRANSACTION_FEES', amount: 2.4, date: '2025-05-02', account_type: 'credit', payoff_confirmed_on: '2025-05-28',
    })]);
    expect(foreign.lineItems['27a']?.deductible).toBe(2.4);
    expect(foreign.lineItems['10']).toBeUndefined();
    expect(scheduleCExportLine('27a', 2025)).toBe('27b');
    expect(CATEGORY_MAP).not.toHaveProperty('BANK_FEES_FOREIGN_TRANSACTION');
    expect(CATEGORY_MAP).not.toHaveProperty('BANK_FEES_OVERDRAFT');
    expect(PLAID_CATEGORY_MAP.some(item => item.detailed === 'BANK_FEES_FOREIGN_TRANSACTION' || item.detailed === 'BANK_FEES_OVERDRAFT')).toBe(false);
  });

  it('keeps a processor fee on line 10 and an ATM fee on Part V', () => {
    const payout = totals([charge({
      category: 'BANK_FEES_OTHER_BANK_FEES', amount: 0.85, merchant_name: 'PLATFORM INSTANT PAYOUT FEE', notes: 'fee to cash out my 1099 delivery earnings',
    })]);
    expect(payout.lineItems['10']?.deductible).toBe(0.85);
    const atm = totals([charge({ category: 'BANK_FEES_ATM_FEES', amount: 3.5 })]);
    expect(atm.lineItems['10']).toBeUndefined();
    expect(atm.lineItems['27a']?.deductible).toBe(3.5);
  });

  it.skip('cash advance payoff on a credit account waits on an owner decision', () => {
    expect(totals([charge({ category: 'BANK_FEES_CASH_ADVANCE', amount: 12, account_type: 'credit' })])).toBeDefined();
  });

  it('caps line 22 and Part V at 2500 and sends software and blank other to needs more information past that line', () => {
    expect(totals([charge({ category: 'SOFTWARE', amount: 2500 })]).lineItems['27a']?.deductible).toBe(2500);
    expect(totals([charge({ category: 'SOFTWARE', amount: 2500.01 })]).needsMoreInformation).toHaveLength(1);
    expect(totals([charge({ category: 'SOFTWARE', amount: 2500.01 })]).totalDeductible).toBe(0);
    expect(totals([charge({ category: 'SERVICE_SUBSCRIPTION', amount: 40 })]).lineItems['27a']?.deductible).toBe(40);
    expect(totals([charge({ category: 'software_subscriptions', amount: 40 })]).lineItems['18']).toBeUndefined();
    expect(categoryScheduleCLine('software_subscriptions')).toBe('27a');
    expect(categoryScheduleCLine('SERVICE_SUBSCRIPTION')).toBe('27a');
    expect(totals([charge({ category: 'GENERAL_MERCHANDISE_DEPARTMENT_STORES', amount: 2500 })]).lineItems['22']?.deductible).toBe(2500);
    expect(totals([charge({ category: 'GENERAL_MERCHANDISE_DEPARTMENT_STORES', amount: 2500.01 })]).needsMoreInformation).toHaveLength(1);
    const blank = totals([charge({ category: 'other', amount: 15, notes: '', description: '' })]);
    expect(blank.needsMoreInformation).toHaveLength(1);
    expect(blank.totalDeductible).toBe(0);
    const described = totals([charge({ category: 'Other', amount: 15, notes: 'Booth supplies' })]);
    expect(described.lineItems['27a']?.deductible).toBe(15);
  });

  it('sends insurance, agencies, tax payments and rideshares to needs more information', () => {
    for (const category of [
      'GENERAL_SERVICES_INSURANCE', 'GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES',
      'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT', 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES',
    ]) {
      const res = totals([charge({ category, amount: 90 })]);
      expect(res.totalDeductible).toBe(0);
      expect(res.needsMoreInformation).toHaveLength(1);
    }
  });

  it('counts internet and phone at the confirmed amount with the business-share note and rental cars on 24a', () => {
    const phone = totals([charge({ category: 'RENT_AND_UTILITIES_TELEPHONE', amount: 80, business_use_percentage: 25 })]);
    expect(phone.lineItems['25']?.deductible).toBe(80);
    expect(phone.exportNotes).toContain(BUSINESS_SHARE_ONLY_NOTE);
    const internet = totals([charge({ category: 'RENT_AND_UTILITIES_INTERNET_AND_CABLE', amount: 90, business_use_percentage: 40 })]);
    expect(internet.lineItems['25']?.deductible).toBe(90);
    expect(totals([charge({ category: 'TRAVEL_RENTAL_CARS', amount: 210 })]).lineItems['24a']?.deductible).toBe(210);
  });

  it('counts charity and pharmacy at zero', () => {
    const res = totals([
      charge({ category: 'COMMUNITY_CHARITY', amount: 25, id: 'gift' }),
      charge({ category: 'GENERAL_MERCHANDISE_PHARMACY', amount: 18, id: 'pharmacy' }),
    ]);
    expect(res.totalDeductible).toBe(0);
    expect(res.lineItems['18']).toBeUndefined();
    expect(res.lineItems['27a']).toBeUndefined();
  });
});

describe('unknown categories', () => {
  const source = { id: 'business-162', title: 'Business expenses', url: 'https://www.irs.gov/publications/p334', edition: 'current', reviewed_at: '2026-09-16' };

  it.each([2024, 2025])('withholds NOT_A_REAL_CATEGORY for %s on the card, the totals, both CSVs and the audit packet', year => {
    const row = charge({ id: 'mystery', category: 'NOT_A_REAL_CATEGORY', amount: 40, date: `${year}-06-15`, merchant_name: 'Mystery payee' });
    const res = totals([row], String(year));
    expect(res.totalDeductible).toBe(0);
    expect(res.totalExpenses).toBe(0);
    expect(res.lineItemsArray).toEqual([]);
    expect(res.needsMoreInformation).toHaveLength(1);
    const scheduleC = generateScheduleCCSV(res.lineItemsArray, year, res.needsMoreInformation);
    expect(scheduleC).toContain('NOT_A_REAL_CATEGORY');
    expect(scheduleC).toContain('Needs more information');
    expect(scheduleC).not.toContain('27a (Other expenses)');
    expect(scheduleC).not.toContain('27b (Other expenses)');
    const transactionCsv = convertTransactionsToCSV([row]);
    expect(transactionCsv).toContain('Needs more information');
    expect(transactionCsv).not.toContain(`${year >= 2025 ? '27b' : '27a'} (Other expenses)`);
    const evidence = buildEvidenceRecord(row, { uid: 'owner', tripsByDate: new Map(), yearTripCount: 0, receiptsByTransaction: new Map() });
    expect(evidence.scheduleCLine).toBeNull();
    expect(evidence.substantiation.advisories).toContain('Needs more information');
    const card = composeExplanation({
      result: { status: 'ok', transaction_kind: 'expense', category: 'NOT_A_REAL_CATEGORY', is_deductible: true, sources: [source] } as ExplainableResult,
      transaction: { amount: 40, date: `${year}-06-15`, category: 'NOT_A_REAL_CATEGORY', iso_currency_code: 'USD', merchant_name: 'Mystery payee' },
      profile: { income: 80000, filing_status: 'single' },
      taxYear: year,
    });
    expect(card.scheduleCLine).toBeNull();
    expect(card.headline.startsWith('Needs more information')).toBe(true);
  });
});
