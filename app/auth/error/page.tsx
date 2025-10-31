"use client";

import { useSearchParams, useRouter } from 'next/navigation';
import { XCircle, ArrowLeft, Home } from 'lucide-react';
import { Suspense } from 'react';

function AuthErrorPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const error = searchParams.get('error');

  const getErrorMessage = (errorCode: string | null) => {
    switch (errorCode) {
      case 'No token hash or type':
        return 'The confirmation link is invalid or has expired. Please try signing up again.';
      case 'Invalid email or password':
        return 'The email or password you entered is incorrect. Please try again.';
      case 'Email not confirmed':
        return 'Please check your email and click the confirmation link to verify your account.';
      default:
        return 'An authentication error occurred. Please try again.';
    }
  };

  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg border border-border p-8">
          <div className="text-center">
            <XCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
            <h1 className="text-2xl font-medium text-foreground mb-2">
              Authentication Error
            </h1>
            <p className="text-muted-foreground mb-6">
              {getErrorMessage(error)}
            </p>
            
            {error && (
              <div className="bg-red-50 rounded-lg p-3 mb-6 border border-red-200">
                <p className="text-sm text-red-700">
                  Error code: {error}
                </p>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={() => router.push('/auth/sign-up')}
                className="w-full bg-primary text-white py-3 px-4 rounded-lg hover:bg-primary-hover transition-colors flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Try Signing Up Again
              </button>
              
              <button
                onClick={() => router.push('/auth/login')}
                className="w-full bg-muted text-foreground py-3 px-4 rounded-lg hover:bg-muted/80 transition-colors flex items-center justify-center gap-2"
              >
                Sign In Instead
              </button>
              
              <button
                onClick={() => router.push('/')}
                className="w-full bg-white text-muted-foreground py-3 px-4 rounded-lg hover:bg-muted transition-colors flex items-center justify-center gap-2 border border-border"
              >
                <Home className="w-4 h-4" />
                Go to Home
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <AuthErrorPageContent />
    </Suspense>
  );
}
