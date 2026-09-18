import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildReconciliationCsv,
  CsvValidationError,
  parseReconciliationCsv,
  reconcileRecords,
} from "../lib/vendor-reconciliation";

const statementCsv = readFileSync(
  path.resolve("public/samples/restaurant-vendor-statement.csv"),
  "utf8",
);
const ledgerCsv = readFileSync(
  path.resolve("public/samples/restaurant-ap-ledger.csv"),
  "utf8",
);

describe("parseReconciliationCsv", () => {
  it("parses the supplied redacted statement sample", () => {
    const records = parseReconciliationCsv(
      statementCsv,
      "statement",
      "statement.csv",
    );

    expect(records).toHaveLength(10);
    expect(records[0]).toMatchObject({
      rowNumber: 2,
      reference: "INV-1041",
      normalizedReference: "INV-1041",
      date: "2026-08-02",
      type: "invoice",
      amountCents: 84216,
      paymentStatus: "open",
    });
    expect(records[2].amountCents).toBe(-8625);
  });

  it("supports quoted currency and accounting negatives", () => {
    const records = parseReconciliationCsv(
      [
        "reference,date,type,amount,payment_status",
        '" INV 12 ",2026-08-01,invoice,"$1,234.50",Paid',
        "CM-9,2026-08-02,credit,(42.15),applied",
      ].join("\n"),
      "ledger",
      "ledger.csv",
    );

    expect(records[0]).toMatchObject({
      normalizedReference: "INV 12",
      amountCents: 123450,
      paymentStatus: "paid",
    });
    expect(records[1].amountCents).toBe(-4215);
  });

  it("blocks unsupported columns so sensitive fields can be removed first", () => {
    expect(() =>
      parseReconciliationCsv(
        [
          "reference,date,type,amount,bank_account",
          "INV-1,2026-08-01,invoice,10.00,123456789",
        ].join("\n"),
        "statement",
        "unsafe.csv",
      ),
    ).toThrowError(CsvValidationError);

    expect(() =>
      parseReconciliationCsv(
        [
          "reference,date,type,amount,bank_account",
          "INV-1,2026-08-01,invoice,10.00,123456789",
        ].join("\n"),
        "statement",
        "unsafe.csv",
      ),
    ).toThrow(/unsupported column.*bank_account/i);
  });
});

describe("reconcileRecords", () => {
  const statement = parseReconciliationCsv(
    statementCsv,
    "statement",
    "restaurant-vendor-statement.csv",
  );
  const ledger = parseReconciliationCsv(
    ledgerCsv,
    "ledger",
    "restaurant-ap-ledger.csv",
  );
  const report = reconcileRecords(
    statement,
    ledger,
    "2026-09-18T08:00:00.000Z",
  );

  it("keeps every non-exact condition in an explicit review state", () => {
    expect(report.summary).toMatchObject({
      rowsProcessed: 19,
      matched: 4,
      exceptionCount: 6,
      statement_only: 1,
      ledger_only: 1,
      possible_duplicate: 1,
      amount_mismatch: 1,
      payment_mismatch: 1,
      review_required: 1,
    });

    expect(
      report.findings.find((finding) => finding.reference === "INV-1045"),
    ).toMatchObject({
      status: "review_required",
      statementAmountCents: 73422,
      ledgerAmountCents: 73422,
    });
  });

  it("links duplicate and missing findings to their original source rows", () => {
    const duplicate = report.findings.find(
      (finding) => finding.reference === "INV-1046",
    );
    expect(duplicate?.status).toBe("possible_duplicate");
    expect(duplicate?.statementTraces.map((trace) => trace.rowNumber)).toEqual([
      8, 9,
    ]);
    expect(duplicate?.ledgerTraces.map((trace) => trace.rowNumber)).toEqual([8]);

    const missingCredit = report.findings.find(
      (finding) => finding.reference === "CM-221",
    );
    expect(missingCredit).toMatchObject({ status: "statement_only" });
    expect(missingCredit?.statementTraces[0]).toMatchObject({
      sourceName: "restaurant-vendor-statement.csv",
      rowNumber: 10,
    });
  });

  it("exports a traceable exception report without matched rows", () => {
    const csv = buildReconciliationCsv(report);

    expect(csv.split("\n")).toHaveLength(7);
    expect(csv).toContain('"possible_duplicate"');
    expect(csv).toContain('"restaurant-vendor-statement.csv"');
    expect(csv).toContain('"8|9"');
    expect(csv).not.toContain('"matched"');
  });

  it("can export the complete audit ledger", () => {
    const csv = buildReconciliationCsv(report, false);

    expect(csv.split("\n")).toHaveLength(11);
    expect(csv).toContain('"matched"');
    expect(csv).toContain('"payment_mismatch"');
  });
});
