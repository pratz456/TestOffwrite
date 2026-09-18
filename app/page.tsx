import type { Metadata } from "next";
import { ReconciliationSite } from "@/components/reconciliation/reconciliation-site";

export const metadata: Metadata = {
  title: {
    absolute: "TableProof — Restaurant Vendor Statement Reconciliation",
  },
  description:
    "A browser-local validation prototype for matching redacted restaurant vendor statements to AP exports and producing traceable exception reports.",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "TableProof — Close vendor statements with evidence",
    description:
      "Match redacted CSVs locally, keep ambiguous rows open, and export a source-linked exception report.",
    type: "website",
  },
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
            name: "TableProof",
            applicationCategory: "FinanceApplication",
            operatingSystem: "Web",
            description:
              "Browser-local restaurant vendor statement reconciliation validation prototype.",
            url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
          }),
        }}
      />
      <ReconciliationSite />
    </>
  );
}
