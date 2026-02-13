"use client";

import { Check, X as XIcon } from "lucide-react";
import { useScrollReveal } from "./use-scroll-reveal";

const ROWS = [
  { feature: "Expense Tracking", turbotax: "Manual entry of expenses. No automatic tracking", keeper: "Manual review of expenses. No real-time alerts", writeoff: "Auto-detects write-offs via Plaid integrations with real-time AI alerts" },
  { feature: "Tax Filing", turbotax: "Full-featured tax filing (upsells apply)", keeper: "Offers tax filing as an add-on", writeoff: "Auto-builds Schedule C from real-time data with full filing included" },
  { feature: "User Interface", turbotax: "Traditional form-based UI, built for desktop", keeper: "Basic mobile app, SMS interaction with bookkeeper", writeoff: "Sleek, swipe-based modern mobile UI built for all" },
  { feature: "Real-Time Guidance", turbotax: "Mostly passive until tax season", keeper: "Expense suggestions via SMS, not dynamic or contextual", writeoff: "In-app AI assistant that adapts to your work type and automatically tracks writeoff expenses" },
  { feature: "Custom Work Types", turbotax: "General coverage — W-2s, 1099s, SMB", keeper: "General freelancer coverage", writeoff: "Tailored onboarding for creators, gig workers, students, W-2s, SMBs, and more" },
];

function CompetitorBullet({ text }: { text: string }) {
  return (<span className="flex items-start gap-2"><span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-100"><XIcon className="h-3 w-3 text-red-500" /></span><span>{text}</span></span>);
}
function WriteOffBullet({ text }: { text: string }) {
  return (<span className="flex items-start gap-2"><span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-green-100"><Check className="h-3 w-3 text-green-600" /></span><span>{text}</span></span>);
}

export function ComparisonSection() {
  const sectionRef = useScrollReveal<HTMLElement>();

  return (
    <section className="py-20 sm:py-24" ref={sectionRef}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="animate-on-scroll text-center">
          <span className="mb-3 inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">Compare</span>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">TurboTax vs Keeper Tax vs WriteOff</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">Built for content creators and small business owners who need smarter tax tools</p>
        </div>

        <div className="animate-on-scroll mt-12 hidden overflow-hidden rounded-2xl border border-border shadow-sm lg:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-6 py-4 text-left font-semibold text-foreground w-[18%]">Feature</th>
                <th className="px-6 py-4 text-left font-semibold text-muted-foreground w-[27%]">TurboTax</th>
                <th className="px-6 py-4 text-left font-semibold text-muted-foreground w-[27%]">Keeper Tax</th>
                <th className="px-6 py-4 text-left w-[28%]"><span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-bold text-primary">WriteOff</span></th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr key={row.feature} className={`border-b border-border last:border-0 transition-colors hover:bg-muted/30 ${i % 2 === 0 ? "bg-card" : "bg-muted/10"}`}>
                  <td className="px-6 py-5 font-semibold text-foreground">{row.feature}</td>
                  <td className="px-6 py-5 text-muted-foreground"><CompetitorBullet text={row.turbotax} /></td>
                  <td className="px-6 py-5 text-muted-foreground"><CompetitorBullet text={row.keeper} /></td>
                  <td className="px-6 py-5 text-green-700 font-medium"><WriteOffBullet text={row.writeoff} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-12 space-y-5 lg:hidden stagger-children">
          {ROWS.map((row) => (
            <div key={row.feature} className="animate-on-scroll rounded-xl border border-border bg-card p-5 shadow-sm">
              <h3 className="mb-3 text-base font-semibold text-foreground">{row.feature}</h3>
              <div className="space-y-3 text-sm">
                <div className="text-muted-foreground"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/60">TurboTax</p><CompetitorBullet text={row.turbotax} /></div>
                <div className="text-muted-foreground"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/60">Keeper Tax</p><CompetitorBullet text={row.keeper} /></div>
                <div className="text-green-700 font-medium"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">WriteOff</p><WriteOffBullet text={row.writeoff} /></div>
              </div>
            </div>
          ))}
        </div>

        <div className="animate-on-scroll mx-auto mt-16 max-w-2xl rounded-2xl border border-border bg-gradient-to-br from-card to-muted/30 p-8 text-center shadow-sm sm:p-10">
          <h3 className="text-2xl font-bold text-foreground sm:text-3xl">The Bottom Line</h3>
          <p className="mt-4 text-muted-foreground leading-relaxed">WriteOff simplifies or skips the most painful parts of tax filing by working year-round. No more hunting for receipts, guessing deductions, or dealing with aggressive upsells.</p>
          <p className="mt-5 inline-block rounded-full bg-primary/10 px-4 py-1.5 text-sm font-semibold text-primary">Automatic, transparent, and built for modern workers</p>
        </div>
      </div>
    </section>
  );
}
