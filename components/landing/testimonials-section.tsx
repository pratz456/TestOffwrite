"use client";

import { Briefcase, Video, Car, PiggyBank, Star } from "lucide-react";
import { useScrollReveal } from "./use-scroll-reveal";

const TESTIMONIALS = [
  { icon: Briefcase, category: "Small Business Owner", name: "Lila Freeman", role: "Owner of Bloom & Bark Studios", avatarBg: "bg-gradient-to-br from-amber-400 to-orange-500", accentBorder: "hover:border-amber-400/30", quote: "I run my business, not a spreadsheet. WriteOff does the rest.", body: "As a small business owner I was drowning in receipts and missed deductions. WriteOff changed that. It tracks my expenses, flags write-offs I didn't know existed, and builds my Schedule C. This year it saved me $4,100 in taxes and a ton of busywork.", saved: "$4,100" },
  { icon: Video, category: "TikToker / Content Creator", name: "Jordan Ellis", role: "Beauty Content Creator", avatarBg: "bg-gradient-to-br from-pink-400 to-rose-500", accentBorder: "hover:border-pink-400/30", quote: "I had no idea snacks and camera gear were deductible until WriteOff showed me.", body: "I started creating on TikTok and Instagram last year. Nobody teaches you taxes. WriteOff flagged makeup, studio lights, props. I recovered $3,200 from last year alone.", saved: "$3,200" },
  { icon: Car, category: "Uber/Lyft/Instacart Driver", name: "Carlos Mendoza", role: "Rideshare & Delivery Driver", avatarBg: "bg-gradient-to-br from-blue-400 to-cyan-500", accentBorder: "hover:border-cyan-400/30", quote: "Mileage, gas, car washes. WriteOff caught it all.", body: "Before WriteOff I was guessing my business miles and forgetting half my expenses. Now it's automatic. Real-time tracking, weekly savings updates. I saved $1,580 from better mileage tracking.", saved: "$1,580" },
  { icon: PiggyBank, category: "W-2 Worker with a Side Hustle", name: "Ashley Kim", role: "Marketing Analyst & Side Hustler", avatarBg: "bg-gradient-to-br from-violet-400 to-purple-500", accentBorder: "hover:border-violet-400/30", quote: "I thought I couldn't deduct anything with a W-2 job. I was wrong.", body: "I work full-time in marketing and freelance on the side. WriteOff helped me track my side hustle separately and find write-offs like my laptop, Wi-Fi, and software. Saved $2,200 I wasn't expecting.", saved: "$2,200" },
];

function Stars() {
  return (<div className="flex gap-0.5">{[...Array(5)].map((_, i) => (<Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />))}</div>);
}

function RatingStars() {
  return (
    <div className="flex items-center gap-0.5">
      {[...Array(5)].map((_, i) => (
        <Star key={i} className="h-5 w-5 fill-amber-400 text-amber-400" />
      ))}
    </div>
  );
}

export function TestimonialsSection() {
  const sectionRef = useScrollReveal<HTMLElement>();

  return (
    <section id="reviews" className="py-12 sm:py-16" ref={sectionRef}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="animate-on-scroll text-center">
          <span className="mb-3 inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">Testimonials</span>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Loved by people who'd rather not think about taxes</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">See how WriteOff is helping people in different lines of work keep more of what they earn.</p>
        </div>

        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-6">
          <div className="flex items-center gap-2">
            <RatingStars />
            <span className="font-bold text-foreground">4.9 out of 5</span>
            <span className="text-sm text-muted-foreground">from 200+ users</span>
          </div>
          <div className="rounded-full bg-green-100 px-4 py-1.5 text-sm font-semibold text-green-700">Over $11,000 saved and counting</div>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 stagger-children">
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
