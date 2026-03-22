import type { Metadata } from "next";
import AboutUsPageClient from "./about-page-client";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "Learn about WriteOff — the AI-powered tax deduction tracker that helps freelancers and small business owners automatically find, categorize, and maximize tax savings.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About WriteOff | AI Tax Deduction Tracker",
    description:
      "AI-powered tax optimization for freelancers. Automatically categorize expenses, identify deductions, and generate tax reports.",
    type: "website",
    url: "/about",
  },
  twitter: {
    card: "summary_large_image",
    title: "About WriteOff | AI Tax Deduction Tracker",
    description:
      "AI-powered tax optimization for freelancers and small business owners.",
  },
};

export default function AboutPage() {
  return <AboutUsPageClient />;
}
