import type { Metadata } from "next";
import TermsPageClient from "./terms-page-client";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms for using WriteOff: expense and receipt organization, planning estimates and records exports for self-employed people. WriteOff does not prepare or file tax returns.",
  alternates: { canonical: "/terms" },
  openGraph: {
    title: "Terms of Service | WriteOff",
    description: "Terms for using WriteOff's records organization and planning tools.",
    type: "website",
    url: "/terms",
  },
  twitter: {
    card: "summary",
    title: "Terms of Service | WriteOff",
    description: "Terms for using WriteOff's records organization and planning tools.",
  },
};

export default function TermsPage() {
  return <TermsPageClient />;
}
