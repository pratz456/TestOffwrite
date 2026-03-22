import type { Metadata } from "next";
import { SETaxCalculatorClient } from "./se-tax-calculator-client";

export const metadata: Metadata = {
  title: "Free Self-Employment Tax Calculator (2025)",
  description:
    "Calculate your self-employment tax for 2025 instantly. See Social Security tax (12.4%), Medicare tax (2.9%), and your deductible half of SE tax. Free tool for freelancers and 1099 contractors.",
  alternates: { canonical: "/tools/se-tax-calculator" },
  openGraph: {
    title: "Free Self-Employment Tax Calculator (2025) | WriteOff",
    description:
      "Instantly calculate your self-employment tax. See Social Security, Medicare, and deductible amounts for freelancers and 1099 contractors.",
    type: "website",
    url: "/tools/se-tax-calculator",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Self-Employment Tax Calculator (2025)",
    description:
      "Calculate your self-employment tax instantly — Social Security, Medicare, and deductible amounts.",
  },
};

const calculatorJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Self-Employment Tax Calculator",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  description:
    "Free 2025 self-employment tax calculator for freelancers, contractors, and sole proprietors. Calculates Social Security tax, Medicare tax, additional Medicare tax, and the deductible half of SE tax.",
  url: "https://writeoffapp.com/tools/se-tax-calculator",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  creator: {
    "@type": "Organization",
    name: "WriteOff",
    url: "https://writeoffapp.com",
  },
};

export default function SETaxCalculatorPage() {
  return (
    <>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(calculatorJsonLd) }}
      />
      <SETaxCalculatorClient />
    </>
  );
}
