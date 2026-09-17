import type { Metadata } from "next";
import HelpPageClient from "./help-page-client";
import { faqData } from "@/lib/content/faq";

export const metadata: Metadata = {
  title: "Help Center",
  description:
    "Get help with WriteOff  - FAQs, tutorials, bank connection guides, receipt scanning tips, tax report help, and contact support for freelancer tax deductions.",
  alternates: { canonical: "/help" },
  openGraph: {
    title: "Help Center | WriteOff",
    description:
      "FAQs, tutorials, and support for WriteOff  - the expense and deduction records app for freelancers.",
    type: "website",
    url: "/help",
  },
  twitter: {
    card: "summary",
    title: "Help Center | WriteOff",
    description:
      "Find answers, tutorials, and support for WriteOff.",
  },
};

// The FAQ structured data mirrors the reviewed landing-page FAQ so search snippets never carry stale claims.
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqData.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
};

export default function HelpPage() {
  return (
    <>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <HelpPageClient />
    </>
  );
}
