"use client";

import { HomeContent } from "@/components/home-content";
import { useAuth } from "@/lib/firebase/auth-context";
import { getWelcomeView } from "@/lib/welcome-view-state";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export default function WelcomePage() {
  const { user } = useAuth();
  const router = useRouter();
  const hasRedirected = useRef(false);
  const view = getWelcomeView(user);

  // Authenticated visitors go into the product. Do not wait on auth `loading`
  // or this page prerenders/hangs as a spinner (live /welcome).
  useEffect(() => {
    if (user && !hasRedirected.current) {
      hasRedirected.current = true;
      router.replace("/protected");
    }
    if (!user) {
      hasRedirected.current = false;
    }
  }, [user, router]);

  if (view === "redirecting") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto" />
          <p className="text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  return <HomeContent />;
}
