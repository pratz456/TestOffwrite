'use client';

import { useState } from 'react';
import styles from './expense-reset.module.css';

const steps = [
  ['Pick a month', 'Gather the statements and purchase records for that month. Include freelance spending paid from personal accounts.'],
  ['Match the evidence', 'Pair each expense with the available receipt, invoice and payment record. Keep the date, seller, amount and purchase description together.'],
  ['Add the work context', 'Note the client, project or business purpose while it is fresh. Flag spending that mixes freelance and personal use for review.'],
  ['Mark the loose ends', 'List missing documents, unclear charges, refunds and possible duplicates. Give every open item a next action.'],
  ['Make one review folder', 'Group the records by month. Include a short list of questions for your accountant or bookkeeper instead of guessing the treatment.'],
  ['Choose the next check-in', 'Pick a repeatable time to review the next batch. Small, regular sessions can keep the backlog manageable.'],
];

export default function ExpenseReset() {
  const [checked, setChecked] = useState<boolean[]>(steps.map(() => false));
  const complete = checked.filter(Boolean).length;

  return <div className={styles.page}>
    <main className={styles.main}>
      <header className={styles.header}>
        <a className={styles.brand} href="https://writeoffapp.com">WriteOff<span>.</span></a>
        <span className={styles.tag}>Free field guide · Freelancers</span>
      </header>
      <section className={styles.intro}>
        <div className={styles.eyebrow}>Less searching. Fewer loose ends.</div>
        <h1>The freelance<br />expense reset.</h1>
        <p className={styles.lead}>Start with one month. Put the records together while you still remember the work—then take clear questions to your accountant.</p>
      </section>
      <div className={styles.progress} aria-live="polite">
        <progress value={complete} max={steps.length} aria-label="Checklist progress" />
        <span>{complete} of {steps.length} complete</span>
      </div>
      <section className={styles.steps} aria-label="Expense organization checklist">
        {steps.map(([title, description], index) => <label className={styles.step} key={title}>
          <input type="checkbox" checked={checked[index]} onChange={(event) => {
            const next = [...checked];
            next[index] = event.target.checked;
            setChecked(next);
          }} />
          <span><strong>{String(index + 1).padStart(2, '0')} / {title}</strong><small>{description}</small></span>
        </label>)}
      </section>
      <section className={styles.example}>
        <div className={styles.eyebrow}>A fictional example</div>
        <h2>“$86 at a store” leaves a lot unanswered.</h2>
        <p>The itemized receipt shows $60 of client-shoot props and $26 of personal groceries. Keep the receipt, add the project name, and flag the personal portion. This example organizes the facts; it does not determine a deduction.</p>
      </section>
      <p className={styles.details}>Also have a salaried job? Keep that paperwork distinct from your freelance records. Having a receipt—or a work-related purchase—does not by itself establish deductibility.</p>
      <section className={styles.cta}>
        <div><h2>Make the next tax season less of a scramble.</h2><p>Explore WriteOff or talk with Pratham about where your expense records get stuck.</p></div>
        <div className={styles.actions}>
          <a className={styles.button} href="https://writeoffapp.com">Explore WriteOff ↗</a>
          <button className={styles.secondary} onClick={() => window.print()}>Print checklist</button>
        </div>
      </section>
      <p className={styles.foot}>writeoffapp.com · <a href="https://calendly.com/shahpratham99/30min">Book a founder conversation</a><br />
        General organization guide, September 2026. For recordkeeping requirements, see the <a href="https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep">IRS supporting-records guidance</a> and <a href="https://www.irs.gov/publications/p583">Publication 583</a>. This checklist does not decide tax eligibility. Checkmarks last until this page is closed or refreshed.
      </p>
    </main>
  </div>;
}
