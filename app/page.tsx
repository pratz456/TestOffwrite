"use client";

import { HomeContent } from "@/components/home-content";
import { useAuth } from "@/lib/firebase/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const hasRedirected = useRef(false);

  // Redirect authenticated users from root to /protected
  useEffect(() => {
    if (!loading && user && !hasRedirected.current) {
      hasRedirected.current = true;
      console.log('[HomePage] User is logged in, redirecting to /protected');
      router.replace('/protected');
    }
    // Reset redirect flag if user becomes unauthenticated
    if (!user) {
      hasRedirected.current = false;
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Show loading state while redirecting authenticated user
  if (user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  return <HomeContent />;
}
