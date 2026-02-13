"use client";

import { Briefcase, Video, Car, PiggyBank, Star } from "lucide-react";
import { useScrollReveal } from "./use-scroll-reveal";

const TESTIMONIALS = [
  { icon: Briefcase, category: "Small Business Owner", name: "Lila Freeman", role: "Owner of Bloom & Bark Studios", avatarBg: "bg-gradient-to-br from-amber-400 to-orange-500", accentBorder: "hover:border-amber-400/30", quote: "\u201cI run my business, not a spreadsheet \u2014 WriteOff does the rest.\u201d", body: "As a small business owner, I was drowning in receipts, spreadsheets, and missed deductions. WriteOff changed everything. It automatically tracks my business expenses, flags write-offs I didn\u2019t know existed, and even builds my Schedule C. This year alone, it saved me $4,100 in taxes \u2014 and probably 40 hours of busywork.", saved: "$4,100" },
  { icon: Video, category: "TikToker / Content Creator", name: "Jordan Ellis", role: "Beauty Content Creator", avatarBg: "bg-gradient-to-br from-pink-400 to-rose-500", accentBorder: "hover:border-pink-400/30", quote: "\u201cI didn\u2019t know snacks and camera gear were tax-deductible until WriteOff showed me.\u201d", body: "I started creating on TikTok and Instagram last year, and no one teaches you how to handle taxes. WriteOff flagged things like makeup, studio lights, and even props as valid deductions. It helped me recover $3,200 from last year alone.", saved: "$3,200" },
  { icon: Car, category: "Uber/Lyft/Instacart Driver", name: "Carlos Mendoza", role: "Rideshare & Delivery Driver", avatarBg: "bg-gradient-to-br from-blue-400 to-cyan-500", accentBorder: "hover:border-blue-400/30", quote: "\u201cMileage, gas, car washes \u2014 WriteOff caught it all.\u201d", body: "Before WriteOff, I was guessing my business miles and forgetting half my expenses. Now, everything\u2019s automatic. It tracks my trips in real time, categorizes my spending, and gives me weekly savings updates. I saved $1,580 from better mileage tracking.", saved: "$1,580" },
  { icon: PiggyBank, category: "W-2 Worker with a Side Hustle", name: "Ashley Kim", role: "Marketing Analyst & Side Hustler", avatarBg: "bg-gradient-to-br from-violet-400 to-purple-500", accentBorder: "hover:border-violet-400/30", quote: "\u201cI thought I couldn\u2019t deduct anything with a W-2 job \u2014 I was wrong.\u201d", body: "I work full-time in marketing but freelance on the side. WriteOff helped me track side hustle income separately, organize my expenses, and find write-offs like my laptop, Wi-Fi, and software. I ended up saving $2,200 I didn\u2019t expect.", saved: "$2,200" },
];

function Stars() {
  return (<div className="flex gap-0.5">{[...Array(5)].map((_, i) => (<Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />))}</div>);
}

export function TestimonialsSection() {
  const sectionRef = useScrollReveal<HTMLElement>();

  return (
    <section id="reviews" className="py-20 sm:py-24" ref={sectionRef}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="animate-on-scroll text-center">
          <span className="mb-3 inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">Testimonials</span>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Trusted by Tax Savers Everywhere</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">See how WriteOff is helping people across different industries maximize their refunds.</p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 stagger-children">
          {TESTIMONIALS.map((t) => {
            const Icon = t.icon;
            return (
              <div key={t.name} className={`animate-on-scroll group rounded-xl border border-border bg-card p-6 transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1 ${t.accentBorder}`}>
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4" />{t.category}</div>
                  <Stars />
                </div>
                <blockquote className="text-base font-semibold leading-snug text-foreground">{t.quote}</blockquote>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t.body}</p>
                <div className="mt-5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm ${t.avatarBg}`}>{t.name.split(" ").map((n) => n[0]).join("")}</span>
                    <div><p className="text-sm font-medium text-foreground">{t.name}</p><p className="text-xs text-muted-foreground">{t.role}</p></div>
                  </div>
                  <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">Saved {t.saved}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
