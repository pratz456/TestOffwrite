import type { Metadata } from "next";
import ContactSupportPageClient from "./contact-page-client";

export const metadata: Metadata = {
  title: "Contact Support",
  description:
    "Get in touch with the WriteOff support team. We respond within 24 hours on business days. Email us at writeoffapp@gmail.com or use our contact form.",
  alternates: { canonical: "/contact" },
  openGraph: {
    title: "Contact Support | WriteOff",
    description:
      "Need help with WriteOff? Our support team responds within 24 hours on business days.",
    type: "website",
    url: "/contact",
  },
  twitter: {
    card: "summary",
    title: "Contact Support | WriteOff",
    description:
      "Get help from the WriteOff support team — we respond within 24 hours.",
  },
};

export default function ContactPage() {
  return <ContactSupportPageClient />;
}
