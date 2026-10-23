import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { addUserVehicle, ensureUserVehicles } from '@/lib/firebase/vehicle-server';
import { MILEAGE_VEHICLE_COPY, mileageVehicleCopyEnabled } from '@/lib/mileage/vehicle-copy';

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = new URL(request.url).searchParams.get('userId') || user.uid;
    if (userId !== user.uid) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!mileageVehicleCopyEnabled()) return NextResponse.json({ error: 'Internal server error' }, { status: 400 });
    const { data, error } = await ensureUserVehicles(userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ vehicles: data });
  } catch (error) {
    console.error('vehicle list failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => null);
    const userId = body && typeof body.userId === 'string' ? body.userId : '';
    if (!userId || userId !== user.uid) return NextResponse.json({ error: 'Invalid or unauthorized userId' }, { status: userId ? 403 : 400 });
    if (!mileageVehicleCopyEnabled()) return NextResponse.json({ error: 'Internal server error' }, { status: 400 });
    const { data, error } = await addUserVehicle(userId);
    if (error || !data) return NextResponse.json({ error: error?.message || MILEAGE_VEHICLE_COPY.addFailed }, { status: error?.status || 500 });
    return NextResponse.json({ vehicle: data });
  } catch (error) {
    console.error('vehicle add failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
