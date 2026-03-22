import type { Metadata } from "next";
import HelpPageClient from "./help-page-client";

export const metadata: Metadata = {
  title: "Help Center",
  description:
    "Get help with WriteOff — FAQs, tutorials, bank connection guides, receipt scanning tips, tax report help, and contact support for freelancer tax deductions.",
  alternates: { canonical: "/help" },
  openGraph: {
    title: "Help Center | WriteOff",
    description:
      "FAQs, tutorials, and support for WriteOff — the AI tax deduction tracker for freelancers.",
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

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is WriteOff?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "WriteOff is an AI-powered tax optimization platform that helps professionals and small business owners automatically categorize expenses, identify tax-deductible items, and generate comprehensive tax reports to maximize their tax savings.",
      },
    },
    {
      "@type": "Question",
      name: "How does WriteOff work?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "WriteOff connects to your bank accounts securely through Plaid, automatically categorizes your transactions using AI, identifies potential tax deductions, and generates detailed reports for tax filing. You can also manually review and adjust categorizations.",
      },
    },
    {
      "@type": "Question",
      name: "Is my financial data secure?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, absolutely. We use bank-level security with end-to-end encryption, secure connections through Plaid, and never store your banking credentials. All data is encrypted and protected by industry-standard security measures.",
      },
    },
    {
      "@type": "Question",
      name: "Which banks does WriteOff support?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "WriteOff supports thousands of banks and credit unions through our Plaid integration, including major banks like Chase, Bank of America, Wells Fargo, and many regional and online banks.",
      },
    },
    {
      "@type": "Question",
      name: "How accurate is the AI categorization?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Our AI achieves over 90% accuracy in expense categorization. The system learns from your corrections and improves over time. You can always manually review and adjust any categorizations.",
      },
    },
    {
      "@type": "Question",
      name: "What types of expenses can I track?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "You can track all types of business expenses including office supplies, travel, meals, equipment, software subscriptions, professional development, and more. The system automatically identifies which expenses are tax-deductible.",
      },
    },
    {
      "@type": "Question",
      name: "Can I upload receipts?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes! You can upload receipts and invoices directly to WriteOff. Our AI will extract key information like amounts, dates, and merchants to help with expense tracking and categorization.",
      },
    },
    {
      "@type": "Question",
      name: "What tax reports does WriteOff generate?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "WriteOff generates comprehensive reports including Schedule C summaries, expense breakdowns by category, monthly and yearly summaries, and detailed analytics to help you maximize your tax deductions.",
      },
    },
    {
      "@type": "Question",
      name: "Is WriteOff suitable for my business type?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "WriteOff is designed for freelancers, consultants, small business owners, and professionals who want to optimize their tax situation. It works with various business structures and filing statuses.",
      },
    },
    {
      "@type": "Question",
      name: "How much does WriteOff cost?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "We offer flexible pricing plans starting with a free tier for basic expense tracking. Premium plans include advanced features like unlimited transactions, priority support, and advanced analytics.",
      },
    },
  ],
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
