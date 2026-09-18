import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildReconciliationCsv,
  CsvValidationError,
  parseReconciliationCsv,
  reconcileRecords,
  type ReconciliationProvenance,
  type ReconciliationReport,
  ReconciliationValidationError,
} from "../lib/vendor-reconciliation";

const statementCsv = readFileSync(
  path.resolve("public/samples/restaurant-vendor-statement.csv"),
  "utf8",
);
const ledgerCsv = readFileSync(
  path.resolve("public/samples/restaurant-ap-ledger.csv"),
  "utf8",
);
const provenance: ReconciliationProvenance = {
  vendor: "Northstar Foods",
  location: "Demo Bistro · River North",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
};

function csv(...rows: string[]): string {
  return [
    "reference,date,type,amount,payment_status",
    ...rows,
  ].join("\n");
}

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

  it("accepts valid quoted commas and strict leading-minus currency", () => {
    const records = parseReconciliationCsv(
      csv(
        '"INV-12",2026-08-01,invoice,"$1,234.50",paid',
        'CM-9,2026-08-02,credit,"-$42.15",applied',
      ),
      "ledger",
      "ledger.csv",
    );

    expect(records[0].amountCents).toBe(123450);
    expect(records[1].amountCents).toBe(-4215);
  });

  it.each([
    "(42.15)",
    "1 000.00",
    "++1.00",
    "--1.00",
    "$-1.00",
    "1,00.00",
    " 1.00",
    "1.00 ",
    "+1.00",
  ])("rejects malformed amount formatting: %s", (amount) => {
    expect(() =>
      parseReconciliationCsv(
        csv(`INV-1,2026-08-01,invoice,"${amount}",paid`),
        "statement",
        "malformed.csv",
      ),
    ).toThrow(/amount must use a plain leading minus/i);
  });

  it.each([
    '"INV-1,2026-08-01,invoice,10.00,paid',
    'INV"1,2026-08-01,invoice,10.00,paid',
    '"INV-1"x,2026-08-01,invoice,10.00,paid',
  ])("rejects broken quote structure", (row) => {
    expect(() =>
      parseReconciliationCsv(
        csv(row),
        "statement",
        "broken-quotes.csv",
      ),
    ).toThrowError(CsvValidationError);
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
    ).toThrow(/unsupported column.*bank_account/i);
  });

  it("preserves physical source row numbers across blank lines", () => {
    const records = parseReconciliationCsv(
      [
        "reference,date,type,amount,payment_status",
        "",
        "INV-1,2026-08-01,invoice,10.00,paid",
        "",
        "INV-2,2026-08-02,invoice,20.00,paid",
      ].join("\n"),
      "statement",
      "statement.csv",
    );

    expect(records.map((record) => record.rowNumber)).toEqual([3, 5]);
  });

  it("counts only invoice and credit rows toward the 150-row pilot cap", () => {
    const payments = Array.from(
      { length: 151 },
      (_, index) =>
        `PAY-${index},2026-08-01,payment,1.00,paid`,
    );
    const records = parseReconciliationCsv(
      csv(...payments, "INV-1,2026-08-01,invoice,1.00,paid"),
      "ledger",
      "payments.csv",
    );
    expect(records).toHaveLength(152);

    const invoices = Array.from(
      { length: 151 },
      (_, index) =>
        `INV-${index},2026-08-01,invoice,1.00,paid`,
    );
    expect(() =>
      parseReconciliationCsv(
        csv(...invoices),
        "ledger",
        "too-many-invoices.csv",
      ),
    ).toThrow(/150 invoice or credit rows/i);
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
    provenance,
    "2026-09-18T08:00:00.000Z",
  );

  it("keeps every non-exact condition in an explicit review state", () => {
    expect(report.provenance).toEqual(provenance);
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

  it("opens repeated reference/type groups before exact matching", () => {
    const repeatedStatement = parseReconciliationCsv(
      csv(
        "INV-1,2026-08-01,invoice,10.00,paid",
        " inv-1 ,2026-08-02,invoice,20.00,paid",
      ),
      "statement",
      "statement.csv",
    );
    const exactLedgerRow = parseReconciliationCsv(
      csv("INV-1,2026-08-01,invoice,10.00,paid"),
      "ledger",
      "ledger.csv",
    );
    const repeatedReport = reconcileRecords(
      repeatedStatement,
      exactLedgerRow,
      provenance,
    );

    expect(repeatedReport.summary.matched).toBe(0);
    expect(repeatedReport.summary.possible_duplicate).toBe(1);
    expect(repeatedReport.findings[0]).toMatchObject({
      status: "possible_duplicate",
      statementAmountCents: 3000,
      ledgerAmountCents: 1000,
    });
    expect(
      repeatedReport.findings[0].statementTraces.map(
        (trace) => trace.rowNumber,
      ),
    ).toEqual([2, 3]);
  });

  it("requires two-sided agreeing status evidence for a field match", () => {
    const statusStatement = parseReconciliationCsv(
      csv(
        "INV-1,2026-08-01,invoice,10.00,",
        "INV-2,2026-08-02,invoice,20.00,paid",
        "INV-3,2026-08-03,invoice,30.00,paid",
      ),
      "statement",
      "statement.csv",
    );
    const statusLedger = parseReconciliationCsv(
      csv(
        "INV-1,2026-08-01,invoice,10.00,",
        "INV-2,2026-08-02,invoice,20.00,",
        "INV-3,2026-08-03,invoice,30.00,paid",
      ),
      "ledger",
      "ledger.csv",
    );
    const statusReport = reconcileRecords(
      statusStatement,
      statusLedger,
      provenance,
    );

    expect(
      statusReport.findings.find((finding) => finding.reference === "INV-1")
        ?.status,
    ).toBe("review_required");
    expect(
      statusReport.findings.find((finding) => finding.reference === "INV-2")
        ?.status,
    ).toBe("review_required");
    expect(
      statusReport.findings.find((finding) => finding.reference === "INV-3")
        ?.status,
    ).toBe("matched");
  });

  it("rejects self-reconciliation even when identical rows are reordered", () => {
    const first = parseReconciliationCsv(
      csv(
        "INV-1,2026-08-01,invoice,10.00,paid",
        "INV-2,2026-08-02,invoice,20.00,open",
      ),
      "statement",
      "statement.csv",
    );
    const reordered = parseReconciliationCsv(
      csv(
        "INV-2,2026-08-02,invoice,20.00,open",
        "INV-1,2026-08-01,invoice,10.00,paid",
      ),
      "ledger",
      "renamed-copy.csv",
    );

    expect(() =>
      reconcileRecords(first, reordered, provenance),
    ).toThrowError(ReconciliationValidationError);
    expect(() =>
      reconcileRecords(first, reordered, provenance),
    ).toThrow(/same normalized rows/i);
  });

  it("requires valid vendor, location, and period provenance", () => {
    expect(() =>
      reconcileRecords(statement, ledger, { ...provenance, vendor: " " }),
    ).toThrow(/enter the vendor/i);
    expect(() =>
      reconcileRecords(statement, ledger, { ...provenance, location: "" }),
    ).toThrow(/enter the location/i);
    expect(() =>
      reconcileRecords(statement, ledger, {
        ...provenance,
        periodStart: "2026-09-01",
        periodEnd: "2026-08-01",
      }),
    ).toThrow(/end must be on or after/i);
    expect(() =>
      reconcileRecords(statement, ledger, {
        ...provenance,
        periodStart: "2026-08-03",
      }),
    ).toThrow(/falls outside the stated period/i);
  });

  it("preserves source rows and sums grouped amounts in findings and exports", () => {
    const duplicate = report.findings.find(
      (finding) => finding.reference === "INV-1046",
    );
    expect(duplicate).toMatchObject({
      status: "possible_duplicate",
      statementAmountCents: 101800,
      ledgerAmountCents: 50900,
    });
    expect(duplicate?.statementTraces.map((trace) => trace.rowNumber)).toEqual([
      8, 9,
    ]);
    expect(duplicate?.ledgerTraces.map((trace) => trace.rowNumber)).toEqual([8]);

    const exported = buildReconciliationCsv(report);
    expect(exported).toContain('"1018.00","509.00"');
    expect(exported).toContain('"8|9"');
  });

  it("exports provenance and a traceable exception report without matched rows", () => {
    const exported = buildReconciliationCsv(report);

    expect(exported.split("\n")).toHaveLength(7);
    expect(exported).toContain('"Northstar Foods"');
    expect(exported).toContain('"possible_duplicate"');
    expect(exported).toContain('"restaurant-vendor-statement.csv"');
    expect(exported).not.toContain('"matched"');
  });

  it("neutralizes every spreadsheet formula trigger after leading whitespace", () => {
    const triggers = [
      "=1+1",
      "+SUM(A1)",
      "-CMD",
      "@lookup",
      "  \t=CMD",
      "  \r=CMD",
      "   =CMD",
    ];
    const hostileReport: ReconciliationReport = {
      generatedAt: "2026-09-18T08:00:00.000Z",
      statementName: " @statement.csv",
      ledgerName: "ledger.csv",
      provenance: {
        ...provenance,
        vendor: "  =Vendor",
      },
      summary: {
        matched: 0,
        statement_only: triggers.length,
        ledger_only: 0,
        possible_duplicate: 0,
        amount_mismatch: 0,
        payment_mismatch: 0,
        review_required: 0,
        rowsProcessed: triggers.length,
        exceptionCount: triggers.length,
      },
      findings: triggers.map((reference, index) => ({
        id: `TP-${index + 1}`,
        status: "statement_only",
        reference,
        type: "invoice",
        statementAmountCents: index === 2 ? -100 : 100,
        statementTraces: [
          {
            id: `statement-${index + 2}`,
            source: "statement",
            sourceName: " @statement.csv",
            rowNumber: index + 2,
            reference,
            date: "2026-08-01",
            type: "invoice",
            amountCents: index === 2 ? -100 : 100,
            paymentStatus: "paid",
          },
        ],
        ledgerTraces: [],
        rule: "rule",
        detail: "detail",
      })),
    };
    const exported = buildReconciliationCsv(hostileReport);

    expect(exported).toContain(`"'  =Vendor"`);
    expect(exported).toContain(`"'=1+1"`);
    expect(exported).toContain(`"'+SUM(A1)"`);
    expect(exported).toContain(`"'-CMD"`);
    expect(exported).toContain(`"'@lookup"`);
    expect(exported).toContain(`"'  \t=CMD"`);
    expect(exported).toContain(`"'  \r=CMD"`);
    expect(exported).toContain(`"'   =CMD"`);
    expect(exported).toContain(`"'-1.00"`);
    expect(exported).toContain(`"' @statement.csv"`);
  });

  it("can export the complete audit ledger", () => {
    const exported = buildReconciliationCsv(report, false);

    expect(exported.split("\n")).toHaveLength(11);
    expect(exported).toContain('"matched"');
    expect(exported).toContain('"payment_mismatch"');
  });
});

describe("pilot route isolation and CI coverage", () => {
  it("keeps WriteOff on the root and marks the TableProof pilot noindex", () => {
    const rootPage = readFileSync(path.resolve("app/page.tsx"), "utf8");
    const pilotPage = readFileSync(path.resolve("app/pilot/page.tsx"), "utf8");
    const robots = readFileSync(path.resolve("app/robots.ts"), "utf8");

    expect(rootPage).toContain("LandingPage");
    expect(rootPage).not.toContain("ReconciliationSite");
    expect(pilotPage).toContain("ReconciliationSite");
    expect(pilotPage).toMatch(/index:\s*false/);
    expect(pilotPage).toMatch(/follow:\s*false/);
    expect(robots).toContain('"/pilot"');
  });

  it("allows the existing Google tag through CSP and runs CI for march-branch", () => {
    const middleware = readFileSync(path.resolve("middleware.ts"), "utf8");
    const workflow = readFileSync(
      path.resolve(".github/workflows/ci.yml"),
      "utf8",
    );

    expect(middleware).toContain("https://www.googletagmanager.com");
    expect(middleware).toContain("https://www.google-analytics.com");
    expect(workflow).toMatch(/pull_request:[\s\S]*march-branch/);
  });
});
