"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production only.
 * Mount once in the root layout so every page load registers the SW.
 */
export function PwaRegisterSw() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          if (registration.waiting) {
            // New content available; optional: prompt user to refresh
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
          }
        })
        .catch((err) => {
          console.warn("Service worker registration failed:", err);
        });
    };

    window.addEventListener("load", register);

    // Optional: reload when a new service worker takes control
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });

    return () => {
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
