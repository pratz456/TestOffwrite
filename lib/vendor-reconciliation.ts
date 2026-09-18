export const REQUIRED_CSV_COLUMNS = ["reference", "date", "type", "amount"] as const;
export const OPTIONAL_CSV_COLUMNS = ["payment_status"] as const;
export const MAX_ROWS_PER_FILE = 150;

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
  findings: ReconciliationFinding[];
  summary: ReconciliationSummary;
};

export class CsvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvValidationError";
  }
}

const ALLOWED_COLUMNS = new Set<string>([
  ...REQUIRED_CSV_COLUMNS,
  ...OPTIONAL_CSV_COLUMNS,
]);
const ALLOWED_TYPES = new Set<TransactionType>(["invoice", "credit", "payment"]);

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
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];

    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new CsvValidationError("The CSV contains an unclosed quoted value.");
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter((candidate) =>
    candidate.some((value) => value.trim().length > 0),
  );
}

function parseDate(value: string, rowNumber: number): string {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    throw new CsvValidationError(
      `Row ${rowNumber}: date must use YYYY-MM-DD format.`,
    );
  }

  const date = new Date(`${trimmed}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== trimmed
  ) {
    throw new CsvValidationError(`Row ${rowNumber}: date is not valid.`);
  }

  return trimmed;
}

function parseAmount(value: string, rowNumber: number): number {
  const trimmed = value.trim();
  const parenthesized = /^\(.*\)$/.test(trimmed);
  const normalized = trimmed
    .replace(/[()]/g, "")
    .replace(/[$,\s]/g, "");

  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new CsvValidationError(
      `Row ${rowNumber}: amount must be a number with at most two decimal places.`,
    );
  }

  const numeric = Number(normalized) * (parenthesized ? -1 : 1);
  const cents = Math.round(numeric * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new CsvValidationError(`Row ${rowNumber}: amount is outside the supported range.`);
  }

  return cents;
}

export function parseReconciliationCsv(
  csv: string,
  source: ReconciliationSource,
  sourceName: string,
): ParsedRecord[] {
  const rows = parseCsvRows(csv);
  if (rows.length < 2) {
    throw new CsvValidationError("Add a header row and at least one data row.");
  }

  const headers = rows[0].map(normalizeHeader);
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

  const unexpectedHeaders = headers.filter((header) => !ALLOWED_COLUMNS.has(header));
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

  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_ROWS_PER_FILE) {
    throw new CsvValidationError(
      `This pilot workspace accepts up to ${MAX_ROWS_PER_FILE} rows per file.`,
    );
  }

  return dataRows.map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      throw new CsvValidationError(
        `Row ${rowNumber}: expected ${headers.length} columns but found ${values.length}.`,
      );
    }

    const fields = Object.fromEntries(
      headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]),
    );
    const reference = fields.reference.trim();
    if (!reference) {
      throw new CsvValidationError(`Row ${rowNumber}: reference is required.`);
    }
    if (reference.length > 80) {
      throw new CsvValidationError(
        `Row ${rowNumber}: reference must be 80 characters or fewer.`,
      );
    }

    const type = fields.type.trim().toLowerCase() as TransactionType;
    if (!ALLOWED_TYPES.has(type)) {
      throw new CsvValidationError(
        `Row ${rowNumber}: type must be invoice, credit, or payment.`,
      );
    }

    return {
      id: `${source}-${rowNumber}`,
      source,
      sourceName,
      rowNumber,
      reference,
      normalizedReference: normalizeReference(reference),
      date: parseDate(fields.date, rowNumber),
      type,
      amountCents: parseAmount(fields.amount, rowNumber),
      paymentStatus: normalizeStatus(fields.payment_status ?? ""),
    };
  });
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

function firstAmount(records: ParsedRecord[]): number | undefined {
  return records[0]?.amountCents;
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
    statementAmountCents: firstAmount(statementRecords),
    ledgerAmountCents: firstAmount(ledgerRecords),
    statementTraces: statementRecords.map(toTrace),
    ledgerTraces: ledgerRecords.map(toTrace),
    rule,
    detail,
  };
}

function available(records: ParsedRecord[], consumed: Set<string>): ParsedRecord[] {
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

export function reconcileRecords(
  statementRecords: ParsedRecord[],
  ledgerRecords: ParsedRecord[],
  generatedAt = new Date().toISOString(),
): ReconciliationReport {
  const consumed = new Set<string>();
  const draftFindings: FindingInput[] = [];

  const statementFullGroups = groupBy(statementRecords, fullKey);
  const ledgerFullGroups = groupBy(ledgerRecords, fullKey);
  const duplicateKeys = new Set(
    [...statementFullGroups.keys(), ...ledgerFullGroups.keys()].filter(
      (key) =>
        (statementFullGroups.get(key)?.length ?? 0) > 1 ||
        (ledgerFullGroups.get(key)?.length ?? 0) > 1,
    ),
  );

  duplicateKeys.forEach((key) => {
    const statementGroup = statementFullGroups.get(key) ?? [];
    const ledgerGroup = ledgerFullGroups.get(key) ?? [];
    consume(statementGroup, consumed);
    consume(ledgerGroup, consumed);
    draftFindings.push(
      finding(
        "possible_duplicate",
        statementGroup,
        ledgerGroup,
        "Duplicate guard: repeated exact keys are never auto-confirmed.",
        "The same reference, date, type, and amount appears more than once in at least one source. Review every listed row.",
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

    const statusesConflict =
      statementRecord.paymentStatus.length > 0 &&
      ledgerRecord.paymentStatus.length > 0 &&
      statementRecord.paymentStatus !== ledgerRecord.paymentStatus;

    draftFindings.push(
      finding(
        statusesConflict ? "payment_mismatch" : "matched",
        statementGroup,
        ledgerGroup,
        statusesConflict
          ? "Status check: exact transaction keys match, but payment statuses differ."
          : "Exact match: normalized reference, date, type, and amount agree.",
        statusesConflict
          ? `Statement status “${statementRecord.paymentStatus}” differs from ledger status “${ledgerRecord.paymentStatus}”.`
          : "The deterministic fields agree across both source rows.",
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

  const statementByReference = groupBy(
    available(statementRecords, consumed),
    referenceTypeKey,
  );
  const ledgerByReference = groupBy(
    available(ledgerRecords, consumed),
    referenceTypeKey,
  );

  statementByReference.forEach((statementGroup, key) => {
    const ledgerGroup = ledgerByReference.get(key) ?? [];
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
      return leftMatched - rightMatched || earliestRow(left) - earliestRow(right);
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
    findings,
    summary: {
      ...statusCounts,
      rowsProcessed: statementRecords.length + ledgerRecords.length,
      exceptionCount: findings.length - statusCounts.matched,
    },
  };
}

function escapeCsvText(value: string): string {
  const formulaSafe = /^[=+@]/.test(value) ? `'${value}` : value;
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
      .map(escapeCsvText)
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}
