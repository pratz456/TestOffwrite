import { adminDb } from './admin';
import {
  HOME_OFFICE_ANSWERS, HOME_OFFICE_EXCLUSIVE_USE_EXCEPTIONS, HOME_OFFICE_HOUSING_TYPES, HOME_OFFICE_METHODS, HOME_OFFICE_QUALIFYING_USES,
  type HomeOfficeSettings,
} from '@/lib/reports/calc8829';
import { Asset, type DepreciationElections } from '@/lib/reports/calc4562';
import { TaxSummarySettings } from '@/lib/reports/calcSE';
import { SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';

const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | null => allowed.includes(value as T) ? value as T : null;
const wholeNumber = (value: unknown, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null;

/**
 * Firestore document → HomeOfficeSettings. Legacy documents predate the eligibility facts,
 * so every fact reads as null (unanswered) rather than "no"; unknown stored values also read
 * as unanswered so a stale option can never satisfy an eligibility test.
 */
export function normalizeHomeOfficeSettings(data: Record<string, unknown>): HomeOfficeSettings {
  return {
    totalHomeSqFt: (data.totalHomeSqFt as number) || 0,
    officeSqFt: (data.officeSqFt as number) || 0,
    rentOrMortgageInterest: (data.rentOrMortgageInterest as number) || 0,
    utilities: (data.utilities as number) || 0,
    insurance: (data.insurance as number) || 0,
    repairsMaintenance: (data.repairsMaintenance as number) || 0,
    propertyTax: (data.propertyTax as number) || 0,
    other: (data.other as number) || 0,
    method: oneOf(HOME_OFFICE_METHODS, data.method),
    regularUse: oneOf(HOME_OFFICE_ANSWERS, data.regularUse),
    exclusiveUse: oneOf(HOME_OFFICE_ANSWERS, data.exclusiveUse),
    exclusiveUseException: oneOf(HOME_OFFICE_EXCLUSIVE_USE_EXCEPTIONS, data.exclusiveUseException),
    qualifyingUse: oneOf(HOME_OFFICE_QUALIFYING_USES, data.qualifyingUse),
    housingType: oneOf(HOME_OFFICE_HOUSING_TYPES, data.housingType),
    monthsUsed: wholeNumber(data.monthsUsed, 12),
  };
}

/** settings/depreciation: annual elections that are not attributes of any single asset. */
export function normalizeDepreciationSettings(data: Record<string, unknown>): DepreciationElections {
  const years = Array.isArray(data.deMinimisSafeHarborYears) ? data.deMinimisSafeHarborYears : [];
  return { deMinimisSafeHarborYears: [...new Set(years.filter((year): year is number => SUPPORTED_TAX_YEARS.includes(year as typeof SUPPORTED_TAX_YEARS[number])))].sort() };
}

/**
 * Get home office settings for a user
 */
export async function getHomeOfficeSettings(userId: string): Promise<{ data: HomeOfficeSettings | null; error: any }> {
  try {
    console.log('🔄 [Settings Server] Fetching home office settings for user:', userId);
    
    const docRef = adminDb.collection('user_profiles').doc(userId).collection('settings').doc('homeOffice');
    const docSnap = await docRef.get();
    
    if (docSnap.exists) {
      const data = docSnap.data();
      if (!data) {
        return { data: null, error: new Error('Document data is null') };
      }
      
      const homeOfficeSettings = normalizeHomeOfficeSettings(data);
      
      console.log('✅ [Settings Server] Successfully fetched home office settings');
      return { data: homeOfficeSettings, error: null };
    } else {
      console.log('⚠️ [Settings Server] Home office settings not found');
      return { data: null, error: { code: 'NOT_FOUND', message: 'Home office settings not found' } };
    }
  } catch (error) {
    console.error('❌ [Settings Server] Error fetching home office settings:', error);
    return { data: null, error };
  }
}

/**
 * Get assets settings for a user
 */
export async function getAssetsSettings(userId: string): Promise<{ data: Asset[] | null; error: any }> {
  try {
    console.log('🔄 [Settings Server] Fetching assets settings for user:', userId);
    
    const collectionRef = adminDb.collection('user_profiles').doc(userId).collection('assets');
    const querySnapshot = await collectionRef.get();
    
    if (querySnapshot.empty) {
      console.log('⚠️ [Settings Server] No assets found');
      return { data: [], error: null };
    }
    
    const assets: Asset[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data) {
        assets.push({
          id: doc.id,
          description: data.description || '',
          datePlacedInService: data.datePlacedInService?.toDate() || new Date(),
          cost: data.cost || 0,
          businessUsePercent: data.businessUsePercent || 0,
          category: data.category || 'other',
          method: data.method || 'MACRS_5YR',
          section179Requested: data.section179Requested || false,
          bonusEligible: data.bonusEligible || false,
        });
      }
    });
    
    console.log(`✅ [Settings Server] Successfully fetched ${assets.length} assets`);
    return { data: assets, error: null };
  } catch (error) {
    console.error('❌ [Settings Server] Error fetching assets settings:', error);
    return { data: null, error };
  }
}

/**
 * Get tax summary settings for a user
 */
export async function getTaxSummarySettings(userId: string): Promise<{ data: TaxSummarySettings | null; error: any }> {
  try {
    console.log('🔄 [Settings Server] Fetching tax summary settings for user:', userId);
    
    const docRef = adminDb.collection('user_profiles').doc(userId).collection('settings').doc('taxSummary');
    const docSnap = await docRef.get();
    
    if (docSnap.exists) {
      const data = docSnap.data();
      if (!data) {
        return { data: null, error: new Error('Document data is null') };
      }
      
      const taxSummarySettings: TaxSummarySettings = {
        scheduleCNetProfit: data.scheduleCNetProfit || 0,
        taxYear: data.taxYear || new Date().getFullYear(),
        adjustments: data.adjustments || 0,
      };
      
      console.log('✅ [Settings Server] Successfully fetched tax summary settings');
      return { data: taxSummarySettings, error: null };
    } else {
      console.log('⚠️ [Settings Server] Tax summary settings not found');
      return { data: null, error: { code: 'NOT_FOUND', message: 'Tax summary settings not found' } };
    }
  } catch (error) {
    console.error('❌ [Settings Server] Error fetching tax summary settings:', error);
    return { data: null, error };
  }
}

/**
 * Save home office settings for a user
 */
export async function saveHomeOfficeSettings(
  userId: string, 
  settings: Partial<HomeOfficeSettings>
): Promise<{ data: HomeOfficeSettings | null; error: any }> {
  try {
    console.log('🔄 [Settings Server] Saving home office settings for user:', userId);
    
    const docRef = adminDb.collection('user_profiles').doc(userId).collection('settings').doc('homeOffice');
    
    const updateData = {
      ...settings,
      updated_at: new Date(),
    };
    
    await docRef.set(updateData, { merge: true });
    
    // Return the updated settings
    const updatedDoc = await docRef.get();
    if (updatedDoc.exists) {
      const data = updatedDoc.data();
      if (!data) {
        return { data: null, error: new Error('Document data is null') };
      }
      
      const homeOfficeSettings = normalizeHomeOfficeSettings(data);
      
      console.log('✅ [Settings Server] Successfully saved home office settings');
      return { data: homeOfficeSettings, error: null };
    }
    
    return { data: null, error: new Error('Failed to retrieve updated settings') };
  } catch (error) {
    console.error('❌ [Settings Server] Error saving home office settings:', error);
    return { data: null, error };
  }
}

/**
 * Get depreciation elections (settings/depreciation) for a user. A missing document is an
 * empty election set, not an error: no year has been elected yet.
 */
export async function getDepreciationSettings(userId: string): Promise<{ data: DepreciationElections | null; error: any }> {
  try {
    const docSnap = await adminDb.collection('user_profiles').doc(userId).collection('settings').doc('depreciation').get();
    if (!docSnap.exists) return { data: { deMinimisSafeHarborYears: [] }, error: null };
    const data = docSnap.data();
    if (!data) return { data: null, error: new Error('Document data is null') };
    return { data: normalizeDepreciationSettings(data), error: null };
  } catch (error) {
    console.error('❌ [Settings Server] Error fetching depreciation settings:', error);
    return { data: null, error };
  }
}

export interface ScheduleCSettings {
  assets: Asset[];
  /** null when the settings/homeOffice document does not exist (no home office claimed). */
  homeOffice: HomeOfficeSettings | null;
  depreciationElections: DepreciationElections;
}

/**
 * Everything the shared Schedule C ordering reads from settings, loaded together so every
 * route (annual estimate, Form 1040 PDF, SE loader, worksheets) sees the same records.
 * A missing home office document is a normal state; any other failure is an error so the
 * caller returns 503 instead of calculating from silently missing settings.
 */
export async function getScheduleCSettings(userId: string): Promise<{ data: ScheduleCSettings | null; error: any }> {
  const [assets, homeOffice, elections] = await Promise.all([getAssetsSettings(userId), getHomeOfficeSettings(userId), getDepreciationSettings(userId)]);
  if (assets.error || !assets.data) return { data: null, error: assets.error ?? new Error('Assets unavailable') };
  if (homeOffice.error && homeOffice.error.code !== 'NOT_FOUND') return { data: null, error: homeOffice.error };
  if (elections.error || !elections.data) return { data: null, error: elections.error ?? new Error('Depreciation settings unavailable') };
  return { data: { assets: assets.data, homeOffice: homeOffice.data ?? null, depreciationElections: elections.data }, error: null };
}

/** Save depreciation elections for a user; the stored year list is replaced, not merged. */
export async function saveDepreciationSettings(userId: string, settings: DepreciationElections): Promise<{ data: DepreciationElections | null; error: any }> {
  try {
    const docRef = adminDb.collection('user_profiles').doc(userId).collection('settings').doc('depreciation');
    const normalized = normalizeDepreciationSettings(settings as unknown as Record<string, unknown>);
    await docRef.set({ deMinimisSafeHarborYears: normalized.deMinimisSafeHarborYears, updated_at: new Date() }, { merge: true });
    const updatedDoc = await docRef.get();
    const data = updatedDoc.data();
    if (!updatedDoc.exists || !data) return { data: null, error: new Error('Failed to retrieve updated settings') };
    return { data: normalizeDepreciationSettings(data), error: null };
  } catch (error) {
    console.error('❌ [Settings Server] Error saving depreciation settings:', error);
    return { data: null, error };
  }
}

/**
 * Save an asset for a user
 */
export async function saveAsset(
  userId: string, 
  asset: Omit<Asset, 'id'>
): Promise<{ data: Asset | null; error: any }> {
  try {
    console.log('🔄 [Settings Server] Saving asset for user:', userId);
    
    const collectionRef = adminDb.collection('user_profiles').doc(userId).collection('assets');
    const docRef = await collectionRef.add({
      ...asset,
      created_at: new Date(),
      updated_at: new Date(),
    });
    
    const savedAsset: Asset = {
      id: docRef.id,
      ...asset,
    };
    
    console.log('✅ [Settings Server] Successfully saved asset:', docRef.id);
    return { data: savedAsset, error: null };
  } catch (error) {
    console.error('❌ [Settings Server] Error saving asset:', error);
    return { data: null, error };
  }
}

/**
 * Update an asset for a user
 */
export async function updateAsset(
  userId: string, 
  assetId: string,
  updates: Partial<Omit<Asset, 'id'>>
): Promise<{ data: Asset | null; error: any }> {
  try {
    console.log('🔄 [Settings Server] Updating asset for user:', userId, 'asset:', assetId);
    
    const docRef = adminDb.collection('user_profiles').doc(userId).collection('assets').doc(assetId);
    
    const updateData = {
      ...updates,
      updated_at: new Date(),
    };
    
    await docRef.update(updateData);
    
    // Return the updated asset
    const updatedDoc = await docRef.get();
    if (updatedDoc.exists) {
      const data = updatedDoc.data();
      if (!data) {
        return { data: null, error: new Error('Document data is null') };
      }
      
      const asset: Asset = {
        id: updatedDoc.id,
        description: data.description || '',
        datePlacedInService: data.datePlacedInService?.toDate() || new Date(),
        cost: data.cost || 0,
        businessUsePercent: data.businessUsePercent || 0,
        category: data.category || 'other',
        method: data.method || 'MACRS_5YR',
        section179Requested: data.section179Requested || false,
        bonusEligible: data.bonusEligible || false,
      };
      
      console.log('✅ [Settings Server] Successfully updated asset');
      return { data: asset, error: null };
    }
    
    return { data: null, error: new Error('Failed to retrieve updated asset') };
  } catch (error) {
    console.error('❌ [Settings Server] Error updating asset:', error);
    return { data: null, error };
  }
}

/**
 * Delete an asset for a user
 */
export async function deleteAsset(
  userId: string, 
  assetId: string
): Promise<{ success: boolean; error: any }> {
  try {
    console.log('🔄 [Settings Server] Deleting asset for user:', userId, 'asset:', assetId);
    
    const docRef = adminDb.collection('user_profiles').doc(userId).collection('assets').doc(assetId);
    await docRef.delete();
    
    console.log('✅ [Settings Server] Successfully deleted asset');
    return { success: true, error: null };
  } catch (error) {
    console.error('❌ [Settings Server] Error deleting asset:', error);
    return { success: false, error };
  }
}

/**
 * Save tax summary settings for a user
 */
export async function saveTaxSummarySettings(
  userId: string, 
  settings: Partial<TaxSummarySettings>
): Promise<{ data: TaxSummarySettings | null; error: any }> {
  try {
    console.log('🔄 [Settings Server] Saving tax summary settings for user:', userId);
    
    const docRef = adminDb.collection('user_profiles').doc(userId).collection('settings').doc('taxSummary');
    
    const updateData = {
      ...settings,
      updated_at: new Date(),
    };
    
    await docRef.set(updateData, { merge: true });
    
    // Return the updated settings
    const updatedDoc = await docRef.get();
    if (updatedDoc.exists) {
      const data = updatedDoc.data();
      if (!data) {
        return { data: null, error: new Error('Document data is null') };
      }
      
      const taxSummarySettings: TaxSummarySettings = {
        scheduleCNetProfit: data.scheduleCNetProfit || 0,
        taxYear: data.taxYear || new Date().getFullYear(),
        adjustments: data.adjustments || 0,
      };
      
      console.log('✅ [Settings Server] Successfully saved tax summary settings');
      return { data: taxSummarySettings, error: null };
    }
    
    return { data: null, error: new Error('Failed to retrieve updated settings') };
  } catch (error) {
    console.error('❌ [Settings Server] Error saving tax summary settings:', error);
    return { data: null, error };
  }
}
