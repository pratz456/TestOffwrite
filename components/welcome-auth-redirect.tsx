"use client";

import { useAuth } from "@/lib/firebase/auth-context";
import { APP_SHELL_PATH } from "@/lib/auth-routes";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Client-only gate: signed-in users leave /welcome for the app shell.
 * Does not block SSR — signed-out visitors keep the welcome content.
 */
export function WelcomeAuthRedirect() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (loading || !user || hasRedirected.current) return;
    hasRedirected.current = true;
    router.replace(APP_SHELL_PATH);
  }, [user, loading, router]);

  return null;
}
