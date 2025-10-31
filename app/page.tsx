"use client";

import { HomeContent } from "@/components/home-content";
import { useAuth } from "@/lib/firebase/auth-context";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    console.log('[HomePage] Auth state:', { user: !!user, loading, userId: user?.id });
    if (!loading && user) {
      console.log('[HomePage] User is logged in, redirecting to /protected');
      // User is logged in, redirect to protected page where profile setup will be handled
      router.push('/protected');
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

  return <HomeContent />;
}
