import type { Metadata } from "next";
import Link from "next/link";
import { Calculator, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LandingHeader } from "@/components/landing/landing-header";

export const metadata: Metadata = {
  title: "Free Tax Tools & Calculators",
  description:
    "Free tax calculators for freelancers and self-employed professionals. Calculate self-employment tax, quarterly estimates, and more  - no sign-up required.",
  alternates: { canonical: "/tools" },
  openGraph: {
    title: "Free Tax Tools & Calculators | WriteOff",
    description:
      "Free tax calculators for freelancers  - self-employment tax, quarterly estimates, and more.",
    type: "website",
    url: "/tools",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Tax Tools & Calculators | WriteOff",
    description:
      "Free tax calculators for freelancers and self-employed professionals.",
  },
};

const tools = [
  {
    title: "1099 Tax Calculator",
    description:
      "Planning estimate of your 2025 or 2026 federal tax as a freelancer  - income tax, self-employment tax, QBI deduction, standard deduction, and effective rate. Federal only; no credits or state tax.",
    href: "/tools/1099-tax-calculator",
    badge: "Free",
  },
  {
    title: "Quarterly Estimated Tax Calculator",
    description:
      "Illustrate original regular-method installments from a reviewed annual forecast using the 90% current-year and 100%/110% prior-year safe-harbor targets. Not a penalty calculation.",
    href: "/tools/quarterly-estimate-calculator",
    badge: "Free",
  },
  {
    title: "Self-Employment Tax Calculator",
    description:
      "Estimate your 2025 or 2026 self-employment tax  - Social Security (12.4% up to the annual wage base), Medicare (2.9%), and the deductible half. Supports W-2 wage offsets and all filing statuses.",
    href: "/tools/se-tax-calculator",
    badge: "Free",
  },
];

export default function ToolsPage() {
  return (
    <div className="min-h-screen bg-background">
      <LandingHeader />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-50 text-green-700 text-sm font-medium mb-4">
            <Calculator className="w-4 h-4" />
            100% Free
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900 mb-3">
            Tax Tools & Calculators
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
            Free calculators built for freelancers, contractors, and self-employed professionals.
            No sign-up required.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group relative rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {tool.badge && (
                <span className="absolute top-4 right-4 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                  {tool.badge}
                </span>
              )}
              <div className="mb-3 inline-flex rounded-lg bg-primary/5 p-2">
                <Calculator className="h-6 w-6 text-green-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 group-hover:text-green-700 transition-colors mb-2">
                {tool.title}
              </h2>
              <p className="text-sm text-gray-600 mb-4 leading-relaxed">
                {tool.description}
              </p>
              <span className="inline-flex items-center text-sm font-medium text-green-600 group-hover:text-green-700">
                Use calculator
                <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}


        </div>

        {/* CTA */}
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-5 text-white">
          <h3 className="text-xl font-bold mb-2">Want help keeping your deduction records?</h3>
          <p className="text-slate-300 mb-4 max-w-2xl text-sm leading-relaxed">
            WriteOff tracks expenses, suggests likely deductions for your review, and prepares Schedule C-ready summaries your preparer can use.
          </p>
          <Link href="/auth/sign-up">
            <Button size="lg" className="bg-white text-green-700 hover:bg-green-50">
              Start Free Trial
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </main>

      <footer className="border-t border-border mt-6">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-gray-500">
            <p>&copy; {new Date().getFullYear()} WriteOff. All rights reserved.</p>
            <div className="flex gap-4">
              <Link href="/about" className="hover:text-gray-700">About</Link>
              <Link href="/blog" className="hover:text-gray-700">Blog</Link>
              <Link href="/privacy" className="hover:text-gray-700">Privacy</Link>
              <Link href="/terms" className="hover:text-gray-700">Terms</Link>
              <Link href="/contact" className="hover:text-gray-700">Contact</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
