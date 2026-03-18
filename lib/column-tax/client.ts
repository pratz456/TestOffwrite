/**
 * Column Tax API client.
 *
 * Wraps the Column Tax "Initialize Tax Filing" endpoint.
 * Ref: https://docs.columntax.com/reference/express-initialize-tax-filing
 *
 * Auth: HTTP Basic (client_id:client_secret)
 * Endpoint: POST /v1/exp/initialize_tax_filing
 * Base URLs:
 *   sandbox  – https://sandbox.columnapi.com
 *   prod     – https://prod.columnapi.com
 *
 * Env vars:
 *   COLUMN_TAX_CLIENT_ID
 *   COLUMN_TAX_CLIENT_SECRET
 *   COLUMN_TAX_BASE_URL
 */

const BASE_URL =
  process.env.COLUMN_TAX_BASE_URL || 'https://sandbox.columnapi.com';
const CLIENT_ID = process.env.COLUMN_TAX_CLIENT_ID || '';
const CLIENT_SECRET = process.env.COLUMN_TAX_CLIENT_SECRET || '';

function basicAuthHeader(): string {
  const encoded = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  return `Basic ${encoded}`;
}

// ── Schedule C expense fields (all in cents) ────────────────────────────────

export interface ScheduleCExpenses {
  advertising_amount_cents?: number;
  commission_and_fees_amount_cents?: number;
  contract_labor_amount_cents?: number;
  depletion_amount_cents?: number;
  employee_benefit_program_amount_cents?: number;
  business_insurance_amount_cents?: number;
  personal_health_insurance_amount_cents?: number;
  supplies_amount_cents?: number;
  mortgage_interest_amount_cents?: number;
  other_interest_amount_cents?: number;
  legal_and_professional_services_amount_cents?: number;
  office_expenses_amount_cents?: number;
  pension_profit_sharing_plans_amount_cents?: number;
  machinery_equipment_rent_amount_cents?: number;
  other_rent_amount_cents?: number;
  repairs_and_maintenance_amount_cents?: number;
  utilities_amount_cents?: number;
  wages_amount_cents?: number;
  tax_licenses_amount_cents?: number;
  travel_amount_cents?: number;
  meals_amount_cents?: number;
  entertainment_amount_cents?: number;
  other_expenses?: Array<{
    expense_description: string;
    expense_amount_cents: number;
  }>;
}

export interface ScheduleCBusiness {
  description: string;
  ein?: string;
  code?: string;
  accounting_method?: 'cash' | 'accrual';
  name?: string;
  state?: string;
  new_business?: boolean;
  business_home_area?: number;
  expenses?: ScheduleCExpenses;
  vehicles?: Array<{
    service_date?: string;
    business_miles?: number;
    total_commuting_miles?: number;
    total_other_miles?: number;
    parking_expense_amount_cents?: number;
    toll_expense_amount_cents?: number;
    was_used_for_personal?: boolean;
    another_vehicle_available?: boolean;
    has_supporting_evidence?: boolean;
    has_written_evidence?: boolean;
  }>;
}

// ── Full request payload ────────────────────────────────────────────────────

export interface InitializeTaxFilingPayload {
  user_identifier: string;
  user: { email: string };
  user_metadata: {
    password_changed_date: string | null;
    account_locked_date: string | null;
    passed_mfa_at_this_login: boolean;
    failed_login_attempts: number;
    cell_phone_changed_date: string | null;
    email_changed_date: string | null;
  };
  taxpayer_personal_info?: {
    first_name?: string;
    last_name?: string;
    occupation?: string;
    phone?: string;
    date_of_birth?: string;
    social_security_number?: string;
  };
  address?: {
    address?: string;
    apt_no?: string;
    city?: string;
    state?: string;
    zip_code?: string;
  };
  tax_filing_fee?: {
    tax_filing_fee_cents: number;
  };
  schedule_c_businesses?: ScheduleCBusiness[];
  federal_estimated_quarterly_payments?: {
    estimated_tax_payment_1_amount_cents?: number;
    estimated_tax_payment_2_amount_cents?: number;
    estimated_tax_payment_3_amount_cents?: number;
    estimated_tax_payment_4_amount_cents?: number;
  };
  w2s?: Array<Record<string, unknown>>;
}

// ── Response ────────────────────────────────────────────────────────────────

export interface InitializeTaxFilingResponse {
  user_identifier: string;
  user_url: string;
  user_token: string;
  data_errors: string[];
}

// ── API call ────────────────────────────────────────────────────────────────

export async function initializeTaxFiling(
  payload: InitializeTaxFilingPayload,
): Promise<{
  data: InitializeTaxFilingResponse | null;
  error: string | null;
  status: number;
}> {
  const url = `${BASE_URL}/v1/exp/initialize_tax_filing`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let json: InitializeTaxFilingResponse | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      // non-JSON
    }

    if (!res.ok) {
      let errorMsg: string;
      try {
        const parsed = JSON.parse(text);
        if (parsed.errors?.[0]?.detail) {
          errorMsg = parsed.errors[0].detail;
        } else {
          errorMsg = text;
        }
      } catch {
        errorMsg = text || res.statusText;
      }
      return { data: null, error: errorMsg, status: res.status };
    }

    return { data: json, error: null, status: res.status };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Network error',
      status: 0,
    };
  }
}
