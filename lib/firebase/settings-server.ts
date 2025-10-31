import { adminDb } from './admin';
import { HomeOfficeSettings } from '@/lib/reports/calc8829';
import { Asset } from '@/lib/reports/calc4562';
import { TaxSummarySettings } from '@/lib/reports/calcSE';

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
      
      const homeOfficeSettings: HomeOfficeSettings = {
        totalHomeSqFt: data.totalHomeSqFt || 0,
        officeSqFt: data.officeSqFt || 0,
        rentOrMortgageInterest: data.rentOrMortgageInterest || 0,
        utilities: data.utilities || 0,
        insurance: data.insurance || 0,
        repairsMaintenance: data.repairsMaintenance || 0,
        propertyTax: data.propertyTax || 0,
        other: data.other || 0,
      };
      
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
      
      const homeOfficeSettings: HomeOfficeSettings = {
        totalHomeSqFt: data.totalHomeSqFt || 0,
        officeSqFt: data.officeSqFt || 0,
        rentOrMortgageInterest: data.rentOrMortgageInterest || 0,
        utilities: data.utilities || 0,
        insurance: data.insurance || 0,
        repairsMaintenance: data.repairsMaintenance || 0,
        propertyTax: data.propertyTax || 0,
        other: data.other || 0,
      };
      
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
