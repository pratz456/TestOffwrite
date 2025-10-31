import { NextRequest } from 'next/server';
import { adminAuth } from './admin';

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

export async function getAuthenticatedUser(request: NextRequest): Promise<{
  user: AuthenticatedUser | null;
  error: string | null;
}> {
  try {
    let token: string | null = null;
    
    // Try to get token from Authorization header first
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
    
    // Fallback to cookie if no Authorization header
    if (!token) {
      token = request.cookies.get('firebase-auth-token')?.value || null;
    }
    
    if (!token) {
      return { user: null, error: 'No authentication token found' };
    }
    
    // Verify the token with Firebase Admin
    const decodedToken = await adminAuth.verifyIdToken(token);
    
    return {
      user: {
        uid: decodedToken.uid,
        email: decodedToken.email || null,
        emailVerified: decodedToken.email_verified || false,
      },
      error: null,
    };
  } catch (error) {
    console.error('Error verifying auth token:', error);
    return { user: null, error: 'Invalid or expired token' };
  }
}

// Helper function for client-side to set auth header
export function createAuthHeaders(idToken: string): HeadersInit {
  return {
    'Authorization': `Bearer ${idToken}`,
    'Content-Type': 'application/json',
  };
}
