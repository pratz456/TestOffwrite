"use client";

import { useAuth } from "@/lib/firebase/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Sends signed-in visitors from /welcome to the app.
 * Renders nothing so /welcome can still SSR HomeContent.
 */
export function WelcomeAuthRedirect() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (!loading && user && !hasRedirected.current) {
      hasRedirected.current = true;
      router.replace("/protected");
    }
    if (!user) {
      hasRedirected.current = false;
    }
  }, [user, loading, router]);

  return null;
}
