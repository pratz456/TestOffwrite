import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  DocumentData
} from "firebase/firestore";
import { db } from "./client";
import { waitForAuth } from "./auth";

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
  plaid_token?: string;
  onboardingIntroCompleted?: boolean;
  onboardingPlaidGuideCompleted?: boolean;
  created_at?: any;
  updated_at?: any;

  // Phase 1: High Impact Fields
  itemization_status?: 'itemize' | 'standard';
  business_start_date?: string;
  home_office_sqft?: number;
  total_home_sqft?: number;
  home_office_method?: 'simplified' | 'actual';
  vehicle_business_use_percentage?: number;
  vehicle_deduction_method?: 'standard_mileage' | 'actual_expense';

  // Phase 2: Medium Impact Fields
  naics_code?: string;
  business_purpose?: string;
  ein?: string;
  w2_income?: number;
  business_income?: number;
  other_income?: number;
  tax_bracket?: number;
  professional_licenses?: string[];

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

  // Column Tax Integration
  columnTaxTaxpayerId?: string;
  columnTaxFilingStatus?: 'draft' | 'submitted' | 'accepted' | 'rejected';
  columnTaxFilingYear?: number;
  columnTaxLastSyncedAt?: Date | any;
}

// Client-side function (for use in components) - now auth-gated
export async function getUserProfileSafe(): Promise<{ data: UserProfile | null; error: any }> {
  try {
    const uid = await waitForAuth(); // gate by auth
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
            plaid_token: data.plaid_token,
            onboardingIntroCompleted: data.onboardingIntroCompleted,
            onboardingPlaidGuideCompleted: data.onboardingPlaidGuideCompleted,
            created_at: data.created_at,
            updated_at: data.updated_at,

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
            ein: data.ein,
            w2_income: data.w2_income,
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
          plaid_token: data.plaid_token,
          onboardingIntroCompleted: data.onboardingIntroCompleted || false,
          onboardingPlaidGuideCompleted: data.onboardingPlaidGuideCompleted || false,
          created_at: data.created_at,
          updated_at: data.updated_at,

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
          ein: data.ein,
          w2_income: data.w2_income,
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
    console.log('🔄 [Firebase Profile] Upserting profile for user:', userId);
    console.log('🔄 [Firebase Profile] Profile data:', profileData);

    const docRef = doc(db, "user_profiles", userId);

    // Filter out undefined values as Firebase doesn't allow them (including nested objects)
    const filterUndefinedValues = (obj: any): any => {
      if (obj === null || obj === undefined) {
        return null;
      }
      if (Array.isArray(obj)) {
        return obj.map(filterUndefinedValues);
      }
      if (typeof obj === 'object') {
        const filtered: any = {};
        for (const [key, value] of Object.entries(obj)) {
          if (value !== undefined) {
            filtered[key] = filterUndefinedValues(value);
          }
        }
        return filtered;
      }
      return obj;
    };

    const filteredProfileData = filterUndefinedValues(profileData);

    const updateData = {
      ...filteredProfileData,
      updated_at: serverTimestamp(),
    };

    console.log('🔄 [Firebase Profile] Update data prepared:', updateData);

    // Check if document exists
    console.log('🔍 [Firebase Profile] Checking if document exists...');
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      console.log('📝 [Firebase Profile] Document exists, updating...');
      // Update existing document
      await updateDoc(docRef, updateData);
      console.log('✅ [Firebase Profile] Document updated successfully');
    } else {
      console.log('📝 [Firebase Profile] Document does not exist, creating...');
      // Create new document with default onboarding values
      await setDoc(docRef, {
        ...updateData,
        onboardingIntroCompleted: false,
        onboardingPlaidGuideCompleted: false,
        created_at: serverTimestamp(),
      });
      console.log('✅ [Firebase Profile] Document created successfully');
    }

    // Return the updated profile
    const updatedDoc = await getDoc(docRef);
    if (updatedDoc.exists()) {
      const data = updatedDoc.data() as DocumentData;
      return {
        data: {
          id: updatedDoc.id,
          email: data.email || '',
          name: data.name || '',
          profession: data.profession || '',
          business_entity_type: data.business_entity_type || '',
          primary_work_location: data.primary_work_location || '',
          work_related_travel_pattern: data.work_related_travel_pattern || '',
          income: data.income || '',
          state: data.state || '',
          filing_status: data.filing_status || '',
          plaid_token: data.plaid_token,
          onboardingIntroCompleted: data.onboardingIntroCompleted,
          onboardingPlaidGuideCompleted: data.onboardingPlaidGuideCompleted,
          created_at: data.created_at,
          updated_at: data.updated_at,

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
          ein: data.ein,
          w2_income: data.w2_income,
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
    }

    return { data: null, error: new Error('Failed to retrieve updated profile') };
  } catch (error) {
    console.error('❌ [Firebase Profile] Error upserting user profile:', error);
    console.error('❌ [Firebase Profile] Error type:', typeof error);
    console.error('❌ [Firebase Profile] Error details:', JSON.stringify(error, null, 2));
    return { data: null, error };
  }
}

// Client-side function to update specific profile fields
export async function updateUserProfile(
  userId: string,
  updates: Partial<UserProfile>
): Promise<{ data: UserProfile | null; error: any }> {
  try {
    console.log('🔄 [Firebase Profile] Updating profile for user:', userId);
    console.log('🔄 [Firebase Profile] Updates:', updates);

    const docRef = doc(db, "user_profiles", userId);
    const updateData = {
      ...updates,
      updated_at: serverTimestamp(),
    };

    await updateDoc(docRef, updateData);
    console.log('✅ [Firebase Profile] Profile updated successfully');

    // Return the updated profile
    const updatedDoc = await getDoc(docRef);
    if (updatedDoc.exists()) {
      const data = updatedDoc.data() as DocumentData;
      return {
        data: {
          id: updatedDoc.id,
          email: data.email || '',
          name: data.name || '',
          profession: data.profession || '',
          income: data.income || '',
          state: data.state || '',
          filing_status: data.filing_status || '',
          plaid_token: data.plaid_token,
          onboardingIntroCompleted: data.onboardingIntroCompleted,
          onboardingPlaidGuideCompleted: data.onboardingPlaidGuideCompleted,
          created_at: data.created_at,
          updated_at: data.updated_at,
        },
        error: null
      };
    }

    return { data: null, error: new Error('Failed to retrieve updated profile') };
  } catch (error) {
    console.error('❌ [Firebase Profile] Error updating user profile:', error);
    return { data: null, error };
  }
}
