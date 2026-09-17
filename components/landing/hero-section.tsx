import { ArrowRight, Check, Sparkles } from "lucide-react";
import { CtaButton } from "./cta-button";

export function HeroSection() {
  return (
    <section className="mx-auto grid max-w-5xl items-center gap-7 px-4 py-7 sm:px-6 sm:py-12 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:py-16">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">For freelancers & small businesses</p>
        <h1 className="mt-3 text-[2.5rem] font-semibold leading-[1.08] tracking-[-0.04em] sm:text-5xl">
          Less tax admin.<br />More clarity.
        </h1>
        <p className="mt-4 max-w-md text-base leading-6 text-slate-600">
          AI suggests categories. You verify the details. Keep expenses, receipts, and tax estimates together.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <CtaButton label="Get started" size="lg" />
          <a href="#how-it-works" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-700 hover:text-blue-600">
            See how it works <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
        <p className="mt-2 text-xs text-slate-500">30 days free · No credit card required</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Example transaction review">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-semibold text-slate-700">A quick review. A clearer record.</span>
          <span className="text-slate-500">Example</span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Design software</p>
            <p className="text-xs text-slate-500">Monthly subscription</p>
          </div>
          <p className="text-lg font-semibold tabular-nums">$29.99</p>
        </div>
        <dl className="mt-4 divide-y divide-slate-100 border-y border-slate-100 text-sm">
          <div className="flex justify-between gap-3 py-2.5"><dt className="text-slate-500">AI suggestion</dt><dd className="font-medium">Software expense</dd></div>
          <div className="flex justify-between gap-3 py-2.5"><dt className="text-slate-500">Your next step</dt><dd className="text-right font-medium">Confirm business use</dd></div>
        </dl>
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-500">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
          A category suggestion is a starting point. You review the business purpose and tax treatment.
        </p>
      </div>
    </section>
  );
}
