"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const HUB_PATH = "/protected?screen=tax-filing-hub";

/**
 * Redirects to the Tax Filing Hub screen.
 * The hub is rendered inside app/protected/page.tsx via ?screen=tax-filing-hub
 */
export default function FileTaxesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(HUB_PATH);
  }, [router]);
  return (
    <main className="min-h-screen flex items-center justify-center p-6 text-center" role="status" aria-live="polite">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Opening your tax filing hub…</p>
        <Link href={HUB_PATH} className="text-sm underline text-primary">
          Continue to the filing hub
        </Link>
      </div>
    </main>
  );
}
