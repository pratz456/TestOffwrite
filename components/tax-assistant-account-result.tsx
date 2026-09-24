import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { accountResultSchema } from '@/lib/tax-assistant/account-contract';

export function TaxAssistantAccountResult({ value }: { value: unknown }) {
  const parsed = accountResultSchema.safeParse(value);
  if (!parsed.success) return null;
  const result = parsed.data;
  return <section aria-label={result.title} className="mt-3 space-y-3">
    {result.metrics.length > 0 && <dl className="grid grid-cols-2 gap-2">
      {result.metrics.map(metric => <div key={metric.label} className="rounded-xl bg-muted px-3 py-2">
        <dt className="text-xs text-muted-foreground">{metric.label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{metric.value}</dd>
      </div>)}
    </dl>}
    {result.items.length > 0 && <ul className="divide-y divide-border rounded-xl border border-border">
      {result.items.map((item, i) => <li key={`${item.href}-${i}`}><Link href={item.href} className="flex min-h-12 items-center justify-between gap-2 px-3 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0"><span className="block font-medium">{item.label}</span><span className="block text-xs text-muted-foreground">{item.detail}</span></span><ArrowRight className="h-4 w-4 shrink-0" />
      </Link></li>)}
    </ul>}
    <div className="flex flex-wrap gap-2">{result.actions.map(action => <Link key={action.href} href={action.href} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {action.label}<ArrowRight className="h-3.5 w-3.5" />
    </Link>)}</div>
    <p className="text-xs text-muted-foreground">{result.scope}</p>
    {result.notes.length > 0 && <details className="rounded-lg border border-border text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer px-3 py-3 font-medium">How to read this · {result.asOf.slice(0, 10)}</summary><ul className="space-y-2 px-3 pb-3">{result.notes.map((note, i) => <li key={i}>{note}</li>)}</ul></details>}
  </section>;
}
