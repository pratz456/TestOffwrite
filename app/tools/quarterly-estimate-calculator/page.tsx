import type { Metadata } from "next";
import { QuarterlyEstimateClient } from "./quarterly-estimate-client";

export const metadata: Metadata = {
  title: "Federal Quarterly Payment Planning (2026)",
  description:
    "Compare regular federal installment targets using reviewed annual tax, prior-year AGI and withholding. Includes explicit review requirements.",
  alternates: { canonical: "/tools/quarterly-estimate-calculator" },
  openGraph: {
    title: "Federal Quarterly Payment Planning (2026) | WriteOff",
    description:
      "Compare regular federal payment methods with reviewed tax inputs and clear calculation limits.",
    type: "website",
    url: "/tools/quarterly-estimate-calculator",
  },
  twitter: {
    card: "summary_large_image",
    title: "Federal Quarterly Payment Planning (2026)",
    description:
      "Plan regular federal installments using reviewed annual tax and withholding.",
  },
};

const calculatorJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Quarterly Estimated Tax Calculator",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  description:
    "Federal regular-method payment illustration using reviewed tax and withholding inputs. Does not calculate a tax return or determine penalties.",
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
