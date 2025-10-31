import { adminDb } from "./admin";

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
}

// Server-side function (for use in API routes)
export async function getUserProfileServer(userId: string): Promise<{ data: UserProfile | null; error: any }> {
  try {
    const docRef = adminDb.collection("user_profiles").doc(userId);
    const docSnap = await docRef.get();
    
    if (docSnap.exists) {
      const data = docSnap.data();
      if (!data) {
        return { data: null, error: new Error('Document data is null') };
      }
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
          created_at: data.created_at,
          updated_at: data.updated_at,
        },
        error: null
      };
    } else {
      return { data: null, error: { code: 'PGRST116', message: 'Profile not found' } };
    }
  } catch (error) {
    console.error('Error getting user profile (server):', error);
    return { data: null, error };
  }
}

// Server-side function (for use in API routes)
export async function upsertUserProfileServer(
  userId: string, 
  profileData: Partial<UserProfile>
): Promise<{ data: UserProfile | null; error: any }> {
  try {
    console.log('🔄 [Firebase Profile Server] Upserting profile for user:', userId);
    console.log('🔄 [Firebase Profile Server] Profile data:', profileData);
    console.log('📂 [Firebase Profile Server] Writing to user_profiles collection for user:', userId);
    
    const docRef = adminDb.collection("user_profiles").doc(userId);
    console.log('📂 [Firebase Profile Server] Document reference created:', docRef.path);
    
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
      updated_at: new Date(),
    };
    
    console.log('🔄 [Firebase Profile Server] Update data prepared:', updateData);
    
    // Check if document exists
    console.log('🔍 [Firebase Profile Server] Checking if document exists...');
    const docSnap = await docRef.get();
    console.log('🔍 [Firebase Profile Server] Document exists:', docSnap.exists);
    
    if (docSnap.exists) {
      console.log('📝 [Firebase Profile Server] Document exists, updating...');
      // Update existing document
      await docRef.update(updateData);
      console.log('✅ [Firebase Profile Server] Document updated successfully');
    } else {
      console.log('📝 [Firebase Profile Server] Document does not exist, creating...');
      // Create new document
      const createData = {
        ...updateData,
        created_at: new Date(),
      };
      console.log('📝 [Firebase Profile Server] Creating document with data:', createData);
      await docRef.set(createData);
      console.log('✅ [Firebase Profile Server] Document created successfully');
    }
    
    // Return the updated profile
    console.log('🔄 [Firebase Profile Server] Retrieving updated document...');
    const updatedDoc = await docRef.get();
    if (updatedDoc.exists) {
      const data = updatedDoc.data();
      if (!data) {
        console.error('❌ [Firebase Profile Server] Document exists but data is null');
        return { data: null, error: new Error('Document data is null') };
      }
      console.log('✅ [Firebase Profile Server] Successfully retrieved updated document:', data);
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
    
    console.error('❌ [Firebase Profile Server] Failed to retrieve updated document');
    return { data: null, error: new Error('Failed to retrieve updated profile') };
  } catch (error) {
    console.error('❌ [Firebase Profile Server] Error upserting user profile:', error);
    console.error('❌ [Firebase Profile Server] Error type:', typeof error);
    console.error('❌ [Firebase Profile Server] Error details:', JSON.stringify(error, null, 2));
    if (error instanceof Error) {
      console.error('❌ [Firebase Profile Server] Error message:', error.message);
      console.error('❌ [Firebase Profile Server] Error code:', (error as any).code);
    }
    return { data: null, error };
  }
}
