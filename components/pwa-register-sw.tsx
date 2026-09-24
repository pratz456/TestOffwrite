"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Registers the service worker in production only.
 * A waiting update activates only when the user chooses to refresh. Never
 * discard bank consent, review decisions or form edits on a background event.
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

    const serviceWorker = navigator.serviceWorker;
    const toastId = "writeoff-service-worker-update";
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    let refreshRequested = false;
    let reloaded = false;
    let offered = false;
    let controlled = Boolean(serviceWorker.controller);
    const reload = () => {
      if (disposed || reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    const offerUpdate = () => {
      if (disposed || offered) return;
      offered = true;
      toast.info("WriteOff update ready", {
        id: toastId, duration: Infinity,
        description: "Finish what you're doing, then refresh.",
        action: { label: "Refresh", onClick: () => {
          if (disposed || refreshRequested) return;
          refreshRequested = true;
          if (registration?.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
          else reload(); // Another tab may already have activated this update.
        } },
      });
    };
    const checkWaiting = () => {
      if (registration?.waiting && serviceWorker.controller) offerUpdate();
    };
    const watchInstalling = () => {
      installing?.removeEventListener("statechange", checkWaiting);
      installing = registration?.installing || null;
      installing?.addEventListener("statechange", checkWaiting);
      checkWaiting();
    };
    const controllerChanged = () => {
      const wasControlled = controlled;
      controlled = Boolean(serviceWorker.controller);
      if (refreshRequested) reload();
      else if (wasControlled) offerUpdate();
    };
    const register = () => {
      serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((value) => {
          if (disposed) return;
          registration = value;
          registration.addEventListener("updatefound", watchInstalling);
          watchInstalling();
        })
        .catch((err) => {
          console.warn("Service worker registration failed:", err);
        });
    };

    serviceWorker.addEventListener("controllerchange", controllerChanged);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      disposed = true;
      window.removeEventListener("load", register);
      serviceWorker.removeEventListener("controllerchange", controllerChanged);
      registration?.removeEventListener("updatefound", watchInstalling);
      installing?.removeEventListener("statechange", checkWaiting);
      toast.dismiss(toastId);
    };
  }, []);

  return null;
}
