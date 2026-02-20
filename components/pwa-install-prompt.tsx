"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

const DISMISS_KEY = "writeoff-pwa-install-dismissed";

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);

    if (standalone) return;

    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed === "true") return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handler as EventListener);
    return () => window.removeEventListener("beforeinstallprompt", handler as EventListener);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setDeferredPrompt(null);
    localStorage.setItem(DISMISS_KEY, "true");
  };

  if (!showBanner || isStandalone) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-lg border border-border bg-card p-4 shadow-lg sm:left-auto"
      role="region"
      aria-label="Install app"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="font-medium text-foreground">Install WriteOff</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add to your home screen for quick access and a better experience.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={handleInstall} className="flex-1">
          Add to Home Screen
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDismiss}>
          Not now
        </Button>
      </div>
    </div>
  );
}
