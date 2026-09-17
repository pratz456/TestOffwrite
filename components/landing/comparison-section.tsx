import { Plus } from "lucide-react";
import { CtaButton } from "./cta-button";

const QUESTIONS = [
  { question: "Do I have to connect my bank?", answer: "No. Start with a manual expense or receipt upload, and add income as you go." },
  { question: "Does AI decide what I can deduct?", answer: "AI suggests categories and gives explanations to help your review. Deductibility depends on your business use, evidence, and applicable tax rules. Check the details and resolve flagged questions before relying on an estimate." },
  { question: "Can WriteOff file my tax return?", answer: "In-app filing is not available. Estimates cover supported situations; exports are records and planning worksheets for your preparer, not a complete or filed return. Receipt images stay in your account and are not included in the records archive." },
];

export function ComparisonSection() {
  return (
    <section id="availability" className="mx-auto grid max-w-5xl scroll-mt-20 gap-6 px-4 py-7 sm:px-6 sm:py-9 md:grid-cols-2 md:gap-10">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Start free. Keep your records.</h2>
        <p className="mt-2 text-sm leading-5 text-slate-600">30 days of Premium reports included.</p>
        <dl className="mt-3 divide-y divide-slate-200 text-sm">
          <div className="flex gap-4 py-3">
            <dt className="w-20 shrink-0 font-semibold">Free</dt>
            <dd className="text-slate-600">Manual tracking and a records archive.</dd>
          </div>
          <div className="flex gap-4 py-3">
            <dt className="w-20 shrink-0 font-semibold">Premium</dt>
            <dd className="text-slate-600"><span className="font-medium text-slate-950">$14.99/mo or $150/yr.</span> PDF/CSV reports and extended history. Cancel anytime.</dd>
          </div>
        </dl>
        <CtaButton label="Try WriteOff" className="mt-2" />
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Common questions</h2>
        <div className="mt-3 divide-y divide-slate-200">
          {QUESTIONS.map(({ question, answer }) => (
            <details key={question} className="group">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden">
                {question}<Plus className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-45" aria-hidden="true" />
              </summary>
              <p className="pb-4 pr-5 text-sm leading-6 text-slate-600">{answer}</p>
            </details>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">Tax planning and recordkeeping. In-app filing is not available.</p>
      </div>
    </section>
  );
}
