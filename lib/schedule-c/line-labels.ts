/**
 * Schedule C line labels for Other expenses.
 * resolveScheduleCPrint is the precedence for every row, confirmed or not:
 * 1. A saved label that names energy (179D, Form 7205, energy efficient) is Needs more information.
 * 2. A category that maps to Other expenses prints by charge year.
 * 3. An allowlisted label prints by charge year.
 * 4. Any other 27a or 27b label is Needs more information.
 */

/** Sentences from sibling commits e5bbc5f and 1b901a3 that name only Other expenses. */
const SIBLING_OTHER_EXPENSES_LABELS = new Set([
  'schedule c line 27a for 2023 and 2024, or 27b for 2025 and later',
  'schedule c line 27a for 2024 and earlier, or 27b for 2025 and later',
  '27a for 2023 and 2024, or 27b for 2025 and later',
  '27a for 2024 and earlier, or 27b for 2025 and later',
]);

export function collapseLineLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Energy-efficient commercial buildings deduction. Case- and space-insensitive. Hyphens count as spaces. */
export function isEnergyBuildings27b(value: string): boolean {
  const normalized = value.toLowerCase().replace(/[-\u2010-\u2015]/g, ' ').replace(/\s+/g, ' ');
  if (normalized.includes('energy efficient')) return true;
  if (/\b179\s*d\b/.test(normalized)) return true;
  return /\bform\s*7205\b/.test(normalized);
}

/**
 * "Schedule C" and "line" are optional. Runs of spaces are one space.
 * The space before "(" is optional. The only accepted parenthetical is "other expenses".
 */
const ALLOWLISTED_OTHER_EXPENSES = /^(?:schedule c )?(?:line )?27 ?[ab](?: ?\(other expenses\))?$/;

const UNKNOWN_27_LABEL = /^(?:schedule c )?(?:line )?27 ?[ab](?: ?\([^)]*\))?$/;

export function isAllowlistedOtherExpenses(value: string): boolean {
  const collapsed = collapseLineLabel(value);
  if (!collapsed || isEnergyBuildings27b(collapsed)) return false;
  return ALLOWLISTED_OTHER_EXPENSES.test(collapsed) || SIBLING_OTHER_EXPENSES_LABELS.has(collapsed);
}

/** A 27a or 27b label that is not the allowlist, including every energy-named label. */
export function isUnrecognized27Label(value: string): boolean {
  if (isEnergyBuildings27b(value)) return true;
  const collapsed = collapseLineLabel(value);
  if (!collapsed || isAllowlistedOtherExpenses(value)) return false;
  return UNKNOWN_27_LABEL.test(collapsed);
}

export type ScheduleCLabelClass = 'energy' | 'allowlisted' | 'unknown-27' | 'other';

export function classifyScheduleCLabel(value: string): ScheduleCLabelClass {
  const collapsed = collapseLineLabel(value);
  if (!collapsed) return 'other';
  if (isEnergyBuildings27b(collapsed)) return 'energy';
  if (isAllowlistedOtherExpenses(collapsed)) return 'allowlisted';
  if (UNKNOWN_27_LABEL.test(collapsed)) return 'unknown-27';
  return 'other';
}

export type ScheduleCPrint =
  | { kind: 'line'; line: string }
  | { kind: 'other-expenses' }
  | { kind: 'needs-more-information' }
  | { kind: 'passthrough' };

/**
 * Precedence for every row. Confirmation does not change it.
 * Energy is decided before the category, so a confirmed dues row labeled 27a (179D) stays Needs more information.
 */
export function resolveScheduleCPrint(input: {
  reviewStatus?: unknown;
  categoryLine: string | null;
  label: string | null | undefined;
}): ScheduleCPrint {
  const label = (input.label ?? '').trim();
  const kind = label ? classifyScheduleCLabel(label) : 'empty';
  const categoryLine = input.categoryLine;
  if (label && isEnergyBuildings27b(label)) return { kind: 'needs-more-information' };
  if (categoryLine === '27a' || categoryLine === '27b') return { kind: 'other-expenses' };
  if (kind === 'allowlisted') return { kind: 'other-expenses' };
  if (kind === 'unknown-27' || kind === 'energy') return { kind: 'needs-more-information' };
  if (label) return { kind: 'passthrough' };
  if (categoryLine) return { kind: 'line', line: categoryLine };
  return { kind: 'passthrough' };
}
