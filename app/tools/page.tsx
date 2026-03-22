import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Calculator, ArrowRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Free Tax Tools & Calculators",
  description:
    "Free tax calculators for freelancers and self-employed professionals. Calculate self-employment tax, quarterly estimates, and more — no sign-up required.",
  alternates: { canonical: "/tools" },
  openGraph: {
    title: "Free Tax Tools & Calculators | WriteOff",
    description:
      "Free tax calculators for freelancers — self-employment tax, quarterly estimates, and more.",
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
    title: "Self-Employment Tax Calculator",
    description:
      "Calculate your 2025 self-employment tax — Social Security (12.4%), Medicare (2.9%), and the deductible half. Supports W-2 wage offsets and all filing statuses.",
    href: "/tools/se-tax-calculator",
    badge: "Free",
  },
];

export default function ToolsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/writeofflogo.png" alt="WriteOff" width={28} height={28} className="rounded-md" />
              <span className="font-semibold text-gray-900">WriteOff</span>
            </Link>
            <Link href="/">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 mr-1.5" />
                Home
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-50 text-green-700 text-sm font-medium mb-4">
            <Calculator className="w-4 h-4" />
            100% Free
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900 mb-3">
            Tax Tools & Calculators
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Free calculators built for freelancers, contractors, and self-employed professionals.
            No sign-up required.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group relative rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:border-green-300 hover:shadow-md"
            >
              {tool.badge && (
                <span className="absolute top-4 right-4 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                  {tool.badge}
                </span>
              )}
              <div className="mb-4 inline-flex rounded-lg bg-green-50 p-2.5">
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

          {/* Coming soon placeholders */}
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-6 flex flex-col items-center justify-center text-center">
            <Calculator className="h-6 w-6 text-gray-400 mb-3" />
            <p className="text-sm font-medium text-gray-500">Quarterly Tax Estimate Calculator</p>
            <p className="text-xs text-gray-400 mt-1">Coming soon</p>
          </div>

          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-6 flex flex-col items-center justify-center text-center">
            <Calculator className="h-6 w-6 text-gray-400 mb-3" />
            <p className="text-sm font-medium text-gray-500">Home Office Deduction Calculator</p>
            <p className="text-xs text-gray-400 mt-1">Coming soon</p>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-16 text-center rounded-2xl bg-gradient-to-r from-green-600 to-emerald-600 p-10 text-white">
          <h3 className="text-xl font-bold mb-2">Want to automate your tax deductions?</h3>
          <p className="text-green-100 mb-6 max-w-md mx-auto">
            WriteOff automatically tracks expenses, identifies deductions, and generates tax reports.
          </p>
          <Link href="/auth/sign-up">
            <Button size="lg" className="bg-white text-green-700 hover:bg-green-50">
              Start Free Trial
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </main>

      <footer className="border-t border-gray-200 mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-gray-500">
            <p>&copy; {new Date().getFullYear()} WriteOff. All rights reserved.</p>
            <div className="flex gap-4">
              <Link href="/about" className="hover:text-gray-700">About</Link>
              <Link href="/blog" className="hover:text-gray-700">Blog</Link>
              <Link href="/privacy" className="hover:text-gray-700">Privacy</Link>
              <Link href="/contact" className="hover:text-gray-700">Contact</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
