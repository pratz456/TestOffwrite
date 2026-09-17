import { CheckCheck, Files, Sparkles } from "lucide-react";

const STEPS = [
  { icon: Sparkles, title: "Add & organize", body: "Add expenses and receipts. AI suggests categories." },
  { icon: CheckCheck, title: "Verify the details", body: "Confirm business use and resolve flagged details." },
  { icon: Files, title: "See where you stand", body: "Track estimates. Export records for your preparer." },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="scroll-mt-20 border-y border-slate-200/80 bg-white">
      <div id="features" className="mx-auto max-w-5xl scroll-mt-20 px-4 py-6 sm:px-6 sm:py-8">
        <h2 className="text-xl font-semibold tracking-tight">Add. Review. Prepare.</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3 sm:gap-7">
          {STEPS.map((step, index) => (
            <div key={step.title} className="flex gap-3">
              <step.icon className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-semibold"><span className="mr-1 text-slate-400">{index + 1}.</span> {step.title}</h3>
                <p className="mt-1 text-sm leading-5 text-slate-600">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
