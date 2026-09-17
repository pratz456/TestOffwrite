'use client';

import React from 'react';
import { readBusinessLossAnswers, type BusinessLossAnswers } from '@/lib/tax-rules/business-losses';

interface Props {
  taxYear: number;
  /** Saved JSON text for the `businessLossFacts` organizer field. */
  value: string;
  onChange: (value: string) => void;
}
type AnswerKey = Exclude<keyof BusinessLossAnswers, 'version' | 'taxYear'>;

/** Loss-year declarations (Schedule C lines G and 32a, §183); blank stays unanswered and server review-blocked. */
export function BusinessLossFields({ taxYear, value, onChange }: Props) {
  let facts: BusinessLossAnswers = { version: 1, taxYear };
  let stale = false;
  try {
    const saved = readBusinessLossAnswers(value);
    if (saved && saved.taxYear === taxYear) facts = saved;
    else if (saved) stale = true;
  } catch { /* Malformed records are visibly unanswered and server review-blocked. */ }
  const set = (key: AnswerKey, next: string) => onChange(JSON.stringify({ ...facts, [key]: next }));
  const yesNo = (key: AnswerKey, label: string, hint: string) => <div className="space-y-1" key={key}>
    <label className="block text-sm font-medium">{label}<select aria-label={label} value={facts[key] || ''} onChange={event => set(key, event.target.value)} className="mt-1 w-full rounded-md border bg-background p-2">
      <option value="">Choose after review</option><option value="yes">Yes</option><option value="no">No</option>
    </select></label><p className="text-xs text-muted-foreground">{hint}</p>
  </div>;
  const limited = (['allInvestmentAtRisk', 'materialParticipation', 'profitMotive'] as AnswerKey[]).some(key => facts[key] === 'no');
  return <section className="space-y-4 rounded-lg border p-4" aria-labelledby="business-loss-title">
    <div><h3 id="business-loss-title" className="font-semibold">Business loss facts · {taxYear}</h3><p className="mt-1 text-sm text-muted-foreground">Needed only when your Schedule C shows a net loss for {taxYear}. A loss offsets other income in the estimate only after these declarations; blank answers need review and are not treated as No.</p></div>
    {stale && <p role="alert" className="text-sm">Your saved answers belong to another tax year. Review this section for {taxYear}.</p>}
    {yesNo('allInvestmentAtRisk', 'Is all of your investment in this business at risk? (Schedule C line 32a)', 'Choose No if any part is protected by nonrecourse financing, guarantees, stop-loss agreements or similar arrangements; that loss is limited on Form 6198.')}
    {yesNo('materialParticipation', 'Did you materially participate in this business during the year? (Schedule C line G)', 'Generally more than 500 hours, substantially all of the work, or another IRS material participation test. A No answer makes the loss a passive activity loss limited on Form 8582.')}
    {yesNo('profitMotive', 'Is this activity carried on to make a profit rather than as a hobby?', 'The IRS weighs nine factors (Regulation 1.183-2(b)): businesslike records, time and effort, expertise, history of income or losses, occasional profits and expectation of asset appreciation, among others. A hobby cannot deduct a loss.')}
    {limited && <p role="alert" className="text-sm">Keep your records for tax review. Losses limited by the at-risk, passive activity or hobby rules are not calculated here.</p>}
    <p className="text-xs text-muted-foreground">Save the organizer to apply changes. Answers are your declarations for the planning estimate; Forms 6198 and 8582 are not prepared, and the section 461(l) excess business loss limit is applied to this business only.</p>
  </section>;
}
