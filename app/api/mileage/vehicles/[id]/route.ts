import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { saveUserVehicle } from '@/lib/firebase/vehicle-server';
import { MILEAGE_VEHICLE_COPY } from '@/lib/mileage/vehicle-copy';
import type { VehiclePatch } from '@/lib/mileage/vehicles';

const yesNo = z.enum(['yes', 'no']).nullable();
const patchInput = z.object({
  userId: z.string().min(1),
  taxYear: z.number().int().min(2000).max(2100).optional(),
  name: z.string().trim().min(1).max(80).optional(),
  method: z.enum(['standard_mileage', 'actual_expense', 'unset']).optional(),
  ownership: z.enum(['owned', 'leased', 'not_answered']).optional(),
  datePlacedInService: z.string().optional(),
  dateDisposed: z.string().optional(),
  dateConvertedToBusiness: z.string().optional(),
  methodEffectiveDate: z.string().optional(),
  odometerStart: z.number().finite().nonnegative().nullable().optional(),
  odometerEnd: z.number().finite().nonnegative().nullable().optional(),
  partIV: z.object({
    offDutyPersonalUse: yesNo.optional(),
    otherVehicleForPersonalUse: yesNo.optional(),
    hasEvidence: yesNo.optional(),
    evidenceWritten: yesNo.optional(),
  }).strict().optional(),
}).strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Vehicle id required' }, { status: 400 });
    const parsed = patchInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: MILEAGE_VEHICLE_COPY.invalidVehicleUpdate }, { status: 400 });
    if (parsed.data.userId !== user.uid) return NextResponse.json({ error: 'Invalid or unauthorized userId' }, { status: 403 });
    const { userId, ...patch } = parsed.data;
    const { data, error } = await saveUserVehicle(userId, id, patch as VehiclePatch);
    if (error || !data) return NextResponse.json({ error: error?.message || MILEAGE_VEHICLE_COPY.saveFailed }, { status: error?.status || 500 });
    return NextResponse.json({ vehicle: data });
  } catch (error) {
    console.error('vehicle update failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
