import type { Metadata } from "next";
import { QuarterlyEstimateClient } from "./quarterly-estimate-client";

export const metadata: Metadata = {
  title: "Free Quarterly Estimated Tax Calculator (2025)",
  description:
    "Calculate your quarterly estimated tax payments for 2025. See how much to pay each quarter to avoid IRS underpayment penalties. Free tool for freelancers and 1099 contractors.",
  alternates: { canonical: "/tools/quarterly-estimate-calculator" },
  openGraph: {
    title: "Free Quarterly Estimated Tax Calculator (2025) | WriteOff",
    description:
      "Calculate how much to pay in quarterly estimated taxes to avoid IRS penalties. Free for freelancers.",
    type: "website",
    url: "/tools/quarterly-estimate-calculator",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Quarterly Estimated Tax Calculator (2025)",
    description:
      "Calculate your quarterly estimated tax payments — avoid IRS underpayment penalties.",
  },
};

const calculatorJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Quarterly Estimated Tax Calculator",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  description:
    "Free 2025 quarterly estimated tax calculator. Determines quarterly payment amounts based on projected income, expenses, and filing status to help freelancers avoid IRS underpayment penalties.",
  url: "https://writeoffapp.com/tools/quarterly-estimate-calculator",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  creator: { "@type": "Organization", name: "WriteOff", url: "https://writeoffapp.com" },
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(calculatorJsonLd) }}
      />
      <QuarterlyEstimateClient />
    </>
  );
}
