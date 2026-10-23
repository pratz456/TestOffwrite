/**
 * Date text as received for a charge whose day could not be read.
 * A blank is `missing`. This is not a parsed charge day.
 */
export function chargeDateSource(record: { date?: unknown; datetime?: unknown } | null | undefined): unknown {
  if (record == null || typeof record !== 'object') return undefined;
  return record.date !== undefined && record.date !== null ? record.date : record.datetime;
}

export function receivedChargeDateText(record: { date?: unknown; datetime?: unknown } | null | undefined): string {
  const source = chargeDateSource(record);
  if (source === undefined || source === null) return 'missing';
  if (typeof source === 'string') return source.trim() === '' ? 'missing' : source;
  if (typeof source === 'number') return Number.isFinite(source) ? String(source) : 'missing';
  if (source instanceof Date) return Number.isFinite(source.getTime()) ? source.toISOString() : 'missing';
  if (typeof source === 'object' && 'toDate' in source && typeof (source as { toDate?: unknown }).toDate === 'function') {
    try {
      const date = (source as { toDate: () => Date }).toDate();
      if (date instanceof Date && Number.isFinite(date.getTime())) return date.toISOString();
    } catch { /* unreadable timestamp */ }
  }
  return 'missing';
}
