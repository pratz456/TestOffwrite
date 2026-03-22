import type { Metadata } from "next";
import { TaxCalculator1099Client } from "./1099-tax-calculator-client";

export const metadata: Metadata = {
  title: "Free 1099 Tax Calculator (2025) — Federal + SE Tax Estimate",
  description:
    "Calculate your total federal tax bill as a 1099 contractor or freelancer. See income tax, self-employment tax, QBI deduction, and effective rate — free, no sign-up required.",
  alternates: { canonical: "/tools/1099-tax-calculator" },
  openGraph: {
    title: "Free 1099 Tax Calculator (2025) | WriteOff",
    description:
      "Estimate your total federal tax as a freelancer — income tax, SE tax, QBI deduction, and effective rate.",
    type: "website",
    url: "/tools/1099-tax-calculator",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free 1099 Tax Calculator (2025)",
    description:
      "Estimate your total 1099 tax — income tax, self-employment tax, QBI deduction, and effective rate.",
  },
};

const calculatorJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "1099 Tax Calculator",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  description:
    "Free 2025 tax calculator for 1099 contractors and freelancers. Calculates federal income tax, self-employment tax, QBI deduction, standard deduction, and effective tax rate.",
  url: "https://writeoffapp.com/tools/1099-tax-calculator",
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
      <TaxCalculator1099Client />
    </>
  );
}
