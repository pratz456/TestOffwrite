import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  title: "WriteOff - AI Tax Deduction Tracker for Freelancers",
  description:
    "The first AI-powered tax autopilot that finds, categorizes, and tracks every business expense in real-time. Stop overpaying taxes.",
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "WriteOff",
            applicationCategory: "FinanceApplication",
            operatingSystem: "Web",
            description:
              "AI-powered tax autopilot that automatically finds, categorizes, and tracks every business expense in real-time.",
            url:
              process.env.NEXT_PUBLIC_SITE_URL || "https://writeoffapp.com",
            offers: {
              "@type": "Offer",
              price: "14.99",
              priceCurrency: "USD",
            },
          }),
        }}
      />
      <LandingPage />
    </>
  );
}
