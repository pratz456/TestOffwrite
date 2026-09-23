import { TAX_YEAR_2027_STATUS } from '@/lib/tax-rules/tax-year-2027';

/** Compact progressive disclosure: annual calculation readiness is not topic coverage. */
export function TaxYear2027Readiness() {
  return (
    <details className="mb-3 rounded-xl border border-border bg-card text-sm text-foreground">
      <summary className="cursor-pointer rounded-xl px-3 py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        2027: what’s ready and what’s pending
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Tax year 2027 generally means a return filed in 2028. Filing in 2027 for 2026 income? Choose 2026 above.
          {' '}Reviewed {TAX_YEAR_2027_STATUS.reviewedAt}. These topics support planning guidance; complete 2027 estimates are not available.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Verified 2027 guidance">
          {TAX_YEAR_2027_STATUS.topics.map((topic) => (
            <li key={topic.id} className="min-w-0">
              <a href={topic.source} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {topic.title}<span className="sr-only"> official source (opens in a new tab)</span>
              </a>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{topic.summary}</p>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground">Awaiting official figures:</strong>{' '}
          tax brackets, standard deductions, indexed credits and QBI limits, Social Security wage base, retirement and Section 179 limits, and mileage rates.
          {' '}2026 amounts are not treated as final 2027 figures.
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">{TAX_YEAR_2027_STATUS.coverage}</p>
      </div>
    </details>
  );
}
