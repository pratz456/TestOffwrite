/**
 * Adapter that converts WriteOff's existing aggregation output into
 * the Column Tax "Initialize Tax Filing" request payload.
 *
 * Ref: https://docs.columntax.com/reference/express-initialize-tax-filing
 *
 * Key rules:
 *   - All monetary values in CENTS (integer).
 *   - Schedule C data goes in `schedule_c_businesses[]`.
 *   - Single endpoint handles user creation + data pre-fill.
 *
 * This module imports existing code READ-ONLY.
 */

import {
  aggregateScheduleC,
  type AggregateScheduleCResult,
  type ScheduleCTransactionLike,
} from '@/lib/schedule-c/aggregate';
import { calc8829, type HomeOfficeSettings } from '@/lib/reports/calc8829';
import type {
  InitializeTaxFilingPayload,
  ScheduleCExpenses,
  ScheduleCBusiness,
} from './client';

function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Maps Schedule C line codes from aggregateScheduleC()
 * to Column Tax expense field names (all *_amount_cents).
 */
const LINE_CODE_TO_EXPENSE_FIELD: Record<string, keyof ScheduleCExpenses> = {
  '8': 'advertising_amount_cents',
  '9': 'travel_amount_cents',            // car/truck → reported via vehicles or travel
  '10': 'commission_and_fees_amount_cents',
  '11': 'contract_labor_amount_cents',
  '15': 'business_insurance_amount_cents',
  '16a': 'mortgage_interest_amount_cents',
  '17': 'legal_and_professional_services_amount_cents',
  '18': 'office_expenses_amount_cents',
  '20a': 'machinery_equipment_rent_amount_cents',
  '20b': 'other_rent_amount_cents',
  '22': 'supplies_amount_cents',
  '24a': 'travel_amount_cents',
  '24b': 'meals_amount_cents',
  '25': 'utilities_amount_cents',
};

export interface AdapterInput {
  uid: string;
  email: string;
  firstName?: string;
  lastName?: string;
  occupation?: string;
  state?: string;
  mailingAddress?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  transactions: ScheduleCTransactionLike[];
  taxYear: string;
  businessDescription: string;
  businessName?: string;
  ein?: string;
  naicsCode?: string;
  accountingMethod?: 'cash' | 'accrual';
  homeOfficeSettings?: HomeOfficeSettings | null;
  homeOfficeSqft?: number;
}

export interface AdapterOutput {
  payload: InitializeTaxFilingPayload;
  aggregation: AggregateScheduleCResult;
}

export function buildColumnTaxPayload(input: AdapterInput): AdapterOutput {
  const {
    uid,
    email,
    firstName,
    lastName,
    occupation,
    state,
    transactions,
    taxYear,
    businessDescription,
    businessName,
    ein,
    naicsCode,
    accountingMethod = 'cash',
    homeOfficeSettings,
    homeOfficeSqft,
  } = input;

  const aggregation = aggregateScheduleC(transactions, taxYear);

  const expenses: ScheduleCExpenses = {};
  const otherExpenseItems: Array<{ expense_description: string; expense_amount_cents: number }> = [];

  for (const item of aggregation.lineItemsArray) {
    const field = LINE_CODE_TO_EXPENSE_FIELD[item.lineCode];
    if (field) {
      const current = (expenses[field] as number | undefined) || 0;
      (expenses as Record<string, number>)[field] = current + dollarsToCents(item.deductible);
    } else {
      otherExpenseItems.push({
        expense_description: item.lineName,
        expense_amount_cents: dollarsToCents(item.deductible),
      });
    }
  }

  if (otherExpenseItems.length > 0) {
    expenses.other_expenses = otherExpenseItems;
  }

  let businessHomeArea: number | undefined;
  if (homeOfficeSqft && homeOfficeSqft > 0) {
    businessHomeArea = homeOfficeSqft;
  } else if (homeOfficeSettings && homeOfficeSettings.officeSqFt > 0) {
    businessHomeArea = homeOfficeSettings.officeSqFt;
  }

  const business: ScheduleCBusiness = {
    description: businessDescription || occupation || 'Self-employed',
    name: businessName || undefined,
    ein: ein || undefined,
    code: naicsCode || undefined,
    accounting_method: accountingMethod,
    state: state || undefined,
    business_home_area: businessHomeArea,
    expenses,
  };

  const payload: InitializeTaxFilingPayload = {
    user_identifier: uid,
    user: { email },
    user_metadata: {
      password_changed_date: null,
      account_locked_date: null,
      passed_mfa_at_this_login: true,
      failed_login_attempts: 0,
      cell_phone_changed_date: null,
      email_changed_date: null,
    },
    taxpayer_personal_info: {
      first_name: firstName || undefined,
      last_name: lastName || undefined,
      occupation: occupation || undefined,
    },
    address: input.mailingAddress?.street
      ? {
          address: input.mailingAddress.street,
          city: input.mailingAddress.city,
          state: input.mailingAddress.state || state,
          zip_code: input.mailingAddress.zip,
        }
      : state ? { state } : undefined,
    schedule_c_businesses: [business],
  };

  return { payload, aggregation };
}
