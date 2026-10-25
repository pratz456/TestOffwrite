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
      return NextResponse.json({ error: 'Failed to load assets' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json({ error: 'Failed to load assets' }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { saveAsset, deleteAsset, updateAsset } from '@/lib/firebase/settings-server';
import { isEquipmentAssetCategory, normalizeListedEquipmentAnswer, normalizeListedEquipmentKind, normalizeListedEquipmentLocation } from '@/lib/reports/calc4562';
import { invalidJsonResponse, readJsonObject } from '@/app/api/_lib/body';

const MAX_ASSETS_PER_REQUEST = 100;
const optionalString = (value: unknown, max: number) => value === undefined || (typeof value === 'string' && value.length <= max);
const optionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean';

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

    const body = await readJsonObject(request);
    if (!body) return invalidJsonResponse();
    const { assets } = body;

    if (!assets || !Array.isArray(assets) || assets.length > MAX_ASSETS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Assets array is required (at most ${MAX_ASSETS_PER_REQUEST} per request)` },
        { status: 400 }
      );
    }

    // Validate each asset
    for (const asset of assets) {
      if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
        return NextResponse.json({ error: 'Each asset must be an object' }, { status: 400 });
      }
      if (!asset.description || typeof asset.description !== 'string' || asset.description.length > 200
        || !asset.cost || !asset.datePlacedInService) {
        return NextResponse.json(
          { error: 'Each asset must have description, cost, and date placed in service' },
          { status: 400 }
        );
      }

      if (typeof asset.cost !== 'number' || !Number.isFinite(asset.cost) || asset.cost <= 0 || asset.cost > 100_000_000) {
        return NextResponse.json(
          { error: 'Asset cost must be greater than 0' },
          { status: 400 }
        );
      }
      if ((typeof asset.datePlacedInService !== 'string' && typeof asset.datePlacedInService !== 'number')
        || Number.isNaN(new Date(asset.datePlacedInService).getTime())) {
        return NextResponse.json({ error: 'Date placed in service must be a valid date' }, { status: 400 });
      }

      if (asset.businessUsePercent !== undefined && (typeof asset.businessUsePercent !== 'number'
        || !Number.isFinite(asset.businessUsePercent) || asset.businessUsePercent < 0 || asset.businessUsePercent > 100)) {
        return NextResponse.json(
          { error: 'Business use percentage must be between 0 and 100' },
          { status: 400 }
        );
      }
      if (!optionalString(asset.category, 100) || !optionalString(asset.method, 50)
        || !optionalBoolean(asset.section179Requested) || !optionalBoolean(asset.bonusEligible)) {
        return NextResponse.json({ error: 'Asset category, method and election flags have the wrong type' }, { status: 400 });
      }
      if ('listedEquipmentAnswer' in asset && normalizeListedEquipmentAnswer(asset.listedEquipmentAnswer) === 'invalid') {
        return NextResponse.json({ error: 'The equipment answer must be yes, no, or blank' }, { status: 400 });
      }
      if ('listedEquipmentReleaseAnswer' in asset && normalizeListedEquipmentAnswer(asset.listedEquipmentReleaseAnswer) === 'invalid') {
        return NextResponse.json({ error: 'The equipment release answer must be yes, no, or blank' }, { status: 400 });
      }
      if ('listedEquipmentKind' in asset && normalizeListedEquipmentKind(asset.listedEquipmentKind) === 'invalid') {
        return NextResponse.json({ error: 'The equipment kind must be photo, audio, video or communication gear, recreation or amusement gear, neither, or blank' }, { status: 400 });
      }
      if ('listedEquipmentMainLineOfWork' in asset && normalizeListedEquipmentAnswer(asset.listedEquipmentMainLineOfWork) === 'invalid') {
        return NextResponse.json({ error: 'The equipment main line of work answer must be yes, no, or blank' }, { status: 400 });
      }
      if ('listedEquipmentBusinessLocation' in asset && normalizeListedEquipmentAnswer(asset.listedEquipmentBusinessLocation) === 'invalid') {
        return NextResponse.json({ error: 'The equipment business location answer must be yes, no, or blank' }, { status: 400 });
      }
      if ('listedEquipmentLocationFollowUp' in asset && normalizeListedEquipmentLocation(asset.listedEquipmentLocationFollowUp) === 'invalid') {
        return NextResponse.json({ error: 'The equipment location must be outside the home, a home office, or blank' }, { status: 400 });
      }
    }

    // Save each asset
    const savedAssets = [];
    for (const asset of assets) {
      const listedEquipmentAnswer = normalizeListedEquipmentAnswer(asset.listedEquipmentAnswer);
      const listedEquipmentReleaseAnswer = normalizeListedEquipmentAnswer(asset.listedEquipmentReleaseAnswer);
      const listedEquipmentKind = normalizeListedEquipmentKind(asset.listedEquipmentKind);
      const listedEquipmentMainLineOfWork = normalizeListedEquipmentAnswer(asset.listedEquipmentMainLineOfWork);
      const listedEquipmentBusinessLocation = normalizeListedEquipmentAnswer(asset.listedEquipmentBusinessLocation);
      const listedEquipmentLocationFollowUp = normalizeListedEquipmentLocation(asset.listedEquipmentLocationFollowUp);
      const equipment = isEquipmentAssetCategory(asset.category);
      const yesNo = (value: 'yes' | 'no' | null | 'invalid') => value === 'yes' || value === 'no' ? value : null;
      const record = {
        description: asset.description,
        datePlacedInService: new Date(asset.datePlacedInService),
        cost: asset.cost,
        businessUsePercent: asset.businessUsePercent,
        category: asset.category,
        method: asset.method,
        section179Requested: asset.section179Requested,
        bonusEligible: asset.bonusEligible,
        ...(equipment && (listedEquipmentAnswer === 'yes' || listedEquipmentAnswer === 'no') ? { listedEquipmentAnswer } : {}),
        ...(equipment && (listedEquipmentReleaseAnswer === 'yes' || listedEquipmentReleaseAnswer === 'no') ? { listedEquipmentReleaseAnswer } : {}),
        ...(equipment && listedEquipmentKind && listedEquipmentKind !== 'invalid' ? { listedEquipmentKind } : {}),
        ...(equipment && yesNo(listedEquipmentMainLineOfWork) ? { listedEquipmentMainLineOfWork: yesNo(listedEquipmentMainLineOfWork) } : {}),
        ...(equipment && yesNo(listedEquipmentBusinessLocation) ? { listedEquipmentBusinessLocation: yesNo(listedEquipmentBusinessLocation) } : {}),
        ...(equipment && listedEquipmentLocationFollowUp && listedEquipmentLocationFollowUp !== 'invalid' ? { listedEquipmentLocationFollowUp } : {}),
      };
      const { data, error } = await saveAsset(user.uid, record);

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
        error: 'Failed to save assets'
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await readJsonObject(request);
    if (!body) return invalidJsonResponse();
    const { assetId } = body;
    if (typeof assetId !== 'string' || !assetId || assetId.length > 256 || /[\/\\\x00-\x1f\x7f]/.test(assetId)) {
      return NextResponse.json({ error: 'Asset ID is required' }, { status: 400 });
    }
    const touchesAnswer = Object.prototype.hasOwnProperty.call(body, 'listedEquipmentAnswer');
    const touchesRelease = Object.prototype.hasOwnProperty.call(body, 'listedEquipmentReleaseAnswer');
    const touchesKind = Object.prototype.hasOwnProperty.call(body, 'listedEquipmentKind');
    const touchesMainLine = Object.prototype.hasOwnProperty.call(body, 'listedEquipmentMainLineOfWork');
    const touchesLocation = Object.prototype.hasOwnProperty.call(body, 'listedEquipmentBusinessLocation');
    const touchesPlace = Object.prototype.hasOwnProperty.call(body, 'listedEquipmentLocationFollowUp');
    if (!touchesAnswer && !touchesRelease && !touchesKind && !touchesMainLine && !touchesLocation && !touchesPlace) {
      return NextResponse.json({ error: 'An equipment answer is required' }, { status: 400 });
    }
    const answer = touchesAnswer ? normalizeListedEquipmentAnswer(body.listedEquipmentAnswer) : null;
    const release = touchesRelease ? normalizeListedEquipmentAnswer(body.listedEquipmentReleaseAnswer) : null;
    const kind = touchesKind ? normalizeListedEquipmentKind(body.listedEquipmentKind) : null;
    const mainLine = touchesMainLine ? normalizeListedEquipmentAnswer(body.listedEquipmentMainLineOfWork) : null;
    const location = touchesLocation ? normalizeListedEquipmentAnswer(body.listedEquipmentBusinessLocation) : null;
    const place = touchesPlace ? normalizeListedEquipmentLocation(body.listedEquipmentLocationFollowUp) : null;
    if (answer === 'invalid') return NextResponse.json({ error: 'The equipment answer must be yes, no, or blank' }, { status: 400 });
    if (release === 'invalid') return NextResponse.json({ error: 'The equipment release answer must be yes, no, or blank' }, { status: 400 });
    if (kind === 'invalid') return NextResponse.json({ error: 'The equipment kind must be photo, audio, video or communication gear, recreation or amusement gear, neither, or blank' }, { status: 400 });
    if (mainLine === 'invalid') return NextResponse.json({ error: 'The equipment main line of work answer must be yes, no, or blank' }, { status: 400 });
    if (location === 'invalid') return NextResponse.json({ error: 'The equipment business location answer must be yes, no, or blank' }, { status: 400 });
    if (place === 'invalid') return NextResponse.json({ error: 'The equipment location must be outside the home, a home office, or blank' }, { status: 400 });
    const existing = await getAssetsSettings(user.uid);
    if (existing.error || !existing.data) return NextResponse.json({ error: 'Failed to load assets' }, { status: 500 });
    const current = existing.data.find(asset => asset.id === assetId);
    if (!current) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    if (!isEquipmentAssetCategory(current.category)) {
      return NextResponse.json({ error: 'The equipment question applies only to equipment' }, { status: 400 });
    }
    const stored = (value: 'yes' | 'no' | null) => value === 'yes' || value === 'no' ? value : null;
    const { data, error } = await updateAsset(user.uid, assetId, {
      ...(touchesAnswer ? { listedEquipmentAnswer: stored(answer) } : {}),
      ...(touchesRelease ? { listedEquipmentReleaseAnswer: stored(release) } : {}),
      ...(touchesKind ? { listedEquipmentKind: kind } : {}),
      ...(touchesMainLine ? { listedEquipmentMainLineOfWork: stored(mainLine) } : {}),
      ...(touchesLocation ? { listedEquipmentBusinessLocation: stored(location) } : {}),
      ...(touchesPlace ? { listedEquipmentLocationFollowUp: place } : {}),
    });
    if (error || !data) return NextResponse.json({ error: 'Failed to save the equipment answer' }, { status: 500 });
    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json({ error: 'Failed to save the equipment answer' }, { status: 500 });
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

    const body = await readJsonObject(request);
    if (!body) return invalidJsonResponse();
    const { assetId } = body;

    if (typeof assetId !== 'string' || !assetId || assetId.length > 256 || /[\/\\\x00-\x1f\x7f]/.test(assetId)) {
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
        error: 'Failed to delete asset'
      },
      { status: 500 }
    );
  }
}
