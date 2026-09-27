import {
  doc,
  getDoc,
  DocumentData
} from "firebase/firestore";
import { db } from "./client";
import { waitForAuth } from "./auth";
import { makeAuthenticatedRequest } from "./api-client";
import type { ConsentRecord } from "@/lib/onboarding/consents";
import { EDITABLE_PROFILE_FIELDS } from "./profile-fields";

// Admin migration runs before SDK reads: Firestore cannot redact a secret field.
async function prepareProfileRead() {
  const response = await makeAuthenticatedRequest("/api/database/profiles", { cache: "no-store" });
  if (!response.ok) throw new Error("Profile could not be prepared securely. Please retry.");
}


export interface UserProfile {
  id: string;
  email: string;
  name: string;
  profession: string;
  business_entity_type?: string;
  primary_work_location?: string;
  work_related_travel_pattern?: string;
  income: string;
  state: string;
  filing_status: string;
  bankConnected?: boolean;
  onboardingIntroCompleted?: boolean;
  onboardingPlaidGuideCompleted?: boolean;
  year_of_birth?: string;
  created_at?: any;
  updated_at?: any;
  /** Sign-up acknowledgments, recorded through the profile API before setup. */
  consents?: ConsentRecord | null;

  // Phase 1: High Impact Fields
  itemization_status?: 'itemize' | 'standard';
  business_start_date?: string;
  home_office_sqft?: number | null;
  total_home_sqft?: number | null;
  home_office_method?: 'simplified' | 'actual';
  vehicle_business_use_percentage?: number | null;
  vehicle_deduction_method?: 'standard_mileage' | 'actual_expense';

  // Phase 2: Medium Impact Fields
  naics_code?: string;
  business_purpose?: string;
  ein?: string;
  w2_income?: number | null;
  w2_federal_withheld?: number | null;
  health_insurance_premiums?: number | null;
  sep_ira_contribution?: number | null;
  solo_401k_contribution?: number | null;
  hsa_contribution?: number | null;
  simple_ira_contribution?: number | null;
  business_income?: number | null;
  other_income?: number;
  tax_bracket?: number | null;
  professional_licenses?: string[];

  prior_year_tax?: number | null;
  mailing_address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };

  // Phase 3: Advanced Fields
  prior_year_deductions?: string[];
  audit_history?: 'none' | 'minor' | 'major';
  tax_professional?: boolean;
  documentation_habits?: 'minimal' | 'moderate' | 'detailed';
  business_seasonality?: 'year_round' | 'seasonal' | 'project_based';
  multiple_locations?: boolean;
  international_business?: boolean;

  // Vehicle Details
  business_vehicle?: {
    make?: string;
    model?: string;
    year?: number;
    business_use_percentage?: number;
    deduction_method?: 'standard_mileage' | 'actual_expense';
  };

  // Home Office Details
  home_office_details?: {
    sqft?: number;
    total_home_sqft?: number;
    method?: 'simplified' | 'actual';
    exclusive_use?: boolean;
    start_date?: string;
  };

  // Income Breakdown
  income_breakdown?: {
    w2_income?: number;
    business_income?: number;
    other_income?: number;
    quarterly_estimates?: number[];
  };

  // Subscription & Historical Access Fields
  hasHistoricalAccess?: boolean;
  subscriptionStatus?: 'trial' | 'active' | 'expired' | 'none'; // App-managed subscription status
  trialStart?: Date | any; // App-managed trial start (1 month free, no Stripe)
  trialEnd?: Date | any; // App-managed trial end
  subscriptionEnd?: Date | any; // Stripe subscription period end (only set when paid)
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeSubscriptionStatus?: string; // Stripe's subscription status (only set when paid)
  subscriptionPlan?: 'basic' | 'premium' | null; // Verified by server from the configured Stripe price.

  // Tax filing partner integration (external providers).
}

// Client-side function (for use in components) - now auth-gated
export async function getUserProfileSafe(): Promise<{ data: UserProfile | null; error: any }> {
  try {
    const uid = await waitForAuth(); // gate by auth
    await prepareProfileRead();
    const docRef = doc(db, "user_profiles", uid);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data() as DocumentData;
              return {
          data: {
            id: docSnap.id,
            email: data.email || '',
            name: data.name || '',
            profession: data.profession || '',
            business_entity_type: data.business_entity_type,
            primary_work_location: data.primary_work_location,
            work_related_travel_pattern: data.work_related_travel_pattern,
            income: data.income || '',
            state: data.state || '',
            filing_status: data.filing_status || '',
            bankConnected: data.bankConnected === true,
            onboardingIntroCompleted: data.onboardingIntroCompleted,
            onboardingPlaidGuideCompleted: data.onboardingPlaidGuideCompleted,
            created_at: data.created_at,
            updated_at: data.updated_at,
            consents: data.consents,

            // Phase 1: High Impact Fields
            itemization_status: data.itemization_status,
            business_start_date: data.business_start_date,
            home_office_sqft: data.home_office_sqft,
            total_home_sqft: data.total_home_sqft,
            home_office_method: data.home_office_method,
            vehicle_business_use_percentage: data.vehicle_business_use_percentage,
            vehicle_deduction_method: data.vehicle_deduction_method,

            // Phase 2: Medium Impact Fields
            naics_code: data.naics_code,
            business_purpose: data.business_purpose,
            ein: typeof data.ein_last4 === 'string' ? `**-***${data.ein_last4}` : data.ein,
            w2_income: data.w2_income,
            w2_federal_withheld: data.w2_federal_withheld,
            health_insurance_premiums: data.health_insurance_premiums,
            sep_ira_contribution: data.sep_ira_contribution,
            solo_401k_contribution: data.solo_401k_contribution,
            hsa_contribution: data.hsa_contribution,
            simple_ira_contribution: data.simple_ira_contribution,
            prior_year_tax: data.prior_year_tax,
            mailing_address: data.mailing_address,
            business_income: data.business_income,
            other_income: data.other_income,
            tax_bracket: data.tax_bracket,
            professional_licenses: data.professional_licenses,

            // Phase 3: Advanced Fields
            prior_year_deductions: data.prior_year_deductions,
            audit_history: data.audit_history,
            tax_professional: data.tax_professional,
            documentation_habits: data.documentation_habits,
            business_seasonality: data.business_seasonality,
            multiple_locations: data.multiple_locations,
            international_business: data.international_business,

            // Vehicle Details
            business_vehicle: data.business_vehicle,

            // Home Office Details
            home_office_details: data.home_office_details,

            // Income Breakdown
            income_breakdown: data.income_breakdown
          },
          error: null
        };
    } else {
      return { data: null, error: { code: 'PROFILE_NOT_FOUND', message: 'Profile not found' } };
    }
  } catch (error) {
    console.error('Error getting user profile:', error);
    // Return a structured error object
    return {
      data: null,
      error: {
        code: 'FETCH_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        originalError: error
      }
    };
  }
}

// Backward-compatible function (deprecated - use getUserProfileSafe instead)
export async function getUserProfile(userId: string): Promise<{ data: UserProfile | null; error: any }> {
  try {
    await prepareProfileRead();
    const docRef = doc(db, "user_profiles", userId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data() as DocumentData;
      return {
        data: {
          id: data.id || userId,
          email: data.email || '',
          name: data.name || '',
          profession: data.profession || '',
          business_entity_type: data.business_entity_type,
          primary_work_location: data.primary_work_location,
          work_related_travel_pattern: data.work_related_travel_pattern,
          income: data.income || '',
          state: data.state || '',
          filing_status: data.filing_status || '',
          bankConnected: data.bankConnected === true,
          onboardingIntroCompleted: data.onboardingIntroCompleted || false,
          onboardingPlaidGuideCompleted: data.onboardingPlaidGuideCompleted || false,
          created_at: data.created_at,
          updated_at: data.updated_at,
          consents: data.consents,

          // Phase 1: High Impact Fields
          itemization_status: data.itemization_status,
          business_start_date: data.business_start_date,
          home_office_sqft: data.home_office_sqft,
          total_home_sqft: data.total_home_sqft,
          home_office_method: data.home_office_method,
          vehicle_business_use_percentage: data.vehicle_business_use_percentage,
          vehicle_deduction_method: data.vehicle_deduction_method,

          // Phase 2: Medium Impact Fields
          naics_code: data.naics_code,
          business_purpose: data.business_purpose,
          ein: typeof data.ein_last4 === 'string' ? `**-***${data.ein_last4}` : data.ein,
          w2_income: data.w2_income,
          w2_federal_withheld: data.w2_federal_withheld,
          health_insurance_premiums: data.health_insurance_premiums,
          sep_ira_contribution: data.sep_ira_contribution,
          solo_401k_contribution: data.solo_401k_contribution,
          hsa_contribution: data.hsa_contribution,
          simple_ira_contribution: data.simple_ira_contribution,
          prior_year_tax: data.prior_year_tax,
          mailing_address: data.mailing_address,
          business_income: data.business_income,
          other_income: data.other_income,
          tax_bracket: data.tax_bracket,
          professional_licenses: data.professional_licenses,

          // Phase 3: Advanced Fields
          prior_year_deductions: data.prior_year_deductions,
          audit_history: data.audit_history,
          tax_professional: data.tax_professional,
          documentation_habits: data.documentation_habits,
          business_seasonality: data.business_seasonality,
          multiple_locations: data.multiple_locations,
          international_business: data.international_business,

          // Vehicle Details
          business_vehicle: data.business_vehicle,

          // Home Office Details
          home_office_details: data.home_office_details,

          // Income Breakdown
          income_breakdown: data.income_breakdown
        } as UserProfile,
        error: null
      };
    } else {
      return { data: null, error: { code: 'PROFILE_NOT_FOUND', message: 'Profile not found' } };
    }
  } catch (error) {
    console.error('Error getting user profile:', error);
    return {
      data: null,
      error: {
        code: 'FETCH_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        originalError: error
      }
    };
  }
}

// Client-side function (for use in components)
export async function upsertUserProfile(
  userId: string,
  profileData: Partial<UserProfile>
): Promise<{ data: UserProfile | null; error: any }> {
  try {
    const withoutUndefined = (value: any): any => {
      if (Array.isArray(value)) return value.map(withoutUndefined);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
          .filter(([, entry]) => entry !== undefined)
          .map(([key, entry]) => [key, withoutUndefined(entry)]));
      }
      return value;
    };
    const payload = Object.fromEntries(Object.entries(profileData)
      .filter(([key, value]) => EDITABLE_PROFILE_FIELDS.has(key) && value !== undefined)
      .map(([key, value]) => [key, withoutUndefined(value)]));
    const response = await makeAuthenticatedRequest('/api/database/profiles', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const issue = await response.json().catch(() => ({}));
      throw new Error(issue.error || 'Profile could not be saved');
    }
    return getUserProfile(userId);
  } catch (error) {
    console.error('❌ [Firebase Profile] Error upserting user profile');
    return { data: null, error };
  }
}

// Client-side function to update specific profile fields
export async function updateUserProfile(
  userId: string,
  updates: Partial<UserProfile>
): Promise<{ data: UserProfile | null; error: any }> {
  return upsertUserProfile(userId, updates);
}
