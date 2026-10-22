"use client";

import React, { useState } from "react";
import Link from "next/link";
import { LandingHeader } from "@/components/landing/landing-header";
import { parseCalendarDay } from "@/lib/dates/calendar-day";
import {
  GIG_MILEAGE_GAP_COPY as copy,
  SHOW_DEDUCTION_ESTIMATE,
  formatGigMileageGapPeriod,
  formatMileageRateCents,
} from "@/lib/tools/gig-mileage-gap-copy";
import {
  calculateGigMileageGap,
  formatGigDollars,
  formatGigMiles,
  mileageRateSegments,
  mileageSegmentKey,
  parseMilesInput,
  type GigMileageGapResult,
  type GigMileagePeriodInput,
  type GigMileagePortion,
} from "@/lib/tools/gig-mileage-gap";

interface PeriodDraft {
  onTrip: string;
  toPickup: string;
  commute: string;
}

const EMPTY_PERIOD: PeriodDraft = { onTrip: "", toPickup: "", commute: "" };

const fieldClass =
  "w-full min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600";

export function GigMileageGapCalculatorClient() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [onTrip, setOnTrip] = useState("");
  const [toPickup, setToPickup] = useState("");
  const [commute, setCommute] = useState("");
  const [waiting, setWaiting] = useState("");
  const [odometer, setOdometer] = useState("");
  const [homeOffice, setHomeOffice] = useState(false);
  const [periodDrafts, setPeriodDrafts] = useState<Record<string, PeriodDraft>>({});

  const start = parseCalendarDay(startDate);
  const end = parseCalendarDay(endDate);
  const dateInvalid = (startDate.trim() !== "" && !start) || (endDate.trim() !== "" && !end);
  const dateOrder = Boolean(start && end && start.ymd > end.ymd);
  const segments = start && end && start.ymd <= end.ymd ? mileageRateSegments(start.ymd, end.ymd) : null;
  const needsSplit = Boolean(segments && segments.length > 1);

  const mainMiles = {
    onTrip: parseMilesInput(onTrip),
    toPickup: parseMilesInput(toPickup),
    commute: parseMilesInput(commute),
    waiting: parseMilesInput(waiting),
    odometer: parseMilesInput(odometer),
  };
  const milesInvalid = Object.values(mainMiles).some(item => !item.ok && item.reason === "invalid");
  const milesReady = Object.values(mainMiles).every(item => item.ok);

  let splitInvalid = false;
  let periodMiles: GigMileagePeriodInput[] | undefined;
  if (needsSplit && segments) {
    const rows: GigMileagePeriodInput[] = [];
    let ready = true;
    for (const segment of segments) {
      const draft = periodDrafts[mileageSegmentKey(segment)] ?? EMPTY_PERIOD;
      const trip = parseMilesInput(draft.onTrip);
      const pickup = parseMilesInput(draft.toPickup);
      const home = homeOffice ? parseMilesInput(draft.commute) : { ok: true as const, miles: 0 };
      if ((!trip.ok && trip.reason === "invalid") || (!pickup.ok && pickup.reason === "invalid") || (!home.ok && home.reason === "invalid")) {
        splitInvalid = true;
      }
      if (!trip.ok || !pickup.ok || !home.ok) ready = false;
      else rows.push({ from: segment.from, to: segment.to, onTripMiles: trip.miles, toPickupMiles: pickup.miles, commuteMiles: home.miles });
    }
    if (ready && !splitInvalid) periodMiles = rows;
  }

  let result: GigMileageGapResult | null = null;
  if (start && end && !dateOrder && milesReady && mainMiles.onTrip.ok && mainMiles.toPickup.ok && mainMiles.commute.ok && mainMiles.waiting.ok && mainMiles.odometer.ok) {
    result = calculateGigMileageGap({
      startDate: start.ymd,
      endDate: end.ymd,
      onTripMiles: mainMiles.onTrip.miles,
      toPickupMiles: mainMiles.toPickup.miles,
      commuteMiles: mainMiles.commute.miles,
      waitingMiles: mainMiles.waiting.miles,
      odometerMiles: mainMiles.odometer.miles,
      qualifyingHomeOffice: homeOffice,
      periodMiles,
    });
  }

  const updatePeriod = (key: string, field: keyof PeriodDraft, value: string) => {
    const current = periodDrafts[key] ?? EMPTY_PERIOD;
    setPeriodDrafts({ ...periodDrafts, [key]: { ...current, [field]: value } });
  };

  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-background text-gray-900">
      <LandingHeader />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <p className="mb-4 inline-flex min-h-11 items-center rounded-full bg-green-50 px-3 text-sm font-medium text-green-800">
          {copy.freeBadge}
        </p>
        <h1 className="mb-3 text-2xl font-semibold tracking-tight sm:text-3xl">{copy.h1}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-gray-700 sm:text-base">{copy.intro}</p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">{copy.privacyNote}</p>

        <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
          <form aria-labelledby="miles-heading" autoComplete="off" onSubmit={event => event.preventDefault()} className="rounded-xl border border-border bg-card p-4">
            <h2 id="miles-heading" className="text-lg font-semibold">{copy.formTitle}</h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-600">{copy.formDescription}</p>

            {dateInvalid ? <p id="date-error" role="alert" className="mt-3 text-sm text-red-700">{copy.invalidDate}</p> : null}
            {dateOrder ? <p id="date-order-error" role="alert" className="mt-3 text-sm text-red-700">{copy.endBeforeStart}</p> : null}
            {milesInvalid || splitInvalid ? <p id="miles-error" role="alert" className="mt-3 text-sm text-red-700">{copy.invalidMiles}</p> : null}

            <div className="mt-4 space-y-4">
              {milesField({
                id: "start-date",
                label: copy.startDateLabel,
                help: copy.startDateHelp,
                type: "date",
                value: startDate,
                invalid: dateInvalid || dateOrder,
                onChange: setStartDate,
              })}
              {milesField({
                id: "end-date",
                label: copy.endDateLabel,
                help: copy.endDateHelp,
                type: "date",
                value: endDate,
                invalid: dateInvalid || dateOrder,
                onChange: setEndDate,
              })}
              {milesField({ id: "on-trip", label: copy.onTripLabel, help: copy.onTripHelp, value: onTrip, invalid: milesInvalid, onChange: setOnTrip })}
              {milesField({ id: "to-pickup", label: copy.toPickupLabel, help: copy.toPickupHelp, value: toPickup, invalid: milesInvalid, onChange: setToPickup })}
              {milesField({ id: "commute", label: copy.commuteLabel, help: copy.commuteHelp, value: commute, invalid: milesInvalid, onChange: setCommute })}
              {milesField({ id: "waiting", label: copy.waitingLabel, help: copy.waitingHelp, value: waiting, invalid: milesInvalid, onChange: setWaiting })}
              {milesField({ id: "odometer", label: copy.odometerLabel, help: copy.odometerHelp, value: odometer, invalid: milesInvalid, onChange: setOdometer })}

              {SHOW_DEDUCTION_ESTIMATE ? (
                <label htmlFor="home-office" className="flex min-h-11 items-start gap-3 rounded-lg border border-gray-200 p-3">
                  <input
                    id="home-office"
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0 accent-green-700"
                    checked={homeOffice}
                    onChange={event => setHomeOffice(event.target.checked)}
                  />
                  <span>
                    <span className="block text-sm font-medium">{copy.homeOfficeLabel}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-gray-600">{copy.homeOfficeHelp}</span>
                  </span>
                </label>
              ) : null}

              {SHOW_DEDUCTION_ESTIMATE && needsSplit && segments ? (
                <fieldset className="space-y-4 rounded-lg border border-gray-200 p-3">
                  <legend className="px-1 text-sm font-semibold">{copy.periodLegend}</legend>
                  <p className="text-sm leading-relaxed text-gray-700">{segmentsCrossJuly(start!.ymd, end!.ymd) ? copy.splitPromptJuly : copy.splitPromptGeneric}</p>
                  {segments.map((segment, index) => {
                    const key = mileageSegmentKey(segment);
                    const draft = periodDrafts[key] ?? EMPTY_PERIOD;
                    const periodLabel = formatGigMileageGapPeriod(segment.from, segment.to);
                    return (
                      <div key={key} className="space-y-3 border-t border-gray-100 pt-3">
                        <p className="text-sm font-medium">{periodLabel}</p>
                        <p className="text-sm text-gray-700">{segment.ratePerMile === null ? copy.ratePending : formatMileageRateCents(segment.ratePerMile)}</p>
                        {milesField({
                          id: `period-${index}-on-trip`,
                          label: copy.periodOnTrip,
                          value: draft.onTrip,
                          invalid: splitInvalid,
                          onChange: value => updatePeriod(key, "onTrip", value),
                        })}
                        {milesField({
                          id: `period-${index}-to-pickup`,
                          label: copy.periodToPickup,
                          value: draft.toPickup,
                          invalid: splitInvalid,
                          onChange: value => updatePeriod(key, "toPickup", value),
                        })}
                        {homeOffice
                          ? milesField({
                            id: `period-${index}-commute`,
                            label: copy.periodCommute,
                            value: draft.commute,
                            invalid: splitInvalid,
                            onChange: value => updatePeriod(key, "commute", value),
                          })
                          : null}
                      </div>
                    );
                  })}
                </fieldset>
              ) : null}
            </div>
          </form>

          <section aria-labelledby="results-heading" className="rounded-xl border border-border bg-card p-4">
            <h2 id="results-heading" className="text-lg font-semibold">{copy.resultsTitle}</h2>
            <div aria-live="polite" className="mt-4 space-y-4">
              {result ? resultsView(result, splitInvalid) : <p className="text-sm text-gray-600">{copy.emptyResult}</p>}
              <p className="text-sm leading-relaxed text-gray-700">{copy.logNotice}</p>
              <Link href={copy.signupHref} prefetch={false} className="inline-flex min-h-11 items-center text-sm font-medium text-green-800 underline">
                {copy.signupLink}
              </Link>
            </div>
          </section>
        </div>

        <section aria-labelledby="how-heading" className="mt-6 rounded-xl border border-border bg-card p-4">
          <h2 id="how-heading" className="text-lg font-semibold">{copy.howTitle}</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">{SHOW_DEDUCTION_ESTIMATE ? copy.howBodyDeduction : copy.howBody}</p>
        </section>
        <p className="mt-4 text-sm text-gray-700">{copy.notTaxAdvice}</p>
      </main>
      <footer className="mt-6 border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-gray-600 sm:px-6 lg:px-8">
          <p>{copy.copyrightMark} {year} {copy.copyrightLine}</p>
          <nav aria-label={copy.footerNavLabel} className="flex flex-wrap gap-4">
            <Link href={copy.aboutHref} prefetch={false} className="inline-flex min-h-11 items-center hover:text-gray-900">{copy.footerAbout}</Link>
            <Link href={copy.blogHref} prefetch={false} className="inline-flex min-h-11 items-center hover:text-gray-900">{copy.footerBlog}</Link>
            <Link href={copy.privacyHref} prefetch={false} className="inline-flex min-h-11 items-center hover:text-gray-900">{copy.footerPrivacy}</Link>
            <Link href={copy.contactHref} prefetch={false} className="inline-flex min-h-11 items-center hover:text-gray-900">{copy.footerContact}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function segmentsCrossJuly(start: string, end: string): boolean {
  return start <= "2026-06-30" && end >= "2026-07-01";
}

function milesField(props: {
  id: string;
  label: string;
  help?: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
  type?: "text" | "date";
}) {
  const helpId = `${props.id}-help`;
  return (
    <div>
      <label htmlFor={props.id} className="mb-1 block text-sm font-medium text-gray-800">{props.label}</label>
      <input
        id={props.id}
        type={props.type ?? "text"}
        inputMode={props.type === "date" ? undefined : "decimal"}
        autoComplete="off"
        value={props.value}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.help ? helpId : undefined}
        onChange={event => props.onChange(event.target.value)}
        className={fieldClass}
      />
      {props.help ? <p id={helpId} className="mt-1 text-sm leading-relaxed text-gray-600">{props.help}</p> : null}
    </div>
  );
}

function resultsView(result: GigMileageGapResult, splitInvalid: boolean) {
  const period = result.segments.length
    ? formatGigMileageGapPeriod(result.segments[0].from, result.segments[result.segments.length - 1].to)
    : "";
  return (
    <div className="space-y-4">
      {period ? <p className="text-sm text-gray-700">{period}</p> : null}
      <div>
        <p className="text-sm font-medium text-gray-700">{copy.gapLabel}</p>
        <p className="text-3xl font-semibold tracking-tight">{formatGigMiles(result.gapMiles ?? 0)} {copy.milesUnit}</p>
        <p className="mt-1 text-sm leading-relaxed text-gray-600">{copy.gapHelp}</p>
      </div>
      <div>
        <h3 className="text-base font-semibold">{copy.gapSplitTitle}</h3>
        <dl className="mt-2 space-y-3">
          {splitRow(copy.gapToPickup, result.toPickupMiles ?? 0)}
          <div>
            <dt className="text-sm font-medium">{copy.gapCommute}</dt>
            <dd className="text-sm">{formatGigMiles(result.commuteMiles ?? 0)} {copy.milesUnit}</dd>
            <dd className="mt-1 text-sm leading-relaxed text-gray-700">{copy.commuteSeparate}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium">{copy.gapWaiting}</dt>
            <dd className="text-sm font-medium">{copy.waitingNotice}</dd>
            <dd className="text-sm">{formatGigMiles(result.waitingMiles ?? 0)} {copy.milesUnit}</dd>
            <dd className="mt-1 text-sm leading-relaxed text-gray-700">{copy.waitingDetail}</dd>
          </div>
          {result.unexplainedMiles !== null && result.unexplainedMiles < 0 ? (
            <div>
              <dt className="text-sm font-medium">{copy.gapOver}</dt>
              <dd className="text-sm">{formatGigMiles(Math.abs(result.unexplainedMiles))} {copy.milesUnit}</dd>
            </div>
          ) : (
            <div>
              <dt className="text-sm font-medium">{copy.gapUnexplained}</dt>
              <dd className="text-sm">{formatGigMiles(result.unexplainedMiles ?? 0)} {copy.milesUnit}</dd>
              {result.unexplainedMiles !== null && result.unexplainedMiles > 0 ? <dd className="mt-1 text-sm leading-relaxed text-gray-700">{copy.unexplainedNote}</dd> : null}
            </div>
          )}
        </dl>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-medium">{copy.milesToReviewLabel}</p>
        <p className="text-3xl font-semibold tracking-tight">{formatGigMiles(result.reviewMiles ?? 0)} {copy.milesUnit}</p>
        <p className="mt-1 text-sm leading-relaxed text-gray-700">{copy.milesToReviewHelp}</p>
        <dl className="mt-3 space-y-2">
          {splitRow(copy.reviewOnTrip, result.onTripMiles ?? 0)}
          {splitRow(copy.gapToPickup, result.toPickupMiles ?? 0)}
        </dl>
      </div>
      {SHOW_DEDUCTION_ESTIMATE ? deductionView(result, splitInvalid) : null}
    </div>
  );
}

function deductionView(result: GigMileageGapResult, splitInvalid: boolean) {
  const multiple = result.segments.length > 1;
  const showDollars = result.estimatedDeduction !== null && !splitInvalid;
  const showPendingSummary = result.portions.some(portion => portion.pricing === "rate-pending") && result.estimatedDeduction === null;
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-gray-700">{result.commuteIncluded ? copy.commuteIncluded : copy.commuteExcluded}</p>
      {multiple ? (
        <div className="space-y-3">
          {result.portions.map(portion => portionBlock(portion, showDollars))}
        </div>
      ) : result.portions[0] ? (
        <p className="text-sm text-gray-700">{result.portions[0].ratePerMile === null ? copy.ratePending : formatMileageRateCents(result.portions[0].ratePerMile)}</p>
      ) : null}
      {!splitInvalid && (result.splitStatus === "required" || result.splitStatus === "mismatch") ? (
        <p className="text-sm leading-relaxed text-gray-800">{result.crossesJuly12026 ? copy.splitPromptJuly : copy.splitPromptGeneric}</p>
      ) : null}
      {result.splitStatus === "mismatch" && !splitInvalid ? <p role="alert" className="text-sm text-red-700">{copy.splitMismatch}</p> : null}
      {showDollars ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-3xl font-semibold tracking-tight">{formatGigDollars(result.estimatedDeduction ?? 0)}</p>
          <p className="mt-1 text-sm font-medium leading-relaxed">{copy.estimatedDeductionLabel}</p>
          {result.portions.some(portion => portion.pricing === "rate-pending") ? <p className="mt-2 text-sm leading-relaxed text-gray-700">{copy.ratedPortionNote}</p> : null}
        </div>
      ) : null}
      {showPendingSummary ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xl font-semibold">{copy.ratePending}</p>
          <p className="mt-1 text-sm leading-relaxed text-gray-700">{copy.ratePendingDetail}</p>
        </div>
      ) : null}
    </div>
  );
}

function splitRow(label: string, miles: number) {
  return (
    <div>
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="text-sm">{formatGigMiles(miles)} {copy.milesUnit}</dd>
    </div>
  );
}

function portionBlock(portion: GigMileagePortion, showDollars: boolean) {
  const priced = portion.pricing === "priced" && portion.deduction !== null && showDollars;
  return (
    <div key={mileageSegmentKey(portion)} className="rounded-lg border border-gray-200 p-3">
      <p className="text-sm font-medium">{formatGigMileageGapPeriod(portion.from, portion.to)}</p>
      <p className="text-sm text-gray-700">{portion.ratePerMile === null ? copy.ratePending : formatMileageRateCents(portion.ratePerMile)}</p>
      {portion.businessMiles !== null ? <p className="text-sm">{formatGigMiles(portion.businessMiles)} {copy.milesUnit}</p> : <p className="text-sm text-gray-700">{copy.splitNeededForPeriod}</p>}
      {priced ? <p className="text-sm font-medium">{formatGigDollars(portion.deduction ?? 0)}</p> : null}
    </div>
  );
}
