/**
 * Filed year guard. A past year stays on hold until that user confirms it.
 * An export does not end the hold. The current year never holds. Until
 * confirmation, a held year prints the stored export when one exists,
 * otherwise v0 on current data, and attaches the old versus new charge list.
 */

import type { LineItemSummary, ScheduleCTransactionLike } from './aggregate';
import {
  currentScheduleCRules,
  frozenScheduleCRules,
  getScheduleCRules,
  type ScheduleCRuleSet,
} from './rules-registry';

export {
  currentScheduleCRules,
  frozenScheduleCRules,
  getScheduleCRules,
  registerScheduleCRules,
  setCurrentScheduleCRulesForTests,
  CURRENT_SCHEDULE_C_RULES_VERSION,
  type ScheduleCRuleSet,
} from './rules-registry';

export const FILED_YEAR_COPY_MARKER = 'draft, awaiting copy approval';
export const NEEDS_MORE_INFORMATION = 'Needs more information';

export type MoveReason =
  | 'date read differently'
  | 'line changed'
  | 'moved to Needs more information'
  | 'amount changed';

export interface ScheduleCChargeSnapshot {
  id: string;
  line: string;
  amount: number;
}

export interface ScheduleCLineTotal {
  line: string;
  amount: number;
}

export interface ScheduleCExportSnapshot {
  rulesVersion: string;
  lineTotals: ScheduleCLineTotal[];
  totalDeductible: number;
  charges: ScheduleCChargeSnapshot[];
}

export interface ScheduleCMovedCharge {
  id: string;
  reason: MoveReason;
}

export interface ScheduleCLineChange {
  line: string;
  oldAmount: number;
  newAmount: number;
  change: number;
}

export interface ScheduleCLoweringRule {
  reason: MoveReason;
  amount: number;
}

export interface ScheduleCComparisonSection {
  baseline: 'stored-export' | 'rules-at-the-time';
  notice: string;
  oldTotal: number;
  newTotal: number;
  lineChanges: ScheduleCLineChange[];
  loweringRules: ScheduleCLoweringRule[];
  movedCharges: ScheduleCMovedCharge[];
}

export interface ScheduleCExportDecision {
  held: boolean;
  rulesVersion: string;
  lineItems: LineItemSummary[];
  totalDeductible: number;
  comparison: ScheduleCComparisonSection | null;
  snapshot: ScheduleCExportSnapshot;
  contribution: (tx: ScheduleCTransactionLike) => number;
}

let clock: () => Date = () => new Date();

export function setScheduleCClockForTests(next: (() => Date) | null): void {
  clock = next ?? (() => new Date());
}

export function scheduleCNow(): Date {
  return clock();
}

/** UTC year of the injectable clock, so a fixed instant is the same year in every timezone. */
export function currentCalendarYear(now: Date = scheduleCNow()): number {
  return now.getUTCFullYear();
}

export function shouldHoldYear(uid: string, year: number): boolean {
  // An export record does not end this hold. Only a confirmation for the year does,
  // and callers apply that check. The current year never holds.
  void uid;
  void year;
  return true;
}

/** Exact comparison sentence. The year is filled in. Draft until copy is approved. */
export function comparisonScreenWording(year: number): string {
  return `your ${year} total under the rules at the time, on your current data`;
}

export function loweringRuleSentence(rule: ScheduleCLoweringRule): string {
  const reason = rule.reason === 'date read differently' ? 'Date read differently'
    : rule.reason === 'line changed' ? 'Line changed'
    : rule.reason === 'moved to Needs more information' ? 'Moved to Needs more information'
    : 'Amount changed';
  return `${reason} lowered the total by ${copyMoney(rule.amount)}.`;
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function chargeKey(tx: { id?: unknown; trans_id?: unknown }, index: number): string {
  const raw = tx.trans_id ?? tx.id;
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return `unidentified ${index + 1}`;
}

function moneyCents(value: number): number {
  return Math.round(value * 100);
}

function placementDeductible(line: string, amount: number): number {
  const cents = moneyCents(amount);
  if (line !== '24b') return cents / 100;
  const abs = Math.abs(cents);
  const rounded = Math.floor(abs / 2) + (abs % 2);
  return (cents < 0 ? -rounded : rounded) / 100;
}

function publishedLine(line: string, taxYear: number): string {
  return line === '27a' && taxYear >= 2025 ? '27b' : line;
}

function compareLineCodes(a: string, b: string): number {
  return parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10);
}

export function copyMoney(value: number): string {
  const cents = moneyCents(value);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = `$${dollars}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `negative ${text}` : text;
}

function dollarChange(change: number): string {
  if (moneyCents(change) === 0) return copyMoney(0);
  return `${change > 0 ? 'up' : 'down'} ${copyMoney(Math.abs(change))}`;
}

function lineName(line: string, rules: ScheduleCRuleSet): string {
  const entry = Object.values(rules.categoryMap).find(item => item.line === line);
  if (entry) return entry.name;
  if (line === NEEDS_MORE_INFORMATION) return NEEDS_MORE_INFORMATION;
  return line === '27a' ? 'Other expenses' : line;
}

function keysFor(transactions: ScheduleCTransactionLike[]): Map<ScheduleCTransactionLike, string> {
  const keys = new Map<ScheduleCTransactionLike, string>();
  transactions.forEach((tx, index) => keys.set(tx, chargeKey(tx, index)));
  return keys;
}

function snapshotFromLineItems(rulesVersion: string, lineItems: LineItemSummary[], keys: Map<ScheduleCTransactionLike, string>): ScheduleCExportSnapshot {
  const charges: ScheduleCChargeSnapshot[] = [];
  for (const line of lineItems) {
    line.transactions.forEach((tx, index) => {
      const id = keys.get(tx) ?? (typeof tx.id === 'string' && tx.id ? tx.id : chargeKey(tx, index));
      charges.push({ id, line: line.lineCode, amount: roundMoney(Number(tx.amount) || 0) });
    });
  }
  const lineTotals = lineItems.map(line => ({ line: line.lineCode, amount: roundMoney(line.deductible) }));
  const totalDeductible = roundMoney(lineTotals.reduce((sum, line) => sum + line.amount, 0));
  return { rulesVersion, lineTotals, totalDeductible, charges };
}

function lineItemsFromSnapshot(snapshot: ScheduleCExportSnapshot, transactions: ScheduleCTransactionLike[], keys: Map<ScheduleCTransactionLike, string>, rules: ScheduleCRuleSet): LineItemSummary[] {
  const byId = new Map<string, ScheduleCTransactionLike>();
  transactions.forEach(tx => {
    const id = keys.get(tx);
    if (id) byId.set(id, tx);
  });
  const groups = new Map<string, LineItemSummary>();
  const ensure = (line: string) => {
    let group = groups.get(line);
    if (!group) {
      group = { lineCode: line, lineName: lineName(line, rules), total: 0, deductible: 0, transactionCount: 0, transactions: [] };
      groups.set(line, group);
    }
    return group;
  };
  for (const charge of snapshot.charges) {
    const source = byId.get(charge.id);
    const tx: ScheduleCTransactionLike = source
      ? { ...source, id: charge.id, amount: charge.amount }
      : { id: charge.id, amount: charge.amount, date: '', category: '' };
    const group = ensure(charge.line || '27a');
    group.transactions.push(tx);
    group.transactionCount += 1;
    group.total = roundMoney(group.total + charge.amount);
  }
  const seen = new Set<string>();
  for (const row of snapshot.lineTotals) {
    const group = ensure(row.line);
    group.deductible = roundMoney((seen.has(row.line) ? group.deductible : 0) + row.amount);
    seen.add(row.line);
  }
  for (const group of groups.values()) {
    if (!seen.has(group.lineCode)) group.deductible = roundMoney(group.total);
  }
  return [...groups.values()].sort((a, b) => compareLineCodes(a.lineCode, b.lineCode));
}

function needsInfo(rules: ScheduleCRuleSet, tx: ScheduleCTransactionLike | undefined): boolean {
  if (!tx || typeof tx.category !== 'string') return false;
  const entry = rules.categoryMap[tx.category];
  return !!entry && (entry.name === NEEDS_MORE_INFORMATION || entry.line === NEEDS_MORE_INFORMATION);
}

interface Placement { id: string; line: string; amount: number }

function reasonFor(
  tx: ScheduleCTransactionLike | undefined,
  oldPlacement: Placement | undefined,
  newPlacement: Placement | undefined,
  current: ScheduleCRuleSet,
  frozen: ScheduleCRuleSet,
): MoveReason | null {
  if (!oldPlacement && !newPlacement) return null;
  const dateDiff = !!tx && frozen.readDate(tx.date) !== current.readDate(tx.date);
  const yearDiff = !!tx && frozen.readYear(tx.date) !== current.readYear(tx.date);
  const lineDiff = (oldPlacement?.line ?? null) !== (newPlacement?.line ?? null);
  const amountDiff = !oldPlacement || !newPlacement || moneyCents(oldPlacement.amount) !== moneyCents(newPlacement.amount);
  if (!dateDiff && !lineDiff && !amountDiff) return null;
  if (dateDiff && (yearDiff || !oldPlacement || !newPlacement)) return 'date read differently';
  if (needsInfo(current, tx) && !needsInfo(frozen, tx)) return 'moved to Needs more information';
  if (lineDiff) return 'line changed';
  if (amountDiff) return 'amount changed';
  return null;
}

function buildNotice(year: number, section: Omit<ScheduleCComparisonSection, 'notice'>): string {
  const baseline = section.baseline === 'rules-at-the-time'
    ? `This comparison uses your ${year} total under the rules at the time, on your current data.`
    : `This comparison uses the total saved from your last export for ${year}.`;
  const lines = section.lineChanges.map(row => `Line ${row.line} dollar change is ${dollarChange(row.change)}.`);
  const reasons = [...new Set(section.movedCharges.map(charge => charge.reason))];
  const since = section.baseline === 'stored-export' ? ' since export' : '';
  const reasonText = reasons.join(', ');
  const count = section.movedCharges.length;
  const charges = count === 0 ? ''
    : count === 1 ? `1 charge changed${since} because its ${reasonText}.`
    : `${count} charges changed${since}. Reasons: ${reasonText}.`;
  const head = [
    `${FILED_YEAR_COPY_MARKER}.`,
    'Totals changed.',
    baseline,
    `That total was ${copyMoney(section.oldTotal)}.`,
    `The total under the current rules is ${copyMoney(section.newTotal)}.`,
    ...lines,
    charges,
  ].filter(Boolean).join(' ');
  const rules = section.loweringRules.map(loweringRuleSentence);
  return rules.length ? `${head}\n${rules.join('\n')}` : head;
}

function buildComparison(input: {
  year: number;
  transactions: ScheduleCTransactionLike[];
  keys: Map<ScheduleCTransactionLike, string>;
  baseline: ScheduleCComparisonSection['baseline'];
  oldSnapshot: ScheduleCExportSnapshot;
  current: ScheduleCRuleSet;
  frozen: ScheduleCRuleSet;
  currentPlacements: Map<string, Placement>;
  currentLines: Map<string, number>;
  newTotal: number;
}): ScheduleCComparisonSection | null {
  const oldPlacements = new Map<string, Placement>();
  for (const charge of input.oldSnapshot.charges) {
    oldPlacements.set(charge.id, { id: charge.id, line: charge.line, amount: roundMoney(charge.amount) });
  }
  const txById = new Map<string, ScheduleCTransactionLike>();
  input.transactions.forEach(tx => {
    const id = input.keys.get(tx);
    if (id) txById.set(id, tx);
  });
  const ids = [...new Set([...oldPlacements.keys(), ...input.currentPlacements.keys()])].sort();
  const movedCharges: ScheduleCMovedCharge[] = [];
  const loweringRules: ScheduleCLoweringRule[] = [];
  for (const id of ids) {
    const oldPlacement = oldPlacements.get(id);
    const newPlacement = input.currentPlacements.get(id);
    const reason = reasonFor(txById.get(id), oldPlacement, newPlacement, input.current, input.frozen);
    if (!reason) continue;
    movedCharges.push({ id, reason });
    const delta = roundMoney(placementDeductible(newPlacement?.line ?? '', newPlacement?.amount ?? 0) - placementDeductible(oldPlacement?.line ?? '', oldPlacement?.amount ?? 0));
    if (delta < 0) loweringRules.push({ reason, amount: roundMoney(-delta) });
  }
  const oldLines = new Map<string, number>();
  for (const row of input.oldSnapshot.lineTotals) oldLines.set(row.line, roundMoney((oldLines.get(row.line) ?? 0) + row.amount));
  const lineCodes = [...new Set([...oldLines.keys(), ...input.currentLines.keys()])].sort(compareLineCodes);
  const lineChanges: ScheduleCLineChange[] = [];
  for (const code of lineCodes) {
    const oldAmount = oldLines.get(code) ?? 0;
    const newAmount = input.currentLines.get(code) ?? 0;
    if (moneyCents(oldAmount) === moneyCents(newAmount)) continue;
    lineChanges.push({
      line: publishedLine(code, input.year),
      oldAmount,
      newAmount,
      change: roundMoney(newAmount - oldAmount),
    });
  }
  const oldTotal = roundMoney(input.oldSnapshot.totalDeductible);
  const newTotal = roundMoney(input.newTotal);
  if (!movedCharges.length && !lineChanges.length && moneyCents(oldTotal) === moneyCents(newTotal)) return null;
  const partial = { baseline: input.baseline, oldTotal, newTotal, lineChanges, loweringRules, movedCharges };
  return { ...partial, notice: buildNotice(input.year, partial) };
}

function placementsFor(resultLines: LineItemSummary[], keys: Map<ScheduleCTransactionLike, string>): Map<string, Placement> {
  const map = new Map<string, Placement>();
  for (const line of resultLines) {
    line.transactions.forEach((tx, index) => {
      const id = keys.get(tx) ?? (typeof tx.id === 'string' && tx.id ? tx.id : chargeKey(tx, index));
      map.set(id, { id, line: line.lineCode, amount: roundMoney(Number(tx.amount) || 0) });
    });
  }
  return map;
}

function rulesForVersion(version: string): ScheduleCRuleSet {
  if (version === currentScheduleCRules().version) return currentScheduleCRules();
  return getScheduleCRules(version) ?? frozenScheduleCRules();
}

function contributionFor(rules: ScheduleCRuleSet, year: number): (tx: ScheduleCTransactionLike) => number {
  return tx => rules.aggregate([tx], String(year), rules.categoryMap, { mode: 'confirmed-only' }).totalDeductible;
}

export function decideScheduleCExport(input: {
  uid: string;
  year: number;
  transactions: ScheduleCTransactionLike[];
  prior: ScheduleCExportSnapshot | null;
  confirmedRulesVersion: string | null;
  now?: Date;
}): ScheduleCExportDecision {
  const now = input.now ?? scheduleCNow();
  const current = currentScheduleCRules();
  const frozen = frozenScheduleCRules();
  const past = input.year < currentCalendarYear(now);
  const confirmed = input.confirmedRulesVersion === current.version;
  const held = past && shouldHoldYear(input.uid, input.year) && !confirmed;
  const keys = keysFor(input.transactions);
  const currentResult = current.aggregate(input.transactions, String(input.year), current.categoryMap, { mode: 'confirmed-only' });

  if (!held) {
    const lineItems = currentResult.lineItemsArray;
    return {
      held: false,
      rulesVersion: current.version,
      lineItems,
      totalDeductible: currentResult.totalDeductible,
      comparison: null,
      snapshot: snapshotFromLineItems(current.version, lineItems, keys),
      contribution: contributionFor(current, input.year),
    };
  }

  const frozenResult = frozen.aggregate(input.transactions, String(input.year), frozen.categoryMap, { mode: 'confirmed-only' });
  const oldSnapshot = input.prior ?? snapshotFromLineItems(frozen.version, frozenResult.lineItemsArray, keys);
  const lineItems = input.prior
    ? lineItemsFromSnapshot(input.prior, input.transactions, keys, rulesForVersion(input.prior.rulesVersion))
    : frozenResult.lineItemsArray;
  const currentLines = new Map<string, number>();
  for (const line of currentResult.lineItemsArray) currentLines.set(line.lineCode, roundMoney(line.deductible));
  const comparison = buildComparison({
    year: input.year,
    transactions: input.transactions,
    keys,
    baseline: input.prior ? 'stored-export' : 'rules-at-the-time',
    oldSnapshot,
    current,
    frozen,
    currentPlacements: placementsFor(currentResult.lineItemsArray, keys),
    currentLines,
    newTotal: currentResult.totalDeductible,
  });
  const rulesVersion = input.prior?.rulesVersion ?? frozen.version;
  return {
    held,
    rulesVersion,
    lineItems,
    totalDeductible: roundMoney(lineItems.reduce((sum, line) => sum + line.deductible, 0)),
    comparison,
    snapshot: snapshotFromLineItems(rulesVersion, lineItems, keys),
    contribution: contributionFor(rulesForVersion(rulesVersion), input.year),
  };
}
