import type { Metadata } from "next";
import AboutUsPageClient from "./about-page-client";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "Learn about WriteOff  - the expense and deduction records app that helps freelancers and small business owners organize receipts, review suggested deductions, and hand clean records to a tax preparer.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About WriteOff | Expense and Tax Records",
    description:
      "Expense and deduction records for freelancers. Organize receipts, review suggested deductions, and export Schedule C summaries for preparer review.",
    type: "website",
    url: "/about",
  },
  twitter: {
    card: "summary_large_image",
    title: "About WriteOff | Expense and Tax Records",
    description:
      "Expense and deduction records for freelancers and small business owners.",
  },
};

export default function AboutPage() {
  return <AboutUsPageClient />;
}
