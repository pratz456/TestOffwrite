/**
 * Schedule C "Other expenses" (Part V, carried from line 48).
 * For 2023 and later, line 27a is the energy efficient commercial buildings
 * deduction (Form 7205). Other expenses is line 27b.
 * https://www.irs.gov/instructions/i1040sc
 *
 * Analyses saved before this correction may still store the previous code on
 * ai_* transaction fields. Readers map that code. Nothing writes it back.
 */
export const SCHEDULE_C_OTHER_EXPENSES_LINE = '27b';

/** Code stored on older ai_* fields for other expenses. Not the published line. */
const STORED_OTHER_EXPENSES_LINE = '27a';

export function readStoredScheduleCLine<T extends string | null | undefined>(line: T): T {
  if (typeof line === 'string' && line.trim() === STORED_OTHER_EXPENSES_LINE) return SCHEDULE_C_OTHER_EXPENSES_LINE as T;
  return line;
}

/** A saved line code, or the composed "Schedule C line …" label on ai_explanation. */
export function readStoredScheduleCLineText<T extends string | null | undefined>(value: T): T {
  if (typeof value !== 'string') return value;
  const code = readStoredScheduleCLine(value);
  if (code !== value) return code;
  const prefix = `Schedule C line ${STORED_OTHER_EXPENSES_LINE}`;
  return (value.includes(prefix) ? value.replaceAll(prefix, `Schedule C line ${SCHEDULE_C_OTHER_EXPENSES_LINE}`) : value) as T;
}

/**
 * Read-time view of ai_* line fields. Returns the same object when nothing
 * stored the previous other-expenses code, and never mutates the saved record.
 */
export function readStoredAiScheduleCLines<T extends Record<string, any>>(record: T): T {
  const patch: Record<string, unknown> = {};
  if (typeof record.ai_schedule_c_line === 'string') {
    const line = readStoredScheduleCLine(record.ai_schedule_c_line);
    if (line !== record.ai_schedule_c_line) patch.ai_schedule_c_line = line;
  }
  const suggestion = record.ai_suggestion;
  if (suggestion && typeof suggestion === 'object') {
    const suggestionPatch: Record<string, unknown> = {};
    for (const key of ['scheduleCLine', 'schedule_c_line'] as const) {
      if (typeof suggestion[key] === 'string') {
        const line = readStoredScheduleCLine(suggestion[key] as string);
        if (line !== suggestion[key]) suggestionPatch[key] = line;
      }
    }
    if (Object.keys(suggestionPatch).length) patch.ai_suggestion = { ...suggestion, ...suggestionPatch };
  }
  const ai = record.ai;
  if (ai && typeof ai === 'object') {
    const aiPatch: Record<string, unknown> = {};
    for (const key of ['scheduleCLine', 'schedule_c_line'] as const) {
      if (typeof ai[key] === 'string') {
        const line = readStoredScheduleCLine(ai[key] as string);
        if (line !== ai[key]) aiPatch[key] = line;
      }
    }
    if (Object.keys(aiPatch).length) patch.ai = { ...ai, ...aiPatch };
  }
  const explanation = record.ai_explanation;
  if (explanation && typeof explanation === 'object' && typeof explanation.scheduleCLine === 'string') {
    const scheduleCLine = readStoredScheduleCLineText(explanation.scheduleCLine as string);
    if (scheduleCLine !== explanation.scheduleCLine) patch.ai_explanation = { ...explanation, scheduleCLine };
  }
  return Object.keys(patch).length ? { ...record, ...patch } : record;
}
