import type { Metadata } from "next";
import ContactSupportPageClient from "./contact-page-client";

export const metadata: Metadata = {
  title: "Contact Support",
  description:
    "Contact the WriteOff support team for account and product help. Email writeoffapp@gmail.com or use the contact form.",
  alternates: { canonical: "/contact" },
  openGraph: {
    title: "Contact Support | WriteOff",
    description:
      "Contact WriteOff for account and product support.",
    type: "website",
    url: "/contact",
  },
  twitter: {
    card: "summary",
    title: "Contact Support | WriteOff",
    description:
      "Get account and product help from the WriteOff support team.",
  },
};

export default function ContactPage() {
  return <ContactSupportPageClient />;
}
