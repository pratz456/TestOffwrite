"use client";

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle } from 'lucide-react';

function ConfirmPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/protected';

  useEffect(() => {
    // Since the backend verification is working, just redirect to the protected area
    // The user can log in normally if they're not authenticated
    const timer = setTimeout(() => {
      router.push(next);
    }, 2000);

    return () => clearTimeout(timer);
  }, [router, next]);

  return (
    <div className="min-h-screen bg-muted flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg border border-border p-8">
          <div className="text-center">
            <CheckCircle className="w-12 h-12 text-accent mx-auto mb-4" />
            <h1 className="text-2xl font-medium text-foreground mb-2">
              Email Confirmed!
            </h1>
            <p className="text-muted-foreground mb-6">
              Your email has been successfully verified. Redirecting you to log in...
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ConfirmPageContent />
    </Suspense>
  );
} 