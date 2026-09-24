"use client";

import { Receipt, FolderCheck, FileText } from "lucide-react";
import { AuthButtons } from "./cta-button";
import { useScrollReveal } from "../use-scroll-reveal";

const STEPS = [
  { num: "01", icon: Receipt, numBg: "bg-gradient-to-br from-blue-500 to-blue-600", title: "Add an expense", body: "Set up your work profile, then enter an expense or upload a receipt. You can get started without linking a bank.", checks: ["Manual entry", "Receipt uploads", "No bank required"] },
  { num: "02", icon: FolderCheck, numBg: "bg-gradient-to-br from-violet-500 to-violet-600", title: "Review the details", body: "Check the amount, date and category. Add business context and separate personal spending before using records in a tax summary.", checks: ["Editable details", "Business-purpose notes", "Your review matters"] },
  { num: "03", icon: FileText, numBg: "bg-gradient-to-br from-emerald-500 to-emerald-600", title: "Prepare for tax time", body: "Download your records archive on any plan, or use trial and Premium report exports to organize a review with your preparer.", checks: ["Records archive", "PDF and CSV reports", "Preparer review"] },
];

export function HowItWorksSection() {
  const sectionRef = useScrollReveal<HTMLElement>();

  return (
    <section id="how-it-works" className="relative py-12 sm:py-16 overflow-hidden" ref={sectionRef}>
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-muted/40 via-muted/20 to-background" />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="animate-on-scroll text-center">
          <span className="mb-3 inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">How It Works</span>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">How it works</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">From a receipt to an organized record in three steps.</p>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-3 stagger-children">
          {STEPS.map((step) => (
            <div key={step.num} className="animate-on-scroll group rounded-xl border border-border bg-card p-6 transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 hover:border-primary/20 hover:-translate-y-1">
              <div className="mb-5 flex items-center gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white shadow-md ${step.numBg}`}>{step.num}</span>
                <h3 className="text-lg font-semibold text-foreground">{step.title}</h3>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              <ul className="mt-4 space-y-2">
                {step.checks.map((c) => (
                  <li key={c} className="flex items-center gap-2 text-sm text-green-700">
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-green-100">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    </span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="animate-on-scroll mt-10 flex flex-col items-center gap-3">
          <AuthButtons size="lg" />
          <p className="text-xs text-muted-foreground">30-day free trial. No credit card required.</p>
        </div>
      </div>
    </section>
  );
}
