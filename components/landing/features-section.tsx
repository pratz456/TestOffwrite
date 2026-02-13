"use client";

import { Shield, Zap, TrendingUp, FileText, FolderCheck, BarChart3 } from "lucide-react";
import { useScrollReveal } from "./use-scroll-reveal";

const FEATURES = [
  { icon: Shield, tag: "Secure", tagColor: "bg-emerald-100 text-emerald-700", iconColor: "text-emerald-600", iconBg: "bg-emerald-100", title: "Bank-Grade Security", body: "Securely connect all your spending accounts via Plaid or MX. All your data is encrypted and protected 24/7." },
  { icon: Zap, tag: "AI-Powered", tagColor: "bg-violet-100 text-violet-700", iconColor: "text-violet-600", iconBg: "bg-violet-100", title: "AI-Powered Write-Offs", body: "Automatically detects deductible expenses using merchant, location, and other transaction behaviors." },
  { icon: TrendingUp, tag: "Live Updates", tagColor: "bg-blue-100 text-blue-700", iconColor: "text-blue-600", iconBg: "bg-blue-100", title: "Real-time Tax Savings", body: "Watch your refund grow live - see savings update instantly with every logged expense." },
  { icon: FileText, tag: "One-Click", tagColor: "bg-amber-100 text-amber-700", iconColor: "text-amber-600", iconBg: "bg-amber-100", title: "Auto-Generated Tax Summary", body: "Export a clean PDF or CSV of your deductions - or file your taxes directly in the app." },
  { icon: FolderCheck, tag: "Audit-Ready", tagColor: "bg-rose-100 text-rose-700", iconColor: "text-rose-600", iconBg: "bg-rose-100", title: "Audit-Ready Records", body: "Upload receipts (optional), auto-organized by category - ready if the IRS comes knocking." },
  { icon: BarChart3, tag: "Smart Reports", tagColor: "bg-cyan-100 text-cyan-700", iconColor: "text-cyan-600", iconBg: "bg-cyan-100", title: "Smart Financial Reports", body: "Get monthly insights and reminders to stay organized, save more, and stay tax ready year-round." },
];

export function FeaturesSection() {
  const sectionRef = useScrollReveal<HTMLElement>();

  return (
    <section id="features" className="relative py-20 sm:py-24 overflow-hidden" ref={sectionRef}>
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-muted/40 via-muted/20 to-background" />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="animate-on-scroll text-center">
          <span className="mb-3 inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">Features</span>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Everything You Need for Tax Success</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">Built for side hustlers. Trusted by creators. Designed to feel like magic.</p>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 stagger-children">
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
