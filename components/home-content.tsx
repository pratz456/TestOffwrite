import { Button } from '@/components/ui/button';
import writeOffLogo from '@/public/writeofflogo.png';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileCheck2,
  Landmark,
  Receipt,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export function HomeContent() {
  return (
    <div className="flex min-h-svh flex-col overflow-x-hidden bg-background text-foreground safe-area-inset-top safe-area-inset-bottom">
      <header className="border-b border-border/70 bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2" aria-label="WriteOff home">
            <Image src={writeOffLogo} alt="" width={28} height={28} className="rounded-md" />
            <span className="text-lg font-semibold tracking-tight">WriteOff</span>
          </Link>
          <Link href="/" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to site
          </Link>
        </div>
      </header>

      <main className="relative flex-1">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_20%_10%,hsl(var(--primary)/0.12),transparent_45%),radial-gradient(circle_at_85%_15%,hsl(var(--info)/0.10),transparent_40%)]" aria-hidden="true" />
        <section className="relative mx-auto grid w-full max-w-6xl items-center gap-6 px-4 py-7 sm:px-6 sm:py-10 lg:grid-cols-[1.04fr_.96fr] lg:gap-10 lg:py-14">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Built for freelancers, gig workers and independent businesses
            </div>
            <h1 className="mt-4 max-w-xl text-4xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-5xl">
              Your tax workspace,
              <span className="block text-primary">ready before tax season.</span>
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
              Bring expenses, receipts, income and tax questions into one focused workflow. AI prepares the review; you keep control of every decision.
            </p>

            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
              <Button asChild className="h-12 rounded-xl px-6 text-base font-semibold">
                <Link href="/auth/sign-up">Create your account <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" /></Link>
              </Button>
              <Button asChild variant="outline" className="h-12 rounded-xl px-6 text-base font-medium">
                <Link href="/auth/login">Sign in</Link>
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {['30 days Premium included', 'No credit card required', 'Bank connection optional'].map(item => (
                <span key={item} className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[hsl(var(--success))]" aria-hidden="true" />{item}</span>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-3 rounded-[28px] bg-gradient-to-br from-primary/10 via-transparent to-[hsl(var(--info)/0.10)] blur-xl" aria-hidden="true" />
            <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]" role="group" aria-label="WriteOff example product workflow">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">Your next best action</p>
                  <p className="text-xs text-muted-foreground">A guided review queue—not another spreadsheet</p>
                </div>
                <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">Example workflow</span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-border/70 border-b border-border/70 bg-muted/25">
                {[['Transactions', 'Organized'], ['Next steps', 'Focused'], ['Records', 'Prepared']].map(([label, value]) => (
                  <div key={label} className="px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <p className="mt-0.5 text-sm font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Sparkles className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">Design software subscription</p>
                    <p className="text-xs text-muted-foreground">Suggested: Schedule C · Office expense</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[hsl(var(--warning)/0.12)] px-2 py-1 text-[11px] font-semibold text-[hsl(var(--warning))]">Needs review</span>
                </div>
                <div className="rounded-xl border border-primary/15 bg-primary/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-primary">AI found the rule. You confirm the facts.</p>
                    <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Add the business purpose and receipt before including a deduction. Official sources stay attached to the review.</p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                  <div className="rounded-lg bg-muted/50 p-2"><Receipt className="mx-auto mb-1 h-4 w-4 text-primary" aria-hidden="true" />Capture</div>
                  <div className="rounded-lg bg-muted/50 p-2"><FileCheck2 className="mx-auto mb-1 h-4 w-4 text-primary" aria-hidden="true" />Review</div>
                  <div className="rounded-lg bg-muted/50 p-2"><Landmark className="mx-auto mb-1 h-4 w-4 text-primary" aria-hidden="true" />Prepare</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="relative mx-auto w-full max-w-6xl px-4 pb-7 sm:px-6 sm:pb-10" aria-label="How WriteOff helps">
          <div className="grid overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[var(--shadow-tight)] md:grid-cols-3 md:divide-x md:divide-border/70">
            {[
              ['01', 'Start your way', 'Enter records manually, upload receipts, or connect a bank when you choose.'],
              ['02', 'Resolve what matters', 'Answer focused questions instead of accepting unexplained AI labels.'],
              ['03', 'Hand off clean records', 'Keep tax-year records, reports and preparer packages organized in one place.'],
            ].map(([step, title, detail]) => (
              <div key={step} className="border-b border-border/70 p-4 last:border-0 md:border-b-0">
                <p className="text-xs font-semibold text-primary">{step}</p>
                <h2 className="mt-1 text-sm font-semibold">{title}</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">Planning and recordkeeping only. WriteOff does not file returns or replace a qualified tax professional.</p>
        </section>
      </main>

      <footer className="border-t border-border/70 bg-card/60 px-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-1 py-3 sm:flex-row">
          <nav className="flex flex-wrap items-center justify-center gap-x-5" aria-label="Support and policies">
            <Link href="/help" prefetch={false} className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground">Help & Support</Link>
            <Link href="/privacy" prefetch={false} className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground">Privacy</Link>
            <Link href="/terms" prefetch={false} className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground">Terms</Link>
            <Link href="/about" prefetch={false} className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground">About</Link>
            <a href="mailto:writeoffapp@gmail.com" className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-foreground">Contact</a>
          </nav>
          <p className="text-center text-xs text-muted-foreground">© {new Date().getFullYear()} WriteOff.</p>
        </div>
      </footer>
    </div>
  );
}
