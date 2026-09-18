import type { Metadata } from "next";

import { ReconciliationSite } from "@/components/reconciliation/reconciliation-site";

export const metadata: Metadata = {
  title: {
    absolute: "TableProof — Private Restaurant Reconciliation Pilot",
  },
  description:
    "Private validation prototype for browser-local restaurant vendor-statement reconciliation.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
  alternates: {
    canonical: "/pilot",
  },
};

export default function PilotPage() {
  return <ReconciliationSite />;
}
