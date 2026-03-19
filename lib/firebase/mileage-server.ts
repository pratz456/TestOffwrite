import { adminDb } from './admin';

export interface MileageTrip {
  id: string;
  userId: string;
  date: string;
  startLocation: string;
  endLocation: string;
  miles: number;
  businessPurpose: string;
  roundTrip: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateMileageTripInput {
  userId: string;
  date: string;
  startLocation: string;
  endLocation: string;
  miles: number;
  businessPurpose: string;
  roundTrip: boolean;
}

/**
 * Get all mileage trips for a user (current year by default)
 */
export async function getMileageTrips(
  userId: string,
  year?: number
): Promise<{ data: MileageTrip[]; error: any }> {
  try {
    const targetYear = year ?? new Date().getFullYear();
    const collectionRef = adminDb
      .collection('user_profiles')
      .doc(userId)
      .collection('mileage_trips');

    const querySnapshot = await collectionRef.get();

    const trips: MileageTrip[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      const tripDate = data.date ? new Date(data.date) : null;
      if (tripDate && tripDate.getFullYear() === targetYear) {
        trips.push({
          id: doc.id,
          userId: data.userId || userId,
          date: data.date || '',
          startLocation: data.startLocation || '',
          endLocation: data.endLocation || '',
          miles: data.miles ?? 0,
          businessPurpose: data.businessPurpose || '',
          roundTrip: data.roundTrip ?? false,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
          updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        });
      }
    });

    // Sort by date descending (newest first)
    trips.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return { data: trips, error: null };
  } catch (error) {
    console.error('❌ [Mileage Server] Error fetching trips:', error);
    return { data: [], error };
  }
}

/**
 * Create a new mileage trip
 */
export async function createMileageTrip(
  input: CreateMileageTripInput
): Promise<{ data: MileageTrip | null; error: any }> {
  try {
    const collectionRef = adminDb
      .collection('user_profiles')
      .doc(input.userId)
      .collection('mileage_trips');

    const docData = {
      userId: input.userId,
      date: input.date,
      startLocation: input.startLocation,
      endLocation: input.endLocation,
      miles: input.miles,
      businessPurpose: input.businessPurpose,
      roundTrip: input.roundTrip,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const docRef = await collectionRef.add(docData);

    const trip: MileageTrip = {
      id: docRef.id,
      ...input,
      createdAt: docData.createdAt,
      updatedAt: docData.updatedAt,
    };

    return { data: trip, error: null };
  } catch (error) {
    console.error('❌ [Mileage Server] Error creating trip:', error);
    return { data: null, error };
  }
}

/**
 * Delete a mileage trip
 */
export async function deleteMileageTrip(
  userId: string,
  tripId: string
): Promise<{ success: boolean; error: any }> {
  try {
    const docRef = adminDb
      .collection('user_profiles')
      .doc(userId)
      .collection('mileage_trips')
      .doc(tripId);

    await docRef.delete();
    return { success: true, error: null };
  } catch (error) {
    console.error('❌ [Mileage Server] Error deleting trip:', error);
    return { success: false, error };
  }
}
