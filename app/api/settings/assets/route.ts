import { getAssetsSettings } from '@/lib/firebase/settings-server';
export async function GET(request: NextRequest) {
  try {
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data, error } = await getAssetsSettings(user.uid);
    if (error) {
      return NextResponse.json({ error: error.message || 'Failed to load assets' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load assets', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { saveAsset, deleteAsset } from '@/lib/firebase/settings-server';

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 [Assets Settings API] Starting request...');
    
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Assets Settings API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ [Assets Settings API] User authenticated:', user.uid);

    const { assets } = await request.json();

    if (!assets || !Array.isArray(assets)) {
      return NextResponse.json(
        { error: 'Assets array is required' },
        { status: 400 }
      );
    }

    // Validate each asset
    for (const asset of assets) {
      if (!asset.description || !asset.cost || !asset.datePlacedInService) {
        return NextResponse.json(
          { error: 'Each asset must have description, cost, and date placed in service' },
          { status: 400 }
        );
      }

      if (asset.cost <= 0) {
        return NextResponse.json(
          { error: 'Asset cost must be greater than 0' },
          { status: 400 }
        );
      }

      if (asset.businessUsePercent < 0 || asset.businessUsePercent > 100) {
        return NextResponse.json(
          { error: 'Business use percentage must be between 0 and 100' },
          { status: 400 }
        );
      }
    }

    // Save each asset
    const savedAssets = [];
    for (const asset of assets) {
      const { data, error } = await saveAsset(user.uid, {
        description: asset.description,
        datePlacedInService: new Date(asset.datePlacedInService),
        cost: asset.cost,
        businessUsePercent: asset.businessUsePercent,
        category: asset.category,
        method: asset.method,
        section179Requested: asset.section179Requested,
        bonusEligible: asset.bonusEligible,
      });

      if (error) {
        console.error('❌ [Assets Settings API] Failed to save asset:', error);
        return NextResponse.json(
          { error: 'Failed to save assets' },
          { status: 500 }
        );
      }

      if (data) {
        savedAssets.push(data);
      }
    }

    console.log(`✅ [Assets Settings API] Successfully saved ${savedAssets.length} assets`);

    return NextResponse.json({
      success: true,
      data: savedAssets
    });

  } catch (error) {
    console.error('❌ [Assets Settings API] Unexpected error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to save assets',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    console.log('🔄 [Assets Settings API] Starting delete request...');
    
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Assets Settings API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { assetId } = await request.json();

    if (!assetId) {
      return NextResponse.json(
        { error: 'Asset ID is required' },
        { status: 400 }
      );
    }

    // Delete asset
    const { success, error } = await deleteAsset(user.uid, assetId);

    if (error) {
      console.error('❌ [Assets Settings API] Failed to delete asset:', error);
      return NextResponse.json(
        { error: 'Failed to delete asset' },
        { status: 500 }
      );
    }

    console.log('✅ [Assets Settings API] Successfully deleted asset');

    return NextResponse.json({
      success: true
    });

  } catch (error) {
    console.error('❌ [Assets Settings API] Unexpected error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to delete asset',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
