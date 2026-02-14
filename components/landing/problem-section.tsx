"use client";

import { useState } from "react";
import { FileWarning, TableProperties, AlarmClock, TrendingDown } from "lucide-react";
import { useScrollReveal } from "./use-scroll-reveal";

const PROBLEMS = [
  { icon: FileWarning, title: "Forgotten deductions", body: "Software, subscriptions, travel. Easy to miss when you're not tracking as you go.", color: "text-amber-500", bg: "bg-amber-500/10", ring: "ring-amber-500/20", border: "border-amber-400/40" },
  { icon: TableProperties, title: "Spreadsheet overload", body: "Hours spent sorting receipts and guessing categories, only to hand it all to your accountant.", color: "text-blue-500", bg: "bg-blue-500/10", ring: "ring-blue-500/20", border: "border-blue-400/40" },
  { icon: AlarmClock, title: "The April scramble", body: "Tax day looms and you're digging for invoices, receipts, and anything that might count.", color: "text-rose-500", bg: "bg-rose-500/10", ring: "ring-rose-500/20", border: "border-rose-400/40" },
  { icon: TrendingDown, title: "Money left on the table", body: "Most people miss write-offs they're entitled to. That's real money you could keep.", color: "text-emerald-500", bg: "bg-emerald-500/10", ring: "ring-emerald-500/20", border: "border-emerald-400/40" },
];

const DOT_COLORS = ["bg-amber-500", "bg-blue-500", "bg-rose-500", "bg-emerald-500"];

export function ProblemSection() {
  const [active, setActive] = useState(3);
  const sectionRef = useScrollReveal<HTMLElement>();

  return (
    <section id="problem" className="py-12 sm:py-16" ref={sectionRef}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="animate-on-scroll text-center">
          <span className="mb-3 inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">The Problem</span>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Tax tools that actually work the way you do.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">Most people overpay because traditional tools only show up in April, when it's already too late.</p>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PROBLEMS.map((item, i) => {
            const Icon = item.icon;
            const isActive = i === active;
            return (
              <button key={item.title} type="button" onClick={() => setActive(i)} className={`group relative rounded-xl border p-6 text-left transition-all duration-300 ${isActive ? `${item.border} bg-card shadow-lg ring-2 ${item.ring}` : "border-border bg-card/60 hover:border-border hover:shadow-md hover:-translate-y-0.5"}`}>
                <div className={`mb-4 inline-flex rounded-lg p-2.5 transition-colors duration-300 ${isActive ? item.bg : "bg-muted"}`}>
                  <Icon className={`h-6 w-6 transition-colors duration-300 ${isActive ? item.color : "text-muted-foreground"}`} />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-8 flex justify-center gap-2">
          {PROBLEMS.map((_, i) => (
            <button key={i} type="button" aria-label={`Show card ${i + 1}`} onClick={() => setActive(i)} className={`h-2.5 rounded-full transition-all duration-300 ${i === active ? `w-8 ${DOT_COLORS[i]}` : "w-2.5 bg-muted-foreground/25"}`} />
          ))}
        </div>

        <div className="animate-on-scroll mt-8 flex justify-center">
          <div className="inline-flex items-center gap-2.5 rounded-full border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 px-6 py-3 text-sm font-medium text-green-700 shadow-sm">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
            </span>
            WriteOff fixes all of this <strong>automatically</strong>, so you can focus on what you do best.
          </div>
        </div>
      </div>
    </section>
  );
}
