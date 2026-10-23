import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { assignMileageTrips } from '@/lib/firebase/mileage-server';
import { getHomeOfficeSettings } from '@/lib/firebase/settings-server';
import { MILEAGE_VEHICLE_COPY, mileageVehicleCopyEnabled } from '@/lib/mileage/vehicle-copy';

const assignmentInput = z.object({
  userId: z.string().min(1),
  updates: z.array(z.object({
    tripId: z.string().min(1).max(200),
    vehicleId: z.string().trim().min(1).max(200).nullable(),
    tripType: z.enum(['business', 'commute', 'personal']).nullable(),
    homeDestination: z.enum(['regular_work', 'temporary_work', 'second_work']).nullable().optional(),
  }).strict()).min(1).max(200),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const parsed = assignmentInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: MILEAGE_VEHICLE_COPY.invalidSort }, { status: 400 });
    if (parsed.data.userId !== user.uid) return NextResponse.json({ error: 'Invalid or unauthorized userId' }, { status: 403 });
    if (!mileageVehicleCopyEnabled()) return NextResponse.json({ error: "Vehicle tracking isn't available yet" }, { status: 404 });
    const { data: homeOffice } = await getHomeOfficeSettings(parsed.data.userId);
    const { data, error } = await assignMileageTrips(parsed.data.userId, parsed.data.updates, homeOffice);
    if (error || !data) return NextResponse.json({ error: error?.message || MILEAGE_VEHICLE_COPY.sortFailed }, { status: error?.status || 500 });
    return NextResponse.json({ trips: data });
  } catch (error) {
    console.error('mileage assignment failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
