import type { Metadata } from "next";
import { ProtectedLayoutClient } from "@/components/protected-layout-client";
import { unreleasedScreensEnabled } from "@/lib/features/unreleased-screens";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ProtectedLayoutClient showUnreleasedScreens={unreleasedScreensEnabled()}>{children}</ProtectedLayoutClient>;
}
