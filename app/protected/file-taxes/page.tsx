"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Redirects to the Tax Filing Hub screen.
 * The hub is rendered inside app/protected/page.tsx via ?screen=tax-filing-hub
 */
export default function FileTaxesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/protected?screen=tax-filing-hub");
  }, [router]);
  return null;
}
