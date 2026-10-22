import type { Metadata } from "next";
import { GigMileageGapCalculatorClient } from "./gig-mileage-gap-calculator-client";
import { GIG_MILEAGE_GAP_COPY as copy } from "@/lib/tools/gig-mileage-gap-copy";

export const metadata: Metadata = {
  title: copy.title,
  description: copy.metaDescription,
  alternates: { canonical: copy.canonicalPath },
  openGraph: {
    title: copy.ogTitle,
    description: copy.ogDescription,
    type: "website",
    url: copy.canonicalPath,
    siteName: copy.siteName,
    images: [{ url: "/writeofflogo.png", alt: copy.ogImageAlt }],
  },
  twitter: {
    card: "summary_large_image",
    title: copy.twitterTitle,
    description: copy.twitterDescription,
    images: ["/writeofflogo.png"],
  },
};

const calculatorJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: copy.jsonLdName,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  description: copy.jsonLdDescription,
  url: copy.pageUrl,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  creator: {
    "@type": "Organization",
    name: copy.siteName,
    url: copy.siteUrl,
  },
};

export default function GigMileageGapCalculatorPage() {
  return (
    <>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(calculatorJsonLd) }}
      />
      <GigMileageGapCalculatorClient />
    </>
  );
}
