import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import {
  getMileageTrips,
  createMileageTrip,
  type MileageTrip,
} from '@/lib/firebase/mileage-server';

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || user.uid;
    const year = searchParams.get('year')
      ? parseInt(searchParams.get('year')!, 10)
      : undefined;

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

    const body = await request.json();
    const {
      userId,
      date,
      startLocation,
      endLocation,
      miles,
      businessPurpose,
      roundTrip,
    } = body;

    if (!userId || userId !== user.uid) {
      return NextResponse.json(
        { error: 'Invalid or unauthorized userId' },
        { status: 400 }
      );
    }

    if (!date || !startLocation || !endLocation || miles == null) {
      return NextResponse.json(
        { error: 'Missing required fields: date, startLocation, endLocation, miles' },
        { status: 400 }
      );
    }

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
