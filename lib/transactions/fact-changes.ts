/** Saved facts that can change the AI review. Decisions, AI output and timestamps are excluded. */
export const TRANSACTION_FACT_FIELDS = ['notes', 'business_purpose', 'attendees', 'travel_destination', 'client_project',
  'documentation_status', 'meeting_notes', 'equipment_details', 'mileage_details'] as const;

function normalized(value: unknown): unknown {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ');
  if (Array.isArray(value)) return value.length ? value.map(normalized).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : '';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => [key, normalized(item)] as const)
      .filter(([, item]) => item !== '').sort(([a], [b]) => a.localeCompare(b));
    return entries.length ? Object.fromEntries(entries) : '';
  }
  return value ?? '';
}

export function hasTransactionFactChange(before: Record<string, unknown>, updates: Record<string, unknown>): boolean {
  return TRANSACTION_FACT_FIELDS.some(field => Object.prototype.hasOwnProperty.call(updates, field) &&
    JSON.stringify(normalized(before[field])) !== JSON.stringify(normalized(updates[field])));
}
