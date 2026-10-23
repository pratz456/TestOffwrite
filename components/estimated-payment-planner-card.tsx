'use client';

import React, { useRef, useState } from 'react';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { getNextDueDate } from '@/lib/tax-provider/quarterly-planner';
import { type PlannerCardView } from '@/lib/planner/card-view';
import { formatPlannerDueDate, formatPlannerMoney, localIsoDate } from '@/lib/planner/format-due-date';
import { plannerTaxYearForDate } from '@/lib/planner/past-due';
import { appliedCreditDate, defaultDesignatedTaxYear, paymentDateMax, paymentYearChoiceApplies, plannerFormHasLastYearNumbers, validatePlannerForm, type PlannerPaymentDraft } from '@/lib/planner/form-input';
import { newClientPaymentId } from '@/lib/planner/client-payment-id';
import { estimatedPaymentPlannerEnabled } from '@/lib/planner/planner-flag';
import {
  PLANNER_ADD_PAYMENT, PLANNER_AGI_HELPER, PLANNER_AGI_LABEL, PLANNER_ANSWER_NO, PLANNER_ANSWER_NOT_SURE,
  PLANNER_ANSWER_YES, PLANNER_CARD_INTRO, PLANNER_CARD_TITLE, PLANNER_CREDITS_HELPER, PLANNER_CREDITS_LABEL,
  PLANNER_DISMISS, PLANNER_DISMISSED, PLANNER_EMPTY, PLANNER_ERROR_LOAD, PLANNER_ERROR_SAVE, PLANNER_FILING_STATUS_LABEL,
  PLANNER_FILING_STATUS_PROFILE, PLANNER_FOOTER, PLANNER_LINE_24_HELPER, PLANNER_LINE_24_LABEL, PLANNER_NOT_NOW, PLANNER_NOT_SURE,
  PAYMENT_TAX_YEAR_PICKER_LABEL, PAYMENT_TYPE_PRIOR_YEAR_OVERPAYMENT_LABEL, PLANNER_APPLIED_AMOUNT_LABEL,
  APPLIED_OVERPAYMENT_CREDIT_NOTE, PLANNER_APPLIED_FILED_LABEL, PLANNER_APPLIED_PENDING, PLANNER_PAYMENT_AMOUNT, PLANNER_PAYMENT_DATE,
  PLANNER_PAYMENTS_HELPER, PLANNER_PAYMENTS_LABEL,
  PLANNER_PRIOR_TAX_COMPUTED, PLANNER_PROJECTED_INCOME_LABEL, PLANNER_RESIDENCY_LABEL, PLANNER_SEE_FULL_PLAN,
  PLANNER_SHOW_PLAN, PLANNER_START, PLANNER_TWELVE_MONTH_HELPER, PLANNER_TWELVE_MONTH_LABEL,
  PLANNER_WITHHOLDING_FROM_W2, PLANNER_WITHHOLDING_HELPER, PLANNER_WITHHOLDING_INCOME_LINK, PLANNER_WITHHOLDING_LABEL,
  plannerFill,
} from '@/lib/planner/planner-copy';
import { submitPlannerCard, type PlannerSubmitGuard, type PlannerTransport } from '@/lib/planner/submit-plan';
import { flooredPriorYearTax } from '@/lib/planner/zero-target';
import type { YesNoBlank } from '@/lib/planner/zero-target';

const FILING_OPTIONS = ['Single', 'Married Filing Jointly', 'Married Filing Separately', 'Head of Household'] as const;

function filingOption(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const key = value.trim().toLowerCase().replace(/\s+/g, '_');
  if (key === 'single') return 'Single';
  if (key === 'married_filing_jointly' || key === 'married') return 'Married Filing Jointly';
  if (key === 'married_filing_separately') return 'Married Filing Separately';
  if (key === 'head_of_household') return 'Head of Household';
  return FILING_OPTIONS.includes(value as typeof FILING_OPTIONS[number]) ? value : '';
}

async function readJson(response: Response): Promise<{ ok: boolean; status: number; body: unknown }> {
  const body = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body };
}

function browserTransport(): PlannerTransport {
  return {
    async postJson(url, body) {
      return readJson(await makeAuthenticatedRequest(url, { method: 'POST', body: JSON.stringify(body) }));
    },
    async getJson(url) {
      return readJson(await makeAuthenticatedRequest(url, { cache: 'no-store' }));
    },
  };
}

export function PlannerCardResult({ view, onSeePlan, onAddIncome }: { view: PlannerCardView; onSeePlan: () => void; onAddIncome: () => void }) {
  const seePlan = view.kind === 'plan' || view.kind === 'covered' || view.kind === 'no_twelve_month' || view.kind === 'missing'
    ? <button type="button" onClick={onSeePlan} className="min-h-11 text-sm font-semibold text-blue-700 underline">{PLANNER_SEE_FULL_PLAN}</button>
    : null;
  const addIncome = 'addIncome' in view && view.addIncome
    ? <button type="button" onClick={onAddIncome} className="min-h-11 text-left text-sm font-semibold text-blue-700 underline">{view.addIncome}</button>
    : null;
  return <div className="space-y-3">
    {view.kind === 'e1' && <p className="text-base font-medium text-slate-900">{view.message}</p>}
    {view.kind === 'case1' && <div className="space-y-2"><p className="text-base font-medium text-slate-900">{view.explanation}</p><p className="text-sm leading-6 text-slate-600">{view.penalty}</p></div>}
    {view.kind === 'case2' && <p className="text-base font-medium text-slate-900">{view.message}</p>}
    {view.kind === 'no_twelve_month' && <div className="space-y-2"><p className="text-sm leading-6 text-slate-700">{view.message}</p>{addIncome}</div>}
    {view.kind === 'not_sure' && <p className="text-sm leading-6 text-slate-700">{view.message}</p>}
    {view.kind === 'missing' && <p className="text-sm leading-6 text-slate-700">{view.message}</p>}
    {view.kind === 'covered' && <div className="space-y-2">
      <p className="text-sm text-slate-700">{view.annual}</p>
      <p className="text-base font-medium text-slate-900">{view.covered}</p>
      {view.deMinimis && <p className="text-sm leading-6 text-slate-700">{view.deMinimis}</p>}
      <p className="text-sm leading-6 text-slate-600">{view.penalty}</p>
      {view.basis && <p className="text-sm text-slate-700">{view.basis}</p>}
      {view.couldBeSmaller && <p className="text-sm leading-6 text-slate-700">{view.couldBeSmaller}</p>}
      {addIncome}
    </div>}
    {view.kind === 'plan' && <div className="space-y-2">
      {view.annual ? <p className="text-sm text-slate-700">{view.annual}</p> : null}
      {view.pastDueLine && <p className="text-base font-medium text-slate-900">{view.pastDueLine}</p>}
      {view.mode !== 'window' && view.pastDueSentence && <p className="text-sm leading-6 text-slate-600">{view.pastDueSentence}</p>}
      {view.allDueDatesPassed && <p className="text-sm leading-6 text-slate-600">{view.allDueDatesPassed}</p>}
      {view.mode === 'window' && view.pastDueSentence && <p className="text-sm leading-6 text-slate-600">{view.pastDueSentence}</p>}
      {view.q4FileAndPay && <p className="text-sm leading-6 text-slate-600">{view.q4FileAndPay}</p>}
      {view.next && <p className="text-xl font-semibold tracking-tight text-slate-900">{view.next}</p>}
      {view.mode === 'standard' && view.deMinimis && <p className="text-sm leading-6 text-slate-700">{view.deMinimis}</p>}
      {view.penalty && <p className="text-sm leading-6 text-slate-600">{view.penalty}</p>}
      {view.paidLate && <p className="text-sm leading-6 text-slate-600">{view.paidLate}</p>}
      {view.annualizedNote && <p className="text-sm leading-6 text-slate-600">{view.annualizedNote}</p>}
      {view.afterFinalHeading && <p className="text-base font-medium text-slate-900">{view.afterFinalHeading}</p>}
      {view.afterFinalDetail && <p className="text-sm leading-6 text-slate-600">{view.afterFinalDetail}</p>}
      {view.afterPenaltyEndNote && <p className="text-sm leading-6 text-slate-600">{view.afterPenaltyEndNote}</p>}
      {view.appliedPending && <p className="text-sm leading-6 text-slate-700">{view.appliedPending}</p>}
      {view.mode === 'after_final' && view.deMinimis && <p className="text-sm leading-6 text-slate-700">{view.deMinimis}</p>}
      {view.basis && <p className="text-sm text-slate-700">{view.basis}</p>}
      {view.couldBeSmaller && <p className="text-sm leading-6 text-slate-700">{view.couldBeSmaller}</p>}
      {addIncome}
    </div>}
    {seePlan}
    <p className="text-xs leading-5 text-slate-500">{view.footer}</p>
  </div>;
}

interface EstimatedPaymentPlannerCardProps {
  profile: { filing_status?: unknown; firstRunPlannerCard?: unknown; w2_federal_withheld?: unknown } | null | undefined;
  onNavigate: (screen: string) => void;
  transport?: PlannerTransport;
  taxYear?: number;
  asOf?: string;
  /** IANA zone for the default asOf. The device zone is used when this is omitted. */
  timeZone?: string;
  initialPhase?: 'collapsed' | 'form' | 'dismissed';
  initialW2?: { count: number; withheld: number } | null;
  initialPayments?: PlannerPaymentDraft[];
}

export function EstimatedPaymentPlannerCard({ profile, onNavigate, transport, taxYear: taxYearProp, asOf: asOfProp, timeZone, initialPhase = 'collapsed', initialW2 = null, initialPayments = [] }: EstimatedPaymentPlannerCardProps) {
  const asOf = asOfProp ?? localIsoDate(new Date(), timeZone);
  const taxYear = taxYearProp ?? plannerTaxYearForDate(asOf);
  const enabled = estimatedPaymentPlannerEnabled();
  const alreadySeen = profile?.firstRunPlannerCard === 'dismissed' || profile?.firstRunPlannerCard === 'completed';
  const [phase, setPhase] = useState<'collapsed' | 'form' | 'result' | 'dismissed' | 'hidden'>(alreadySeen ? 'hidden' : initialPhase);
  const [filingStatus, setFilingStatus] = useState(filingOption(profile?.filing_status));
  const [twelveMonth, setTwelveMonth] = useState<YesNoBlank | 'not_sure'>('');
  const [citizen, setCitizen] = useState<YesNoBlank>('');
  const [line24, setLine24] = useState('');
  const [credits, setCredits] = useState('');
  const [agi, setAgi] = useState('');
  const [withholding, setWithholding] = useState('');
  const [projected, setProjected] = useState('');
  const [payments, setPayments] = useState<PlannerPaymentDraft[]>(initialPayments);
  const [recorded, setRecorded] = useState<{ id: string; label: string }[]>([]);
  const [w2, setW2] = useState<{ count: number; withheld: number } | null>(initialW2);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [view, setView] = useState<PlannerCardView | null>(null);
  const guard = useRef<PlannerSubmitGuard>({ current: false, postedPaymentIds: new Set() });
  const loadedExtras = useRef(false);

  if (!enabled || phase === 'hidden') return null;

  const nextDue = (() => { try { return getNextDueDate(taxYear, asOf); } catch { return null; } })();
  const nextDueLabel = nextDue ? formatPlannerDueDate(nextDue.dueDate) : '';
  const lastYear = taxYear - 1;
  const formInput = {
    taxYear, asOf, filingStatus, twelveMonth, citizenOrResident: citizen, line24, credits, agi, withholding,
    hideWithholding: (w2?.count ?? 0) > 0, projectedIncome: projected, payments,
  };
  const showEmptyHint = !plannerFormHasLastYearNumbers(formInput);
  const line24Value = Number(line24.replace(/[$,\s]/g, ''));
  const creditsValue = Number(credits.replace(/[$,\s]/g, ''));
  const showComputed = line24.trim() !== '' && credits.trim() !== '' && Number.isFinite(line24Value) && Number.isFinite(creditsValue) && line24Value >= 0 && creditsValue >= 0;

  const dismiss = async () => {
    setError('');
    const client = transport ?? browserTransport();
    const saved = await client.postJson('/api/database/profiles', { firstRunPlannerCard: 'dismissed' });
    if (!saved.ok) { setError(PLANNER_ERROR_SAVE); return; }
    setPhase('dismissed');
  };

  const openForm = async () => {
    setPhase('form');
    if (loadedExtras.current) return;
    loadedExtras.current = true;
    const client = transport ?? browserTransport();
    try {
      const [w2Response, paymentResponse] = await Promise.all([
        client.getJson(`/api/income/w2?year=${taxYear}`),
        client.getJson(`/api/tax/quarterly-payments?year=${taxYear}`),
      ]);
      const w2Body = w2Response.body as { entries?: unknown[]; totalWithheld?: number } | null;
      if (w2Response.ok && w2Body && Array.isArray(w2Body.entries)) setW2({ count: w2Body.entries.length, withheld: Number(w2Body.totalWithheld) || 0 });
      const paymentBody = paymentResponse.body as { payments?: { quarter: number; paidAmount: number; paidDate: string | null }[] } | null;
      if (paymentResponse.ok && paymentBody?.payments) {
        setRecorded(paymentBody.payments.filter(item => item.paidAmount > 0).map(item => ({
          id: `q${item.quarter}`,
          label: `Q${item.quarter}: ${formatPlannerMoney(item.paidAmount)}${item.paidDate ? ` on ${item.paidDate}` : ''}`,
        })));
      }
    } catch { /* Recorded amounts stay blank and the form can still be saved. */ }
  };

  const submit = async () => {
    setError('');
    const checked = validatePlannerForm(formInput);
    setFieldErrors(Object.fromEntries(checked.errors.map(item => [item.field, item.message])));
    if (!checked.parsed) {
      if (checked.errors[0]) setError(checked.errors[0].message);
      return;
    }
    const result = await submitPlannerCard(formInput, transport ?? browserTransport(), guard.current);
    if (result.status === 'duplicate') return;
    if (result.status === 'invalid') { setError(result.message); return; }
    if (result.status === 'save_failed') { setError(result.message || PLANNER_ERROR_SAVE); return; }
    if (result.status === 'load_failed') { setError(result.message || PLANNER_ERROR_LOAD); return; }
    if (result.status === 'not_sure') return;
    setView(result.view);
    setPhase('result');
  };

  return <section role="region" aria-labelledby="estimated-payment-planner-title" className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
    <div className="flex items-start justify-between gap-2 px-4 pt-4 sm:px-5">
      <h2 id="estimated-payment-planner-title" className="text-base font-semibold text-slate-900">{PLANNER_CARD_TITLE}</h2>
      <button type="button" aria-label={PLANNER_DISMISS} onClick={() => void dismiss()} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-lg text-slate-500 hover:bg-slate-50">×</button>
    </div>
    <div className="space-y-3 px-4 pb-4 sm:px-5">
      {phase === 'dismissed' && <p className="text-sm leading-6 text-slate-700">{PLANNER_DISMISSED}</p>}
      {phase === 'collapsed' && <>
        <p className="text-sm leading-6 text-slate-600">{plannerFill(PLANNER_CARD_INTRO, { nextDueDate: nextDueLabel })}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void openForm()} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white">{PLANNER_START}</button>
          <button type="button" onClick={() => void dismiss()} className="min-h-11 rounded-lg px-4 text-sm font-medium text-slate-700">{PLANNER_NOT_NOW}</button>
        </div>
      </>}
      {phase === 'form' && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <p className="text-sm leading-6 text-slate-600">{plannerFill(PLANNER_CARD_INTRO, { nextDueDate: nextDueLabel })}</p>
        <label className="block text-sm font-medium text-slate-800" htmlFor="planner-filing-status">{plannerFill(PLANNER_FILING_STATUS_LABEL, { taxYear })}
          <select id="planner-filing-status" value={filingStatus} onChange={event => setFilingStatus(event.target.value)} className="mt-1 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-base">
            <option value="">Select</option>
            {FILING_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <p className="text-xs text-slate-500">{PLANNER_FILING_STATUS_PROFILE}</p>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-800">{plannerFill(PLANNER_TWELVE_MONTH_LABEL, { lastYear })}</legend>
          <div className="flex flex-wrap gap-2">{(['yes', 'no', 'not_sure'] as const).map(value => <button type="button" key={value} aria-pressed={twelveMonth === value} onClick={() => setTwelveMonth(value)} className={`min-h-11 rounded-lg border px-3 text-sm ${twelveMonth === value ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-700'}`}>{value === 'yes' ? PLANNER_ANSWER_YES : value === 'no' ? PLANNER_ANSWER_NO : PLANNER_ANSWER_NOT_SURE}</button>)}</div>
          <p className="text-xs leading-5 text-slate-500">{plannerFill(PLANNER_TWELVE_MONTH_HELPER, { lastYear })}</p>
          {twelveMonth === 'not_sure' && <p className="text-sm text-slate-700">{plannerFill(PLANNER_NOT_SURE, { lastYear })}</p>}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-800">{PLANNER_RESIDENCY_LABEL}</legend>
          <div className="flex flex-wrap gap-2">{(['yes', 'no'] as const).map(value => <button type="button" key={value} aria-pressed={citizen === value} onClick={() => setCitizen(value)} className={`min-h-11 rounded-lg border px-3 text-sm ${citizen === value ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-700'}`}>{value === 'yes' ? PLANNER_ANSWER_YES : PLANNER_ANSWER_NO}</button>)}</div>
        </fieldset>
        <AmountField id="planner-line24" label={PLANNER_LINE_24_LABEL} helper={plannerFill(PLANNER_LINE_24_HELPER, { lastYear })} value={line24} onChange={setLine24} error={fieldErrors.line24} />
        <AmountField id="planner-credits" label={PLANNER_CREDITS_LABEL} helper={PLANNER_CREDITS_HELPER} value={credits} onChange={setCredits} error={fieldErrors.credits} />
        {showComputed && <p className="text-sm text-slate-700">{plannerFill(PLANNER_PRIOR_TAX_COMPUTED, { amount: formatPlannerMoney(flooredPriorYearTax(line24Value, creditsValue)) })}</p>}
        <AmountField id="planner-agi" label={PLANNER_AGI_LABEL} helper={PLANNER_AGI_HELPER} value={agi} onChange={setAgi} error={fieldErrors.agi} />
        {(w2?.count ?? 0) > 0 ? <p className="text-sm text-slate-700">{plannerFill(PLANNER_WITHHOLDING_FROM_W2, { amount: formatPlannerMoney(w2?.withheld ?? 0) })} <button type="button" className="min-h-11 font-semibold text-blue-700 underline" onClick={() => onNavigate('income-tracking')}>{PLANNER_WITHHOLDING_INCOME_LINK}</button></p> : <AmountField id="planner-withholding" label={PLANNER_WITHHOLDING_LABEL} helper={PLANNER_WITHHOLDING_HELPER} value={withholding} onChange={setWithholding} error={fieldErrors.withholding} />}
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-800">{PLANNER_PAYMENTS_LABEL}</p>
          {recorded.map(item => <p key={item.id} className="text-sm text-slate-600">{item.label}</p>)}
          {payments.map(payment => {
            const applied = payment.kind === 'prior_year_overpayment';
            const lockedDate = appliedCreditDate(taxYear);
            const dateValue = applied ? lockedDate : payment.date;
            const yearChoice = !applied && paymentYearChoiceApplies(dateValue, taxYear);
            const designatedYear = defaultDesignatedTaxYear(dateValue, taxYear, payment.designatedTaxYear);
            const paymentYear = Number(dateValue.slice(0, 4));
            const pending = applied && payment.amount.trim() !== '' && payment.priorReturnFiled !== 'yes';
            return <div key={payment.clientId} className="grid gap-2 sm:grid-cols-2">
            {applied && <p className="text-sm font-medium text-slate-800 sm:col-span-2">{PAYMENT_TYPE_PRIOR_YEAR_OVERPAYMENT_LABEL}</p>}
            {applied && <p className="text-sm text-slate-600 sm:col-span-2">{APPLIED_OVERPAYMENT_CREDIT_NOTE}</p>}
            <label className="block text-xs text-slate-600">{PLANNER_PAYMENT_DATE}
              <input type="date" value={dateValue} min={applied ? lockedDate : `${taxYear}-01-01`} max={applied ? lockedDate : paymentDateMax(taxYear, asOf)} disabled={applied} readOnly={applied} onChange={event => { if (applied) return; setPayments(rows => rows.map(row => row.clientId !== payment.clientId ? row : { ...row, date: event.target.value, designatedTaxYear: defaultDesignatedTaxYear(event.target.value, taxYear, row.designatedTaxYear) ?? undefined })); }} className="mt-1 w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-base disabled:bg-slate-50" />
            </label>
            <label className="block text-xs text-slate-600">{applied ? plannerFill(PLANNER_APPLIED_AMOUNT_LABEL, { priorYear: taxYear - 1 }) : PLANNER_PAYMENT_AMOUNT}
              <input type="text" inputMode="decimal" value={payment.amount} onChange={event => setPayments(rows => rows.map(row => row.clientId === payment.clientId ? { ...row, amount: event.target.value } : row))} className="mt-1 w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-base" />
            </label>
            {applied && <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium text-slate-800">{plannerFill(PLANNER_APPLIED_FILED_LABEL, { priorYear: taxYear - 1 })}</legend>
              <div className="flex flex-wrap gap-2">{(['yes', 'no'] as const).map(value => <button type="button" key={value} aria-pressed={payment.priorReturnFiled === value} onClick={() => setPayments(rows => rows.map(row => row.clientId === payment.clientId ? { ...row, priorReturnFiled: value } : row))} className={`min-h-11 rounded-lg border px-3 text-sm ${payment.priorReturnFiled === value ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-700'}`}>{value === 'yes' ? PLANNER_ANSWER_YES : PLANNER_ANSWER_NO}</button>)}</div>
            </fieldset>}
            {pending && <p className="text-sm text-slate-700 sm:col-span-2">{PLANNER_APPLIED_PENDING}</p>}
            {yearChoice && <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium text-slate-800">{PAYMENT_TAX_YEAR_PICKER_LABEL}</legend>
              <div className="flex flex-wrap gap-2">{[paymentYear - 1, paymentYear].map(year => <button type="button" key={year} aria-pressed={designatedYear === year} onClick={() => setPayments(rows => rows.map(row => row.clientId === payment.clientId ? { ...row, designatedTaxYear: year } : row))} className={`min-h-11 rounded-lg border px-3 text-sm ${designatedYear === year ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-700'}`}>{year}</button>)}</div>
            </fieldset>}
            {fieldErrors[`payment-${payment.clientId}`] && <p className="text-sm text-red-700 sm:col-span-2">{fieldErrors[`payment-${payment.clientId}`]}</p>}
            {fieldErrors[`payment-date-${payment.clientId}`] && <p className="text-sm text-red-700 sm:col-span-2">{fieldErrors[`payment-date-${payment.clientId}`]}</p>}
          </div>;
          })}
          <button type="button" className="min-h-11 text-sm font-semibold text-blue-700" onClick={() => setPayments(rows => [...rows, { clientId: newClientPaymentId(), date: '', amount: '' }])}>{PLANNER_ADD_PAYMENT}</button>
          <button type="button" className="min-h-11 text-sm font-semibold text-blue-700" onClick={() => setPayments(rows => [...rows, { clientId: newClientPaymentId(), date: appliedCreditDate(taxYear), amount: '', kind: 'prior_year_overpayment', priorReturnFiled: '' }])}>{PAYMENT_TYPE_PRIOR_YEAR_OVERPAYMENT_LABEL}</button>
          <p className="text-xs leading-5 text-slate-500">{PLANNER_PAYMENTS_HELPER}</p>
        </div>
        <AmountField id="planner-projected" label={PLANNER_PROJECTED_INCOME_LABEL} helper="" value={projected} onChange={setProjected} error={fieldErrors.projectedIncome} />
        {showEmptyHint && <p className="text-sm text-slate-600">{PLANNER_EMPTY}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="sticky bottom-0 flex flex-wrap gap-2 bg-white py-2">
          <button type="submit" disabled={showEmptyHint || twelveMonth === '' || twelveMonth === 'not_sure' || !filingStatus} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">{PLANNER_SHOW_PLAN}</button>
          <button type="button" onClick={() => void dismiss()} className="min-h-11 rounded-lg px-4 text-sm font-medium text-slate-700">{PLANNER_NOT_NOW}</button>
        </div>
      </form>}
      {phase === 'result' && view && <PlannerCardResult view={view} onSeePlan={() => onNavigate('quarterly-taxes')} onAddIncome={() => onNavigate('income-tracking')} />}
      {phase !== 'result' && <p className="text-xs leading-5 text-slate-500">{PLANNER_FOOTER}</p>}
    </div>
  </section>;
}

function AmountField({ id, label, helper, value, onChange, error }: { id: string; label: string; helper: string; value: string; onChange: (value: string) => void; error?: string }) {
  return <label className="block text-sm font-medium text-slate-800" htmlFor={id}>{label}
    <input id={id} type="text" inputMode="decimal" value={value} onChange={event => onChange(event.target.value)} className="mt-1 w-full min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-base" />
    {helper && <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{helper}</span>}
    {error && <span className="mt-1 block text-sm font-normal text-red-700">{error}</span>}
  </label>;
}

export default EstimatedPaymentPlannerCard;
