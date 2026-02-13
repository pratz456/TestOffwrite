"use client";

import { useState } from "react";
import { FileWarning, TableProperties, AlarmClock, TrendingDown } from "lucide-react";
import { useScrollReveal } from "./use-scroll-reveal";

const PROBLEMS = [
  { icon: FileWarning, title: "Forgotten Deductions", body: "You miss everyday expenses - software, subscriptions, travel - simply because you didn't track them in real time", color: "text-amber-500", bg: "bg-amber-500/10", ring: "ring-amber-500/20", border: "border-amber-400/40" },
  { icon: TableProperties, title: "Spreadsheet Hell", body: "You waste hours sorting receipts, guessing categories, and organizing expenses... just to hand it off to your CPA", color: "text-blue-500", bg: "bg-blue-500/10", ring: "ring-blue-500/20", border: "border-blue-400/40" },
  { icon: AlarmClock, title: "The April Rush", body: "Tax time hits and you're stuck digging for invoices, donation receipts, and deduction records", color: "text-rose-500", bg: "bg-rose-500/10", ring: "ring-rose-500/20", border: "border-rose-400/40" },
  { icon: TrendingDown, title: "Overpaying The IRS", body: "Every year, most people miss ELIGIBLE write-offs - leaving thousands on the table", color: "text-emerald-500", bg: "bg-emerald-500/10", ring: "ring-emerald-500/20", border: "border-emerald-400/40" },
];

const DOT_COLORS = ["bg-amber-500", "bg-blue-500", "bg-rose-500", "bg-emerald-500"];

export function ProblemSection() {
  const [active, setActive] = useState(3);
  const sectionRef = useScrollReveal<HTMLElement>();

  return (
    <section id="problem" className="py-20 sm:py-24" ref={sectionRef}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="animate-on-scroll text-center">
          <span className="mb-3 inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">The Problem</span>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">The first full stack tax autopilot for modern workers.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">Most individuals overpay taxes simply because traditional tax tools only show up in April &mdash; when it&rsquo;s already too late.</p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
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

        <div className="animate-on-scroll mt-10 flex justify-center">
          <div className="inline-flex items-center gap-2.5 rounded-full border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 px-6 py-3 text-sm font-medium text-green-700 shadow-sm">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
            </span>
            WriteOff fixes all of this &mdash; <strong>automatically</strong>. For your convenience.
          </div>
        </div>
      </div>
    </section>
  );
}
