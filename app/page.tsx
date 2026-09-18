import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  title: "WriteOff - Expense and Receipt Tracking for Freelancers",
  description:
    "Organize business expenses, review receipts, and export records for your tax preparer. Start with manual entry, with no bank connection required.",
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
              "Business expense and receipt tracking with record exports and supported federal planning estimates. In-app filing is not currently available.",
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
