/**
 * Maps Firebase authentication error codes to user-friendly messages
 */

export interface AuthError {
  code: string;
  message: string;
}

export function getAuthErrorMessage(errorCode: string): string {
  const errorMessages: Record<string, string> = {
    // Authentication errors
    'auth/invalid-credential': 'Invalid email or password. Please try again.',
    'auth/user-not-found': 'No account found with this email address.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/weak-password': 'Password is too weak. Please use a stronger password.',
    'auth/too-many-requests': 'Too many failed attempts. Please try again later or reset your password.',
    'auth/network-request-failed': 'Network error. Please check your connection and try again.',
    'auth/user-disabled': 'This account has been disabled. Please contact support.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled. Please contact support.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/user-mismatch': 'The provided credentials do not match any existing account.',
    'auth/requires-recent-login': 'This operation requires recent authentication. Please sign in again.',
    'auth/credential-already-in-use': 'This credential is already associated with another account.',
    
    // Email verification errors
    'auth/email-not-verified': 'Please verify your email before signing in. Check your inbox for a verification link.',
    
    // Password reset errors
    'auth/invalid-action-code': 'The password reset link is invalid or has expired.',
    'auth/expired-action-code': 'The password reset link has expired. Please request a new one.',
    'auth/invalid-verification-code': 'The verification code is invalid.',
    'auth/invalid-verification-id': 'The verification ID is invalid.',
    
    // Account linking errors
    'auth/provider-already-linked': 'This account is already linked to another provider.',
    'auth/no-such-provider': 'This provider is not available.',
    'auth/account-exists-with-different-credential': 'An account already exists with the same email but different sign-in method.',
    
    // App errors
    'auth/app-not-authorized': 'This app is not authorized to use Firebase Authentication.',
    'auth/keychain-error': 'A keychain error occurred. Please try again.',
    'auth/internal-error': 'An internal error occurred. Please try again later.',
    'auth/invalid-user-token': 'Your session has expired. Please sign in again.',
    'auth/user-token-expired': 'Your session has expired. Please sign in again.',
    
    // Rate limiting (duplicate key removed, kept original above)
    'auth/quota-exceeded': 'Service quota exceeded. Please try again later.',
    
    // Default fallback
    'auth/unknown': 'An unexpected error occurred. Please try again.',
  };

  return errorMessages[errorCode] || errorMessages['auth/unknown'];
}

/**
 * Creates a user-friendly error object from Firebase error
 */
export function createAuthError(firebaseError: any): AuthError {
  const code = firebaseError?.code || 'auth/unknown';
  const message = getAuthErrorMessage(code);
  
  return {
    code,
    message
  };
}

/**
 * Logs authentication errors for debugging (development only)
 */
export function logAuthError(context: string, error: any): void {
  if (process.env.NODE_ENV === 'development') {
    console.error(`[${context}] Firebase Auth Error:`, {
      code: error?.code,
      message: error?.message,
      stack: error?.stack
    });
  }
}
