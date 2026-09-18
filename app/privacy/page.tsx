import type { Metadata } from "next";
import PrivacyPolicyPageClient from "./privacy-page-client";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Read WriteOff's privacy policy. Learn how we protect your personal and financial data with encryption, GLBA safeguards, and read-only Plaid bank connections.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy Policy | WriteOff",
    description:
      "How WriteOff protects your financial data with encryption and GLBA safeguards.",
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
