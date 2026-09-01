"use client";

import { useAuth } from "@/lib/firebase/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Sends signed-in visitors from /welcome to /protected.
 * Renders nothing so the server page can still SSR HomeContent.
 */
export function WelcomeAuthRedirect() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (loading || !user || hasRedirected.current) return;
    hasRedirected.current = true;
    router.replace("/protected");
  }, [user, loading, router]);

  return null;
}
