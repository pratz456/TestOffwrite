// This file is deprecated - use lib/firebase/profiles.ts instead
import { getUserProfile as getFirebaseProfile, upsertUserProfile as upsertFirebaseProfile } from '@/lib/firebase/profiles';

export async function getProfile(userId: string) {
  return await getFirebaseProfile(userId);
}

export async function createProfile(userId: string, profileData: any) {
  return await upsertFirebaseProfile(userId, profileData);
}

export async function updateProfile(userId: string, updates: any) {
  return await upsertFirebaseProfile(userId, updates);
}

// Export aliases for backward compatibility (removed to prevent naming conflicts)
// Use the Firebase functions directly: import { getUserProfile, upsertUserProfile } from '@/lib/firebase/profiles';