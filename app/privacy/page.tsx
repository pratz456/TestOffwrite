import type { Metadata } from "next";
import PrivacyPolicyPageClient from "./privacy-page-client";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Read how WriteOff collects, uses, retains, shares, secures, and deletes account, financial, tax, and document data.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy Policy | WriteOff",
    description:
      "How WriteOff handles account, financial, tax, and document data.",
    type: "website",
    url: "/privacy",
  },
  twitter: {
    card: "summary",
    title: "Privacy Policy | WriteOff",
    description:
      "How WriteOff protects your personal and financial data.",
  },
};

export default function PrivacyPage() {
  return <PrivacyPolicyPageClient />;
}
