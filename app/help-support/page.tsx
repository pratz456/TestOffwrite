import type { Metadata } from "next";
import HelpSupportPageClient from "./help-support-page-client";

export const metadata: Metadata = {
  title: "Help & Support",
  description:
    "Get started with WriteOff, connect your bank, generate reports, and find answers to common questions about AI-powered tax deduction tracking.",
  alternates: { canonical: "/help-support" },
  openGraph: {
    title: "Help & Support | WriteOff",
    description:
      "Guides and support resources for WriteOff — AI tax deduction tracking for freelancers.",
    type: "website",
    url: "/help-support",
  },
  twitter: {
    card: "summary",
    title: "Help & Support | WriteOff",
    description:
      "Get started with WriteOff and find answers to common questions.",
  },
};

export default function HelpSupportPage() {
  return <HelpSupportPageClient />;
}
