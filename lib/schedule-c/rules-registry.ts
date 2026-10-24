/**
 * Schedule C rule versions. v0 is sealed. Add a later version with
 * registerScheduleCRules; do not edit rules-v0.ts.
 */

import { aggregateScheduleC, CATEGORY_MAP, type AggregateScheduleCOptions, type AggregateScheduleCResult, type ScheduleCTransactionLike } from './aggregate';
import { aggregateScheduleC as aggregateV0, CATEGORY_MAP as categoryMapV0, safeTaxYear as readYearV0, safeYMD as readDateV0 } from './rules-v0';
import { safeTaxYear, safeYMD } from './taxDate';

export interface ScheduleCRuleSet {
  version: string;
  categoryMap: Record<string, { line: string; name: string; code: string }>;
  readDate: (dateLike: unknown) => string | null;
  readYear: (dateLike: unknown) => number | null;
  aggregate: (
    transactions: ScheduleCTransactionLike[],
    year: string,
    categoryMap?: Record<string, { line: string; name: string; code: string }>,
    options?: AggregateScheduleCOptions,
  ) => AggregateScheduleCResult;
}

/** Current behavior still matches v0. Bump this when a new version becomes current. */
export const CURRENT_SCHEDULE_C_RULES_VERSION = 'v0';

const versions = new Map<string, ScheduleCRuleSet>();

const v0Rules: ScheduleCRuleSet = {
  version: 'v0',
  categoryMap: categoryMapV0,
  readDate: readDateV0,
  readYear: readYearV0,
  aggregate: aggregateV0,
};

versions.set('v0', v0Rules);

export function registerScheduleCRules(rules: ScheduleCRuleSet): void {
  if (rules.version === 'v0') throw new Error('Schedule C rules v0 is frozen');
  versions.set(rules.version, rules);
}

export function getScheduleCRules(version: string): ScheduleCRuleSet | undefined {
  return versions.get(version);
}

export function frozenScheduleCRules(): ScheduleCRuleSet {
  const rules = versions.get('v0');
  if (!rules) throw new Error('Schedule C rules v0 is missing');
  return rules;
}

let currentOverride: ScheduleCRuleSet | null = null;

export function setCurrentScheduleCRulesForTests(rules: ScheduleCRuleSet | null): void {
  currentOverride = rules;
}

export function currentScheduleCRules(): ScheduleCRuleSet {
  if (currentOverride) return currentOverride;
  return {
    version: CURRENT_SCHEDULE_C_RULES_VERSION,
    categoryMap: CATEGORY_MAP,
    readDate: safeYMD,
    readYear: safeTaxYear,
    aggregate: aggregateScheduleC,
  };
}
