"use client";

import { useRouter } from "next/navigation";
import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OfflinePage() {
  const router = useRouter();

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <WifiOff className="h-16 w-16 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold text-foreground">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Check your connection and try again. Some features need internet access.
      </p>
      <Button
        onClick={() => router.refresh()}
        variant="outline"
      >
        Try again
      </Button>
    </div>
  );
}
