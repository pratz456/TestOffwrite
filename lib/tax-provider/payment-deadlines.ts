/** Standard federal individual estimated-tax dates. Disaster relief and special filing exceptions are separate. */
export function getEstimatedTaxDeadline(year: number, quarter: number): Date {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new RangeError('Provide a valid year and quarter.');
  }
  const month = [3, 5, 8, 0][quarter - 1];
  const dueYear = year + (quarter === 4 ? 1 : 0);
  const due = new Date(Date.UTC(dueYear, month, 15, 12));
  // Washington, DC Emancipation Day affects the April deadline, including its observed day.
  const emancipation = new Date(Date.UTC(dueYear, 3, 16, 12));
  if (emancipation.getUTCDay() === 6) emancipation.setUTCDate(15);
  if (emancipation.getUTCDay() === 0) emancipation.setUTCDate(17);
  const isHoliday = (date: Date) =>
    (date.getUTCMonth() === 3 && date.getTime() === emancipation.getTime())
    || (date.getUTCMonth() === 0 && date.getUTCDay() === 1 && date.getUTCDate() >= 15 && date.getUTCDate() <= 21);
  while (due.getUTCDay() === 0 || due.getUTCDay() === 6 || isHoliday(due)) due.setUTCDate(due.getUTCDate() + 1);
  return due;
}

/**
 * Form 1040 due date for a calendar-year taxpayer: April 15 of the following year, moved for
 * weekends and DC Emancipation Day exactly like the first estimated-tax installment (§7503).
 * https://www.irs.gov/filing/individuals/when-to-file
 */
export function getIndividualReturnDueDate(taxYear: number): Date {
  return getEstimatedTaxDeadline(taxYear + 1, 1);
}

/** Next business day on or after the given UTC date (weekends only; no federal-holiday table). */
export function shiftWeekendToBusinessDay(date: Date): Date {
  const shifted = new Date(date.getTime());
  while (shifted.getUTCDay() === 0 || shifted.getUTCDay() === 6) shifted.setUTCDate(shifted.getUTCDate() + 1);
  return shifted;
}
