'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, Loader2, Sparkles, Users } from 'lucide-react';
import type { Transaction } from '@/lib/firebase/transactions';
import { attendeesUpdates, BUSINESS_USE_CHOICES, businessUseUpdates, TAX_SETTINGS_HREF, type OpenQuestion } from '@/lib/transactions/review-proposals';

interface QuestionChipsProps {
  question: OpenQuestion;
  transaction: Pick<Transaction, 'equipment_details' | 'attendees'>;
  /** Proposed purpose to offer as a chip when the question asks for one but no deduction can be recorded yet. */
  proposal?: string | null;
  busy?: boolean;
  disabled?: boolean;
  /** Saves facts through the existing update route; never a tax decision. */
  onSave: (updates: Record<string, unknown>, message: string) => void | Promise<void>;
  onOpenDetails?: () => void;
  settingsHref?: string;
}

const chipClass = 'inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-background px-4 text-sm font-medium disabled:opacity-50';
const primaryChipClass = 'inline-flex min-h-11 items-center gap-1 rounded-full border border-primary bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50';

/**
 * One question at a time from the saved analysis, answered with a tap. Chips save
 * only allow-listed facts; the deduction itself is confirmed separately.
 */
export function QuestionChips({ question, transaction, proposal = null, busy = false, disabled = false, onSave, onOpenDetails, settingsHref = TAX_SETTINGS_HREF }: QuestionChipsProps) {
  const [attendeesOpen, setAttendeesOpen] = useState(false);
  const [attendees, setAttendees] = useState('');
  const [purpose, setPurpose] = useState('');
  const blocked = busy || disabled;
  const parsedAttendees = attendeesUpdates(attendees);
  const trimmedPurpose = purpose.replace(/\s+/g, ' ').trim();

  return (
    <section className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3" aria-labelledby="review-question-heading">
      <p id="review-question-heading" className="flex items-start gap-1.5 text-xs font-medium text-primary">
        <Sparkles aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{question.question}</span>
      </p>

      {question.kind === 'business_use_percentage' && <>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Business-use percentage">
          {BUSINESS_USE_CHOICES.map(percentage => (
            <button key={percentage} type="button" disabled={blocked} onClick={() => onSave(businessUseUpdates(transaction, percentage), `Business use saved: ${percentage}%`)} className={chipClass}>
              {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}{percentage}% business
            </button>
          ))}
        </div>
        <p className="text-xs leading-4 text-muted-foreground">Saves how much of this you use for business. The deduction is recorded only when you confirm it.</p>
      </>}

      {question.kind === 'meal_conditions' && (attendeesOpen ? (
        <div className="space-y-2">
          <label htmlFor="review-attendees" className="block text-sm font-medium">Who attended? Separate names with commas.</label>
          <textarea id="review-attendees" value={attendees} onChange={event => setAttendees(event.target.value)} rows={2} maxLength={2000} disabled={blocked}
            placeholder="For example: Jordan Lee (client), me" className="min-h-16 w-full rounded-lg border border-border bg-background p-3 text-base sm:text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={blocked} onClick={() => { setAttendeesOpen(false); setAttendees(''); }} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium">Cancel</button>
            <button type="button" disabled={blocked || !parsedAttendees} onClick={() => onSave(parsedAttendees!, 'Attendees saved')}
              className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}{busy ? 'Saving…' : 'Save attendees'}
            </button>
          </div>
          <p className="text-xs leading-4 text-muted-foreground">Business meals need who attended and what was discussed. Saving attendees does not record a deduction by itself.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={blocked} onClick={() => setAttendeesOpen(true)} className={primaryChipClass}><Users aria-hidden="true" className="h-4 w-4" />Client meal (add attendees)</button>
            {onOpenDetails && <button type="button" disabled={blocked} onClick={onOpenDetails} className={chipClass}>Something else<ChevronRight aria-hidden="true" className="h-4 w-4" /></button>}
          </div>
          <p className="text-xs leading-4 text-muted-foreground">Business meals need who attended and what was discussed. The 50% meal limit applies when a deduction is confirmed.</p>
        </>
      ))}

      {question.kind === 'settings_gate' && <>
        <Link href={settingsHref} className={primaryChipClass}>Update tax settings<ChevronRight aria-hidden="true" className="h-4 w-4" /></Link>
        <p className="text-xs leading-4 text-muted-foreground">This depends on the business entity and tax year saved in Settings. Update them, then run analysis again.</p>
      </>}

      {question.kind === 'business_purpose' && <div className="space-y-2">
        {proposal && <button type="button" disabled={blocked} onClick={() => setPurpose(proposal)} className={chipClass}>Use: {proposal}</button>}
        <label htmlFor="review-purpose-fact" className="sr-only">Business purpose</label>
        <textarea id="review-purpose-fact" value={purpose} onChange={event => setPurpose(event.target.value)} rows={2} maxLength={500} disabled={blocked}
          placeholder="Why was this needed for your business?" className="min-h-16 w-full rounded-lg border border-border bg-background p-3 text-base sm:text-sm" />
        <button type="button" disabled={blocked || !trimmedPurpose} onClick={() => onSave({ business_purpose: trimmedPurpose }, 'Business purpose saved')}
          className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}{busy ? 'Saving…' : 'Save purpose'}
        </button>
        <p className="text-xs leading-4 text-muted-foreground">Saves the purpose only. This category needs its own tax review before a deduction is recorded.</p>
      </div>}

      {question.kind === 'other' && <>
        {onOpenDetails && <button type="button" disabled={blocked} onClick={onOpenDetails} className={primaryChipClass}>Add details<ChevronRight aria-hidden="true" className="h-4 w-4" /></button>}
        <p className="text-xs leading-4 text-muted-foreground">Add the missing details, then run analysis again for an updated suggestion.</p>
      </>}
    </section>
  );
}
