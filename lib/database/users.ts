// This file is deprecated - use lib/firebase/auth.ts instead
import { getCurrentUser, signInUser, signUpUser, signOutUser } from '@/lib/firebase/auth';

export async function getUser() {
  return await getCurrentUser();
}

// Export stubs for backward compatibility
export async function checkUserExists() { 
  throw new Error('Use Firebase Auth directly'); 
}
export async function createUser() { 
  throw new Error('Use Firebase Auth directly'); 
}
export async function updateUser() { 
  throw new Error('Use Firebase Auth directly'); 
}