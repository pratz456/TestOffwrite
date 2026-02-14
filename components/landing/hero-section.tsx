import { AuthButtons } from "./cta-button";
import { Sparkles } from "lucide-react";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden py-12 sm:py-16 lg:py-20">
      <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/3 h-[600px] w-[900px] rounded-full opacity-[0.10]" aria-hidden="true" style={{ background: "radial-gradient(ellipse, hsl(221 83% 53%), hsl(199 89% 48% / 0.3) 50%, transparent 70%)" }} />
      <div className="pointer-events-none absolute -right-20 top-20 h-[300px] w-[300px] rounded-full opacity-[0.06]" aria-hidden="true" style={{ background: "radial-gradient(circle, hsl(160 60% 45%), transparent 70%)" }} />

      <div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
        <div className="animate-hero-enter mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary">
          <Sparkles className="h-4 w-4" />
          AI-Powered Tax Automation
        </div>

        <h1 className="animate-hero-enter-delay-1 text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
          <span className="text-foreground">Stop overpaying taxes.</span><br />
          <span className="bg-gradient-to-r from-primary via-blue-500 to-cyan-500 bg-clip-text text-transparent">WriteOff</span>{" "}
          <span className="text-foreground">finds every deduction.</span>
        </h1>

        <p className="animate-hero-enter-delay-2 mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
          Our <span className="font-semibold text-primary">AI</span> finds, categorises, and tracks your business expenses as you go. Your phone becomes your tax-saving sidekick.
        </p>

        <div className="animate-hero-enter-delay-3 mt-8 flex flex-col items-center gap-4">
          <AuthButtons size="lg" />
          <div className="flex flex-col items-center gap-1.5 rounded-xl border border-green-200/60 bg-green-50/50 px-6 py-3">
            <p className="text-sm font-medium text-foreground">
              Start your <span className="bg-gradient-to-r from-green-600 to-emerald-500 bg-clip-text font-bold text-transparent">30-day free trial</span>. No credit card needed.
            </p>
            <p className="text-xs text-muted-foreground">Then $14.99/mo or $150/yr. Cancel anytime.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
