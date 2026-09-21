"use client";

import { Shield, Receipt, TrendingUp, FileText, FolderCheck, BarChart3 } from "lucide-react";
import { useScrollReveal } from "./use-scroll-reveal";

const FEATURES = [
  { icon: Shield, tag: "Private", tagColor: "bg-emerald-100 text-emerald-700", iconColor: "text-emerald-600", iconBg: "bg-emerald-100", title: "Receipts linked to your account", body: "Keep receipt images with your saved expenses. Viewing an attachment requires your signed-in account." },
  { icon: Receipt, tag: "Review Before Saving", tagColor: "bg-violet-100 text-violet-700", iconColor: "text-violet-600", iconBg: "bg-violet-100", title: "Less receipt retyping", body: "Upload a receipt, check the extracted merchant, date and amount, and correct the details before saving." },
  { icon: TrendingUp, tag: "Planning", tagColor: "bg-blue-100 text-blue-700", iconColor: "text-blue-600", iconBg: "bg-blue-100", title: "Federal tax estimates", body: "Explore estimates for supported tax situations after reviewing your income and organizer. Missing facts prompt a review." },
  { icon: FileText, tag: "Premium Reports", tagColor: "bg-amber-100 text-amber-700", iconColor: "text-amber-600", iconBg: "bg-amber-100", title: "Records for your preparer", body: "Export Schedule C summaries and transaction details as PDF or CSV with a trial or Premium plan. These are records and worksheets, not filed returns." },
  { icon: FolderCheck, tag: "Your Records", tagColor: "bg-rose-100 text-rose-700", iconColor: "text-rose-600", iconBg: "bg-rose-100", title: "Keep the business context", body: "Record categories and notes as you review expenses. Your saved records and records archive remain available on the Free plan." },
  { icon: BarChart3, tag: "Cash Flow", tagColor: "bg-cyan-100 text-cyan-700", iconColor: "text-cyan-600", iconBg: "bg-cyan-100", title: "See recorded money movements", body: "Review inflows and outflows by month. Cash-flow reports keep recorded spending separate from tax deductions." },
];

export function FeaturesSection() {
  const sectionRef = useScrollReveal<HTMLElement>();

  return (
    <section id="features" className="relative py-12 sm:py-16 overflow-hidden" ref={sectionRef}>
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-muted/40 via-muted/20 to-background" />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="animate-on-scroll text-center">
          <span className="mb-3 inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">Features</span>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">A clearer picture of your business expenses</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">Keep the records you need for your next review with a tax preparer.</p>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 stagger-children">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="animate-on-scroll group rounded-xl border border-border bg-card p-6 transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 hover:border-primary/20 hover:-translate-y-1">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`rounded-lg p-2.5 ${f.iconBg}`}><Icon className={`h-5 w-5 ${f.iconColor}`} /></div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${f.tagColor}`}>{f.tag}</span>
                </div>
                <h3 className="text-lg font-semibold text-foreground">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
