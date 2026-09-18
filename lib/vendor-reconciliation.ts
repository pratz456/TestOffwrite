export const REQUIRED_CSV_COLUMNS = [
  "reference",
  "date",
  "type",
  "amount",
] as const;
export const OPTIONAL_CSV_COLUMNS = ["payment_status"] as const;
export const MAX_INVOICE_CREDIT_ROWS = 150;
// Kept as a compatibility alias for existing UI imports.
export const MAX_ROWS_PER_FILE = MAX_INVOICE_CREDIT_ROWS;

export type ReconciliationSource = "statement" | "ledger";
export type TransactionType = "invoice" | "credit" | "payment";
export type FindingStatus =
  | "matched"
  | "statement_only"
  | "ledger_only"
  | "possible_duplicate"
  | "amount_mismatch"
  | "payment_mismatch"
  | "review_required";

export type ReconciliationProvenance = {
  vendor: string;
  location: string;
  periodStart: string;
  periodEnd: string;
};

export type ParsedRecord = {
  id: string;
  source: ReconciliationSource;
  sourceName: string;
  rowNumber: number;
  reference: string;
  normalizedReference: string;
  date: string;
  type: TransactionType;
  amountCents: number;
  paymentStatus: string;
};

export type SourceTrace = Pick<
  ParsedRecord,
  | "id"
  | "source"
  | "sourceName"
  | "rowNumber"
  | "reference"
  | "date"
  | "type"
  | "amountCents"
  | "paymentStatus"
>;

export type ReconciliationFinding = {
  id: string;
  status: FindingStatus;
  reference: string;
  type: TransactionType;
  statementAmountCents?: number;
  ledgerAmountCents?: number;
  statementTraces: SourceTrace[];
  ledgerTraces: SourceTrace[];
  rule: string;
  detail: string;
};

export type ReconciliationSummary = Record<FindingStatus, number> & {
  rowsProcessed: number;
  exceptionCount: number;
};

export type ReconciliationReport = {
  generatedAt: string;
  statementName: string;
  ledgerName: string;
  provenance: ReconciliationProvenance;
  findings: ReconciliationFinding[];
  summary: ReconciliationSummary;
};

export class CsvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvValidationError";
  }
}

export class ReconciliationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconciliationValidationError";
  }
}

type CsvRow = {
  values: string[];
  rowNumber: number;
};

const ALLOWED_COLUMNS = new Set<string>([
  ...REQUIRED_CSV_COLUMNS,
  ...OPTIONAL_CSV_COLUMNS,
]);
const ALLOWED_TYPES = new Set<TransactionType>([
  "invoice",
  "credit",
  "payment",
]);

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeReference(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeStatus(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, "_");
}

function parseCsvRows(csv: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let values: string[] = [];
  let field = "";
  let quoted = false;
  let justClosedQuote = false;
  let lineNumber = 1;
  let rowNumber = 1;

  const finishRow = () => {
    rows.push({ values: [...values, field], rowNumber });
    values = [];
    field = "";
    justClosedQuote = false;
  };

  const finishLine = (carriageReturn: boolean) => {
    finishRow();
    if (carriageReturn) {
      // The caller consumes the following LF for a CRLF pair.
    }
    lineNumber += 1;
    rowNumber = lineNumber;
  };

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];

    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          justClosedQuote = true;
        }
      } else if (character === "\r" && csv[index + 1] === "\n") {
        field += "\r\n";
        index += 1;
        lineNumber += 1;
      } else {
        field += character;
        if (character === "\n" || character === "\r") lineNumber += 1;
      }
      continue;
    }

    if (justClosedQuote) {
      if (character === ",") {
        values.push(field);
        field = "";
        justClosedQuote = false;
      } else if (character === "\r" && csv[index + 1] === "\n") {
        finishLine(true);
        index += 1;
      } else if (character === "\n" || character === "\r") {
        finishLine(false);
      } else {
        throw new CsvValidationError(
          `Line ${lineNumber}: unexpected character after a closing quote.`,
        );
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) {
        throw new CsvValidationError(
          `Line ${lineNumber}: a quoted field must begin with a quote.`,
        );
      }
      quoted = true;
    } else if (character === ",") {
      values.push(field);
      field = "";
    } else if (character === "\r" && csv[index + 1] === "\n") {
      finishLine(true);
      index += 1;
    } else if (character === "\n" || character === "\r") {
      finishLine(false);
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new CsvValidationError(
      `Line ${rowNumber}: the CSV contains an unclosed quoted value.`,
    );
  }

  if (field.length > 0 || values.length > 0 || justClosedQuote) {
    finishRow();
  }

  return rows;
}

function isBlankRow(row: CsvRow): boolean {
  return row.values.every((value) => value.trim().length === 0);
}

function isStrictIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function parseDate(value: string, rowNumber: number): string {
  if (value !== value.trim() || !isStrictIsoDate(value)) {
    throw new CsvValidationError(
      `Row ${rowNumber}: date must be a valid YYYY-MM-DD value with no surrounding whitespace.`,
    );
  }
  return value;
}

function parseAmount(value: string, rowNumber: number): number {
  const ungrouped = /^-?\$?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
  const grouped = /^-?\$?[1-9]\d{0,2}(?:,\d{3})+(?:\.\d{1,2})?$/;

  if (
    value !== value.trim() ||
    value.includes(" ") ||
    (!ungrouped.test(value) && !grouped.test(value))
  ) {
    throw new CsvValidationError(
      `Row ${rowNumber}: amount must use a plain leading minus, optional leading $, valid comma groups, and at most two decimal places.`,
    );
  }

  const negative = value.startsWith("-");
  const unsigned = value.replace(/^-/, "").replace(/^\$/, "").replace(/,/g, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const absoluteCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  const cents = negative ? -absoluteCents : absoluteCents;

  if (!Number.isSafeInteger(cents)) {
    throw new CsvValidationError(
      `Row ${rowNumber}: amount is outside the supported range.`,
    );
  }

  return cents;
}

function parseType(value: string, rowNumber: number): TransactionType {
  if (value !== value.trim()) {
    throw new CsvValidationError(
      `Row ${rowNumber}: type cannot contain surrounding whitespace.`,
    );
  }

  const type = value.toLowerCase() as TransactionType;
  if (!ALLOWED_TYPES.has(type)) {
    throw new CsvValidationError(
      `Row ${rowNumber}: type must be invoice, credit, or payment.`,
    );
  }
  return type;
}

function parseStatus(value: string, rowNumber: number): string {
  if (value !== value.trim()) {
    throw new CsvValidationError(
      `Row ${rowNumber}: payment_status cannot contain surrounding whitespace.`,
    );
  }
  if (value && !/^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/.test(value)) {
    throw new CsvValidationError(
      `Row ${rowNumber}: payment_status contains unsupported characters.`,
    );
  }
  return normalizeStatus(value);
}

export function parseReconciliationCsv(
  csv: string,
  source: ReconciliationSource,
  sourceName: string,
): ParsedRecord[] {
  const rows = parseCsvRows(csv);
  const headerIndex = rows.findIndex((row) => !isBlankRow(row));
  if (headerIndex < 0) {
    throw new CsvValidationError("Add a header row and at least one data row.");
  }

  const headerRow = rows[headerIndex];
  const headers = headerRow.values.map(normalizeHeader);
  const duplicateHeaders = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  if (duplicateHeaders.length > 0) {
    throw new CsvValidationError(
      `Duplicate column${duplicateHeaders.length === 1 ? "" : "s"}: ${[
        ...new Set(duplicateHeaders),
      ].join(", ")}.`,
    );
  }

  const unexpectedHeaders = headers.filter(
    (header) => !ALLOWED_COLUMNS.has(header),
  );
  if (unexpectedHeaders.length > 0) {
    throw new CsvValidationError(
      `Remove unsupported column${unexpectedHeaders.length === 1 ? "" : "s"} before continuing: ${unexpectedHeaders.join(
        ", ",
      )}. This prototype accepts only redacted matching fields.`,
    );
  }

  const missingHeaders = REQUIRED_CSV_COLUMNS.filter(
    (header) => !headers.includes(header),
  );
  if (missingHeaders.length > 0) {
    throw new CsvValidationError(
      `Missing required column${missingHeaders.length === 1 ? "" : "s"}: ${missingHeaders.join(", ")}.`,
    );
  }

  const dataRows = rows
    .slice(headerIndex + 1)
    .filter((row) => !isBlankRow(row));
  if (dataRows.length === 0) {
    throw new CsvValidationError("Add at least one data row.");
  }

  const records = dataRows.map((row) => {
    if (row.values.length !== headers.length) {
      throw new CsvValidationError(
        `Row ${row.rowNumber}: expected ${headers.length} columns but found ${row.values.length}.`,
      );
    }

    const fields = Object.fromEntries(
      headers.map((header, headerIndex) => [
        header,
        row.values[headerIndex] ?? "",
      ]),
    );
    const reference = fields.reference;
    if (!reference.trim()) {
      throw new CsvValidationError(
        `Row ${row.rowNumber}: reference is required.`,
      );
    }
    if (reference.length > 80) {
      throw new CsvValidationError(
        `Row ${row.rowNumber}: reference must be 80 characters or fewer.`,
      );
    }

    const type = parseType(fields.type, row.rowNumber);
    return {
      id: `${source}-${row.rowNumber}`,
      source,
      sourceName,
      rowNumber: row.rowNumber,
      reference,
      normalizedReference: normalizeReference(reference),
      date: parseDate(fields.date, row.rowNumber),
      type,
      amountCents: parseAmount(fields.amount, row.rowNumber),
      paymentStatus: parseStatus(fields.payment_status ?? "", row.rowNumber),
    };
  });

  const invoiceCreditCount = records.filter(
    (record) => record.type === "invoice" || record.type === "credit",
  ).length;
  if (invoiceCreditCount > MAX_INVOICE_CREDIT_ROWS) {
    throw new CsvValidationError(
      `This pilot accepts up to ${MAX_INVOICE_CREDIT_ROWS} invoice or credit rows per file; payment rows do not count toward that limit.`,
    );
  }

  return records;
}

function groupBy(
  records: ParsedRecord[],
  keyFor: (record: ParsedRecord) => string,
): Map<string, ParsedRecord[]> {
  const groups = new Map<string, ParsedRecord[]>();
  records.forEach((record) => {
    const key = keyFor(record);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  });
  return groups;
}

function fullKey(record: ParsedRecord): string {
  return [
    record.normalizedReference,
    record.date,
    record.type,
    record.amountCents,
  ].join("|");
}

function referenceDateKey(record: ParsedRecord): string {
  return [record.normalizedReference, record.date, record.type].join("|");
}

function referenceAmountKey(record: ParsedRecord): string {
  return [record.normalizedReference, record.type, record.amountCents].join("|");
}

function referenceTypeKey(record: ParsedRecord): string {
  return [record.normalizedReference, record.type].join("|");
}

function toTrace(record: ParsedRecord): SourceTrace {
  return {
    id: record.id,
    source: record.source,
    sourceName: record.sourceName,
    rowNumber: record.rowNumber,
    reference: record.reference,
    date: record.date,
    type: record.type,
    amountCents: record.amountCents,
    paymentStatus: record.paymentStatus,
  };
}

function groupedAmount(records: ParsedRecord[]): number | undefined {
  if (records.length === 0) return undefined;
  const total = records.reduce((sum, record) => sum + record.amountCents, 0);
  if (!Number.isSafeInteger(total)) {
    throw new ReconciliationValidationError(
      "A grouped amount is outside the supported range.",
    );
  }
  return total;
}

type FindingInput = Omit<ReconciliationFinding, "id">;

function finding(
  status: FindingStatus,
  statementRecords: ParsedRecord[],
  ledgerRecords: ParsedRecord[],
  rule: string,
  detail: string,
): FindingInput {
  const representative = statementRecords[0] ?? ledgerRecords[0];
  return {
    status,
    reference: representative.reference,
    type: representative.type,
    statementAmountCents: groupedAmount(statementRecords),
    ledgerAmountCents: groupedAmount(ledgerRecords),
    statementTraces: statementRecords.map(toTrace),
    ledgerTraces: ledgerRecords.map(toTrace),
    rule,
    detail,
  };
}

function available(
  records: ParsedRecord[],
  consumed: Set<string>,
): ParsedRecord[] {
  return records.filter((record) => !consumed.has(record.id));
}

function consume(records: ParsedRecord[], consumed: Set<string>): void {
  records.forEach((record) => consumed.add(record.id));
}

function earliestRow(item: FindingInput): number {
  return Math.min(
    ...[...item.statementTraces, ...item.ledgerTraces].map(
      (trace) => trace.rowNumber,
    ),
  );
}

function cleanProvenanceField(
  value: string,
  label: "vendor" | "location",
): string {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) {
    throw new ReconciliationValidationError(
      `Enter the ${label} before reconciling.`,
    );
  }
  if (cleaned.length > 120) {
    throw new ReconciliationValidationError(
      `${label === "vendor" ? "Vendor" : "Location"} must be 120 characters or fewer.`,
    );
  }
  return cleaned;
}

function validateProvenance(
  provenance: ReconciliationProvenance,
  records: ParsedRecord[],
): ReconciliationProvenance {
  const cleaned = {
    vendor: cleanProvenanceField(provenance.vendor, "vendor"),
    location: cleanProvenanceField(provenance.location, "location"),
    periodStart: provenance.periodStart,
    periodEnd: provenance.periodEnd,
  };

  if (
    !isStrictIsoDate(cleaned.periodStart) ||
    !isStrictIsoDate(cleaned.periodEnd)
  ) {
    throw new ReconciliationValidationError(
      "Enter a valid statement period start and end date.",
    );
  }
  if (cleaned.periodStart > cleaned.periodEnd) {
    throw new ReconciliationValidationError(
      "Statement period end must be on or after its start.",
    );
  }

  const outsidePeriod = records.find(
    (record) =>
      record.date < cleaned.periodStart || record.date > cleaned.periodEnd,
  );
  if (outsidePeriod) {
    throw new ReconciliationValidationError(
      `${outsidePeriod.sourceName} row ${outsidePeriod.rowNumber} falls outside the stated period.`,
    );
  }

  return cleaned;
}

function canonicalDataset(records: ParsedRecord[]): string {
  return records
    .map((record) =>
      JSON.stringify([
        record.normalizedReference,
        record.date,
        record.type,
        record.amountCents,
        record.paymentStatus,
      ]),
    )
    .sort()
    .join("\n");
}

function assertDistinctDatasets(
  statementRecords: ParsedRecord[],
  ledgerRecords: ParsedRecord[],
): void {
  if (
    statementRecords.length === ledgerRecords.length &&
    canonicalDataset(statementRecords) === canonicalDataset(ledgerRecords)
  ) {
    throw new ReconciliationValidationError(
      "The statement and ledger contain the same normalized rows. Select two independent source exports.",
    );
  }
}

export function reconcileRecords(
  statementRecords: ParsedRecord[],
  ledgerRecords: ParsedRecord[],
  provenance: ReconciliationProvenance,
  generatedAt = new Date().toISOString(),
): ReconciliationReport {
  if (statementRecords.length === 0 || ledgerRecords.length === 0) {
    throw new ReconciliationValidationError(
      "Both the statement and ledger need at least one row.",
    );
  }

  assertDistinctDatasets(statementRecords, ledgerRecords);
  const cleanProvenance = validateProvenance(provenance, [
    ...statementRecords,
    ...ledgerRecords,
  ]);
  const consumed = new Set<string>();
  const draftFindings: FindingInput[] = [];

  // Repeated normalized reference/type groups must stay open before any exact
  // matching. Otherwise one duplicate can be hidden behind an apparently exact
  // counterpart.
  const statementReferenceGroups = groupBy(statementRecords, referenceTypeKey);
  const ledgerReferenceGroups = groupBy(ledgerRecords, referenceTypeKey);
  const repeatedReferenceKeys = new Set(
    [
      ...statementReferenceGroups.keys(),
      ...ledgerReferenceGroups.keys(),
    ].filter(
      (key) =>
        (statementReferenceGroups.get(key)?.length ?? 0) > 1 ||
        (ledgerReferenceGroups.get(key)?.length ?? 0) > 1,
    ),
  );

  repeatedReferenceKeys.forEach((key) => {
    const statementGroup = statementReferenceGroups.get(key) ?? [];
    const ledgerGroup = ledgerReferenceGroups.get(key) ?? [];
    consume(statementGroup, consumed);
    consume(ledgerGroup, consumed);
    draftFindings.push(
      finding(
        "possible_duplicate",
        statementGroup,
        ledgerGroup,
        "Repeated-reference guard: every row sharing a normalized reference and type remains open before exact matching.",
        "At least one source repeats this reference and transaction type. Review all grouped rows; none were auto-matched.",
      ),
    );
  });

  const remainingStatementByFullKey = groupBy(
    available(statementRecords, consumed),
    fullKey,
  );
  const remainingLedgerByFullKey = groupBy(
    available(ledgerRecords, consumed),
    fullKey,
  );

  remainingStatementByFullKey.forEach((statementGroup, key) => {
    const ledgerGroup = remainingLedgerByFullKey.get(key) ?? [];
    if (statementGroup.length !== 1 || ledgerGroup.length !== 1) return;

    const statementRecord = statementGroup[0];
    const ledgerRecord = ledgerGroup[0];
    consume(statementGroup, consumed);
    consume(ledgerGroup, consumed);

    const statementHasStatus = statementRecord.paymentStatus.length > 0;
    const ledgerHasStatus = ledgerRecord.paymentStatus.length > 0;
    const bothHaveStatus = statementHasStatus && ledgerHasStatus;
    const statusesConflict =
      bothHaveStatus &&
      statementRecord.paymentStatus !== ledgerRecord.paymentStatus;
    const status: FindingStatus = !bothHaveStatus
      ? "review_required"
      : statusesConflict
        ? "payment_mismatch"
        : "matched";

    draftFindings.push(
      finding(
        status,
        statementGroup,
        ledgerGroup,
        !bothHaveStatus
          ? "Evidence guard: transaction fields agree, but both sources must provide payment_status evidence."
          : statusesConflict
            ? "Status check: transaction fields agree, but payment statuses differ."
            : "Field match: reference, date, type, amount, and status evidence agree in both sources.",
        !bothHaveStatus
          ? "Absent or one-sided status evidence cannot be treated as a completed match."
          : statusesConflict
            ? `Statement status “${statementRecord.paymentStatus}” differs from ledger status “${ledgerRecord.paymentStatus}”.`
            : "The supplied fields agree. This is a field-level match, not proof of payment, closure, or money owed.",
      ),
    );
  });

  const statementByReferenceDate = groupBy(
    available(statementRecords, consumed),
    referenceDateKey,
  );
  const ledgerByReferenceDate = groupBy(
    available(ledgerRecords, consumed),
    referenceDateKey,
  );

  statementByReferenceDate.forEach((statementGroup, key) => {
    const ledgerGroup = ledgerByReferenceDate.get(key) ?? [];
    if (
      statementGroup.length !== 1 ||
      ledgerGroup.length !== 1 ||
      statementGroup[0].amountCents === ledgerGroup[0].amountCents
    ) {
      return;
    }

    consume(statementGroup, consumed);
    consume(ledgerGroup, consumed);
    draftFindings.push(
      finding(
        "amount_mismatch",
        statementGroup,
        ledgerGroup,
        "Amount check: reference, date, and type agree; amount does not.",
        "The records share an exact reference, date, and type but show different amounts.",
      ),
    );
  });

  const statementByReferenceAmount = groupBy(
    available(statementRecords, consumed),
    referenceAmountKey,
  );
  const ledgerByReferenceAmount = groupBy(
    available(ledgerRecords, consumed),
    referenceAmountKey,
  );

  statementByReferenceAmount.forEach((statementGroup, key) => {
    const ledgerGroup = ledgerByReferenceAmount.get(key) ?? [];
    if (
      statementGroup.length !== 1 ||
      ledgerGroup.length !== 1 ||
      statementGroup[0].date === ledgerGroup[0].date
    ) {
      return;
    }

    consume(statementGroup, consumed);
    consume(ledgerGroup, consumed);
    draftFindings.push(
      finding(
        "review_required",
        statementGroup,
        ledgerGroup,
        "Review guard: reference, type, and amount agree, but dates differ.",
        "No date tolerance is assumed. A reviewer must decide whether these rows represent the same transaction.",
      ),
    );
  });

  const remainingStatementByReference = groupBy(
    available(statementRecords, consumed),
    referenceTypeKey,
  );
  const remainingLedgerByReference = groupBy(
    available(ledgerRecords, consumed),
    referenceTypeKey,
  );

  remainingStatementByReference.forEach((statementGroup, key) => {
    const ledgerGroup = remainingLedgerByReference.get(key) ?? [];
    if (ledgerGroup.length === 0) return;

    consume(statementGroup, consumed);
    consume(ledgerGroup, consumed);
    draftFindings.push(
      finding(
        "review_required",
        statementGroup,
        ledgerGroup,
        "Review guard: the reference and type overlap, but no exact one-to-one rule resolves the rows.",
        "One or more candidate rows share a reference. No ambiguous candidate was auto-confirmed.",
      ),
    );
  });

  available(statementRecords, consumed).forEach((record) => {
    consume([record], consumed);
    draftFindings.push(
      finding(
        "statement_only",
        [record],
        [],
        "Exception: no ledger row shares this normalized reference and type.",
        "The statement item is not represented in the supplied internal export.",
      ),
    );
  });

  available(ledgerRecords, consumed).forEach((record) => {
    consume([record], consumed);
    draftFindings.push(
      finding(
        "ledger_only",
        [],
        [record],
        "Exception: no statement row shares this normalized reference and type.",
        "The internal invoice, credit, or payment is not represented in the supplied statement.",
      ),
    );
  });

  const findings = draftFindings
    .sort((left, right) => {
      const leftMatched = left.status === "matched" ? 1 : 0;
      const rightMatched = right.status === "matched" ? 1 : 0;
      return (
        leftMatched - rightMatched || earliestRow(left) - earliestRow(right)
      );
    })
    .map((item, index) => ({
      ...item,
      id: `TP-${String(index + 1).padStart(3, "0")}`,
    }));

  const statusCounts = findings.reduce<Record<FindingStatus, number>>(
    (counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }),
    {
      matched: 0,
      statement_only: 0,
      ledger_only: 0,
      possible_duplicate: 0,
      amount_mismatch: 0,
      payment_mismatch: 0,
      review_required: 0,
    },
  );

  return {
    generatedAt,
    statementName: statementRecords[0]?.sourceName ?? "statement.csv",
    ledgerName: ledgerRecords[0]?.sourceName ?? "ap-ledger.csv",
    provenance: cleanProvenance,
    findings,
    summary: {
      ...statusCounts,
      rowsProcessed: statementRecords.length + ledgerRecords.length,
      exceptionCount: findings.length - statusCounts.matched,
    },
  };
}

function neutralizeCsvFormula(value: string): string {
  const candidate = value.replace(
    /^[ \f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*/,
    "",
  );
  return /^[=+\-@\t\r\n]/.test(candidate) ? `'${value}` : value;
}

function escapeCsvText(value: string): string {
  const formulaSafe = neutralizeCsvFormula(value);
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

function formatCentsForCsv(value: number | undefined): string {
  return value === undefined ? "" : (value / 100).toFixed(2);
}

function traceRows(traces: SourceTrace[]): string {
  return traces.map((trace) => trace.rowNumber).join("|");
}

export function buildReconciliationCsv(
  report: ReconciliationReport,
  exceptionsOnly = true,
): string {
  const headers = [
    "vendor",
    "location",
    "period_start",
    "period_end",
    "generated_at",
    "finding_id",
    "status",
    "reference",
    "type",
    "statement_amount",
    "ledger_amount",
    "statement_source",
    "statement_rows",
    "ledger_source",
    "ledger_rows",
    "rule",
    "detail",
  ];
  const findings = exceptionsOnly
    ? report.findings.filter((item) => item.status !== "matched")
    : report.findings;

  const rows = findings.map((item) =>
    [
      report.provenance.vendor,
      report.provenance.location,
      report.provenance.periodStart,
      report.provenance.periodEnd,
      report.generatedAt,
      item.id,
      item.status,
      item.reference,
      item.type,
      formatCentsForCsv(item.statementAmountCents),
      formatCentsForCsv(item.ledgerAmountCents),
      item.statementTraces[0]?.sourceName ?? "",
      traceRows(item.statementTraces),
      item.ledgerTraces[0]?.sourceName ?? "",
      traceRows(item.ledgerTraces),
      item.rule,
      item.detail,
    ]
      .map((value) => escapeCsvText(String(value)))
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}
