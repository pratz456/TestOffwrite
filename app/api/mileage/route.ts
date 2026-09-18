import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import {
  getMileageTrips,
  createMileageTrip,
} from '@/lib/firebase/mileage-server';

const mileageInput = z.object({
  userId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value),
  startLocation: z.string().trim().min(1).max(500), endLocation: z.string().trim().min(1).max(500),
  miles: z.union([z.number(), z.string().trim().min(1)]).transform(Number).pipe(z.number().finite().positive()),
  businessPurpose: z.string().trim().max(2000).default(''), roundTrip: z.boolean().default(false),
});

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || user.uid;
    const yearParam = searchParams.get('year');
    const year = yearParam === null ? undefined : Number(yearParam);
    if (year !== undefined && (!Number.isInteger(year) || year < 2000 || year > 2100)) {
      return NextResponse.json({ error: 'Provide a valid tax year.' }, { status: 400 });
    }

    // Ensure user can only fetch their own trips
    if (userId !== user.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: trips, error } = await getMileageTrips(userId, year);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch mileage trips' },
        { status: 500 }
      );
    }

    return NextResponse.json(trips);
  } catch (error) {
    console.error('Error in mileage GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = mileageInput.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Provide valid locations, a date (YYYY-MM-DD), and positive finite miles.' }, { status: 400 });
    const { userId, date, startLocation, endLocation, miles, businessPurpose, roundTrip } = parsed.data;
    if (userId !== user.uid) return NextResponse.json({ error: 'Invalid or unauthorized userId' }, { status: 403 });

    const { data: trip, error } = await createMileageTrip({
      userId,
      date,
      startLocation: startLocation || '',
      endLocation: endLocation || '',
      miles: Number(miles),
      businessPurpose: businessPurpose || '',
      roundTrip: Boolean(roundTrip),
    });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to create mileage trip' },
        { status: 500 }
      );
    }

    return NextResponse.json(trip);
  } catch (error) {
    console.error('Error in mileage POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
