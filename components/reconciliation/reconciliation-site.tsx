"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileUp,
  HelpCircle,
  LockKeyhole,
  Menu,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useMemo,
  useState,
} from "react";

import {
  buildReconciliationCsv,
  type FindingStatus,
  MAX_INVOICE_CREDIT_ROWS,
  parseReconciliationCsv,
  type ParsedRecord,
  reconcileRecords,
  type ReconciliationFinding,
  type ReconciliationProvenance,
  type ReconciliationReport,
  type ReconciliationSource,
} from "@/lib/vendor-reconciliation";

const SAMPLE_STATEMENT_URL = "/samples/restaurant-vendor-statement.csv";
const SAMPLE_LEDGER_URL = "/samples/restaurant-ap-ledger.csv";
const PILOT_EMAIL =
  process.env.NEXT_PUBLIC_PILOT_EMAIL || "writeoffapp@gmail.com";
const EMPTY_PROVENANCE: ReconciliationProvenance = {
  vendor: "",
  location: "",
  periodStart: "",
  periodEnd: "",
};
const SAMPLE_PROVENANCE: ReconciliationProvenance = {
  vendor: "Northstar Foods",
  location: "Demo Bistro · River North",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
};

type UploadedCsv = {
  name: string;
  records: ParsedRecord[];
  error?: string;
};

type FilterValue = "exceptions" | "all" | FindingStatus;

type PilotForm = {
  name: string;
  email: string;
  restaurant: string;
  role: string;
  locations: string;
  distributor: string;
  currentProcess: string;
  dataReady: string;
};

const EMPTY_PILOT_FORM: PilotForm = {
  name: "",
  email: "",
  restaurant: "",
  role: "",
  locations: "",
  distributor: "",
  currentProcess: "",
  dataReady: "",
};

const STATUS_META: Record<
  FindingStatus,
  { label: string; pill: string; dot: string }
> = {
  matched: {
    label: "Field match",
    pill: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
  },
  statement_only: {
    label: "Missing internally",
    pill: "border-rose-200 bg-rose-50 text-rose-800",
    dot: "bg-rose-500",
  },
  ledger_only: {
    label: "Missing on statement",
    pill: "border-amber-200 bg-amber-50 text-amber-900",
    dot: "bg-amber-500",
  },
  possible_duplicate: {
    label: "Possible duplicate",
    pill: "border-violet-200 bg-violet-50 text-violet-800",
    dot: "bg-violet-500",
  },
  amount_mismatch: {
    label: "Amount mismatch",
    pill: "border-orange-200 bg-orange-50 text-orange-900",
    dot: "bg-orange-500",
  },
  payment_mismatch: {
    label: "Status mismatch",
    pill: "border-sky-200 bg-sky-50 text-sky-800",
    dot: "bg-sky-500",
  },
  review_required: {
    label: "Review required",
    pill: "border-yellow-200 bg-yellow-50 text-yellow-900",
    dot: "bg-yellow-500",
  },
};

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "exceptions", label: "All exceptions" },
  { value: "matched", label: "Field match" },
  { value: "statement_only", label: "Missing internally" },
  { value: "ledger_only", label: "Missing on statement" },
  { value: "amount_mismatch", label: "Amount mismatch" },
  { value: "payment_mismatch", label: "Status mismatch" },
  { value: "possible_duplicate", label: "Possible duplicate" },
  { value: "review_required", label: "Review required" },
  { value: "all", label: "Every finding" },
];

function currency(cents: number | undefined): string {
  if (cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function rowsLabel(records: ParsedRecord[]): string {
  return `${records.length} row${records.length === 1 ? "" : "s"} ready`;
}

function traceLabel(
  traces: ReconciliationFinding["statementTraces"],
): string {
  if (traces.length === 0) return "No source row";
  const rows = traces.map((trace) => trace.rowNumber).join(", ");
  return `${traces[0].sourceName} · row${traces.length === 1 ? "" : "s"} ${rows}`;
}

function FileDropzone({
  title,
  description,
  source,
  value,
  onFile,
}: {
  title: string;
  description: string;
  source: ReconciliationSource;
  value?: UploadedCsv;
  onFile: (file: File, source: ReconciliationSource) => Promise<void>;
}) {
  const [dragging, setDragging] = useState(false);
  const inputId = `${source}-csv-input`;

  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void onFile(file, source);
    event.target.value = "";
  };

  const dropFile = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void onFile(file, source);
  };

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#17211b]">{title}</p>
          <p className="mt-1 text-sm leading-6 text-[#5f6c63]">{description}</p>
        </div>
        <span className="rounded-full border border-[#d8ded8] bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[#667168]">
          CSV
        </span>
      </div>
      <label
        htmlFor={inputId}
        onDragEnter={() => setDragging(true)}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropFile}
        className={`group flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-7 text-center transition focus-within:border-[#205b45] focus-within:ring-4 focus-within:ring-[#205b45]/25 ${
          dragging
            ? "border-[#e36a3d] bg-[#fff4ed]"
            : value?.error
              ? "border-rose-300 bg-rose-50"
              : value
                ? "border-emerald-300 bg-emerald-50/70"
                : "border-[#c9d1ca] bg-white hover:border-[#7a8a7d] hover:bg-[#fbfcfa]"
        }`}
      >
        <input
          id={inputId}
          className="sr-only"
          type="file"
          accept=".csv,text/csv"
          onChange={pickFile}
        />
        {value?.error ? (
          <>
            <AlertTriangle className="h-7 w-7 text-rose-600" />
            <span className="mt-3 text-sm font-semibold text-rose-800">
              This file needs attention
            </span>
            <span className="mt-1 max-w-sm text-xs leading-5 text-rose-700">
              {value.error}
            </span>
            <span className="mt-3 text-xs font-semibold text-rose-800 underline underline-offset-4">
              Choose another CSV
            </span>
          </>
        ) : value ? (
          <>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Check className="h-5 w-5" />
            </span>
            <span className="mt-3 max-w-full truncate text-sm font-semibold text-emerald-950">
              {value.name}
            </span>
            <span className="mt-1 text-xs text-emerald-800">
              {rowsLabel(value.records)}
            </span>
            <span className="mt-3 text-xs font-semibold text-emerald-800 underline underline-offset-4">
              Replace file
            </span>
          </>
        ) : (
          <>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#edf1ed] text-[#355044] transition group-hover:bg-[#dfe8e1]">
              <FileUp className="h-5 w-5" />
            </span>
            <span className="mt-3 text-sm font-semibold text-[#23362d]">
              Drop a redacted CSV or browse
            </span>
            <span className="mt-1 text-xs leading-5 text-[#59665d]">
              reference, date, type, amount, payment_status
            </span>
          </>
        )}
      </label>
    </div>
  );
}

function StatusPill({ status }: { status: FindingStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function SourceCard({
  title,
  traces,
}: {
  title: string;
  traces: ReconciliationFinding["statementTraces"];
}) {
  return (
    <div className="rounded-xl border border-[#dfe4df] bg-[#fafbf9] p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#536159]">
        {title}
      </p>
      {traces.length === 0 ? (
        <p className="mt-3 text-sm text-[#59665d]">No corresponding source row.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {traces.map((trace) => (
            <div key={trace.id} className="text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-[#203128]">
                  {trace.sourceName} · row {trace.rowNumber}
                </span>
                <span className="font-semibold tabular-nums text-[#203128]">
                  {currency(trace.amountCents)}
                </span>
              </div>
              <p className="mt-1 text-xs text-[#55645b]">
                {trace.reference} · {trace.date}
                {trace.paymentStatus ? ` · ${trace.paymentStatus}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReconciliationSite() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [provenance, setProvenance] =
    useState<ReconciliationProvenance>(EMPTY_PROVENANCE);
  const [statement, setStatement] = useState<UploadedCsv>();
  const [ledger, setLedger] = useState<UploadedCsv>();
  const [report, setReport] = useState<ReconciliationReport>();
  const [selectedFindingId, setSelectedFindingId] = useState<string>();
  const [filter, setFilter] = useState<FilterValue>("exceptions");
  const [loadingSample, setLoadingSample] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [pilotForm, setPilotForm] = useState<PilotForm>(EMPTY_PILOT_FORM);
  const [pilotBrief, setPilotBrief] = useState("");
  const [copied, setCopied] = useState(false);

  const processFile = async (file: File, source: ReconciliationSource) => {
    setReport(undefined);
    setSelectedFindingId(undefined);
    setWorkspaceMessage("");

    if (!file.name.toLowerCase().endsWith(".csv")) {
      const invalid = {
        name: file.name,
        records: [],
        error: "Choose a file ending in .csv.",
      };
      if (source === "statement") setStatement(invalid);
      else setLedger(invalid);
      return;
    }

    if (file.size > 1_000_000) {
      const invalid = {
        name: file.name,
        records: [],
        error: "Keep the redacted file under 1 MB.",
      };
      if (source === "statement") setStatement(invalid);
      else setLedger(invalid);
      return;
    }

    try {
      const records = parseReconciliationCsv(
        await file.text(),
        source,
        file.name,
      );
      const parsed = { name: file.name, records };
      if (source === "statement") setStatement(parsed);
      else setLedger(parsed);
    } catch (error) {
      const invalid = {
        name: file.name,
        records: [],
        error: error instanceof Error ? error.message : "Unable to read this CSV.",
      };
      if (source === "statement") setStatement(invalid);
      else setLedger(invalid);
    }
  };

  const runReconciliation = (
    statementInput = statement,
    ledgerInput = ledger,
    provenanceInput = provenance,
  ) => {
    if (
      !statementInput?.records.length ||
      !ledgerInput?.records.length ||
      statementInput.error ||
      ledgerInput.error
    ) {
      setWorkspaceMessage("Add two valid redacted CSV files before matching.");
      return;
    }

    try {
      const nextReport = reconcileRecords(
        statementInput.records,
        ledgerInput.records,
        provenanceInput,
      );
      setReport(nextReport);
      setSelectedFindingId(undefined);
      setFilter("exceptions");
      setWorkspaceMessage(
        "Reconciliation complete. Nothing was uploaded or saved by this workspace.",
      );
    } catch (error) {
      setReport(undefined);
      setSelectedFindingId(undefined);
      setWorkspaceMessage(
        error instanceof Error
          ? error.message
          : "These sources could not be reconciled.",
      );
    }
  };

  const loadSample = async () => {
    setLoadingSample(true);
    setWorkspaceMessage("");
    try {
      const [statementResponse, ledgerResponse] = await Promise.all([
        fetch(SAMPLE_STATEMENT_URL),
        fetch(SAMPLE_LEDGER_URL),
      ]);
      if (!statementResponse.ok || !ledgerResponse.ok) {
        throw new Error("Sample files could not be loaded.");
      }

      const statementInput: UploadedCsv = {
        name: "restaurant-vendor-statement.csv",
        records: parseReconciliationCsv(
          await statementResponse.text(),
          "statement",
          "restaurant-vendor-statement.csv",
        ),
      };
      const ledgerInput: UploadedCsv = {
        name: "restaurant-ap-ledger.csv",
        records: parseReconciliationCsv(
          await ledgerResponse.text(),
          "ledger",
          "restaurant-ap-ledger.csv",
        ),
      };
      setStatement(statementInput);
      setLedger(ledgerInput);
      setProvenance(SAMPLE_PROVENANCE);
      runReconciliation(statementInput, ledgerInput, SAMPLE_PROVENANCE);
      requestAnimationFrame(() => {
        document
          .getElementById("workspace")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (error) {
      setWorkspaceMessage(
        error instanceof Error ? error.message : "Sample files could not be loaded.",
      );
    } finally {
      setLoadingSample(false);
    }
  };

  const clearWorkspace = () => {
    setProvenance(EMPTY_PROVENANCE);
    setStatement(undefined);
    setLedger(undefined);
    setReport(undefined);
    setSelectedFindingId(undefined);
    setWorkspaceMessage("Workspace cleared from this browser tab.");
  };

  const updateProvenance = (
    field: keyof ReconciliationProvenance,
    value: string,
  ) => {
    setProvenance((current) => ({ ...current, [field]: value }));
    setReport(undefined);
    setSelectedFindingId(undefined);
    setWorkspaceMessage("");
  };

  const filteredFindings = useMemo(() => {
    if (!report) return [];
    if (filter === "all") return report.findings;
    if (filter === "exceptions") {
      return report.findings.filter((item) => item.status !== "matched");
    }
    return report.findings.filter((item) => item.status === filter);
  }, [filter, report]);

  const selectedFinding = report?.findings.find(
    (item) => item.id === selectedFindingId,
  );

  const updatePilotField = (field: keyof PilotForm, value: string) => {
    setPilotForm((current) => ({ ...current, [field]: value }));
    setPilotBrief("");
    setCopied(false);
  };

  const incumbentUser =
    pilotForm.currentProcess === "MarginEdge" ||
    pilotForm.currentProcess === "xtraCHEF";

  const preparePilotBrief = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (incumbentUser) {
      setPilotBrief("");
      return;
    }
    const brief = [
      "TABLEPROOF PILOT FIT REQUEST",
      "",
      `Contact: ${pilotForm.name}`,
      `Work email: ${pilotForm.email}`,
      `Restaurant/group: ${pilotForm.restaurant}`,
      `Role: ${pilotForm.role}`,
      `Locations: ${pilotForm.locations}`,
      `Primary distributor: ${pilotForm.distributor}`,
      `Current process: ${pilotForm.currentProcess}`,
      `Redacted data readiness: ${pilotForm.dataReady}`,
      "",
      "Requested scope: one location, one distributor, two statement periods, up to 150 invoices/credits.",
      "No portal, bank, or vendor credentials will be shared.",
    ].join("\n");
    setPilotBrief(brief);
    setCopied(false);
  };

  const copyPilotBrief = async () => {
    await navigator.clipboard.writeText(pilotBrief);
    setCopied(true);
  };

  const mailtoHref = `mailto:${PILOT_EMAIL}?subject=${encodeURIComponent(
    `TableProof pilot fit — ${pilotForm.restaurant || "restaurant"}`,
  )}&body=${encodeURIComponent(pilotBrief)}`;

  return (
    <div
      className="min-h-screen overflow-x-hidden bg-[#f7f5ef] text-[#17211b]"
      style={{ colorScheme: "light" }}
    >
      <header className="sticky top-0 z-50 border-b border-[#dde2dc]/90 bg-[#f7f5ef]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#183e32] text-white shadow-sm">
              <FileCheck2 className="h-[18px] w-[18px]" />
            </span>
            <span>
              <span className="block text-[17px] font-bold leading-none tracking-[-0.025em]">
                TableProof
              </span>
              <span className="mt-1 block text-[9px] font-bold uppercase tracking-[0.18em] text-[#4f5e55]">
                Validation pilot
              </span>
            </span>
          </a>

          <nav className="hidden items-center gap-7 text-sm font-semibold text-[#59665d] md:flex">
            <a className="transition hover:text-[#183e32]" href="#workflow">
              Workflow
            </a>
            <a className="transition hover:text-[#183e32]" href="#workspace">
              Local workspace
            </a>
            <a className="transition hover:text-[#183e32]" href="#boundaries">
              Boundaries
            </a>
            <a className="transition hover:text-[#183e32]" href="#pilot">
              Pilot
            </a>
          </nav>

          <a
            href="#pilot"
            className="hidden rounded-full bg-[#183e32] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#0f2f25] md:inline-flex"
          >
            Check pilot fit
          </a>
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#d7ddd7] bg-white text-[#29483c] md:hidden"
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {mobileOpen ? (
          <nav className="border-t border-[#dde2dc] bg-[#f7f5ef] px-5 py-4 md:hidden">
            {[
              ["Workflow", "#workflow"],
              ["Local workspace", "#workspace"],
              ["Boundaries", "#boundaries"],
              ["Pilot", "#pilot"],
            ].map(([label, href]) => (
              <a
                key={href}
                className="block rounded-xl px-3 py-3 text-sm font-semibold text-[#405047] hover:bg-white"
                href={href}
                onClick={() => setMobileOpen(false)}
              >
                {label}
              </a>
            ))}
          </nav>
        ) : null}
      </header>

      <main id="top">
        <section className="relative isolate overflow-hidden">
          <div className="absolute inset-x-0 top-0 -z-10 h-[760px] bg-[radial-gradient(circle_at_76%_18%,rgba(222,231,217,0.9),transparent_32%),radial-gradient(circle_at_18%_32%,rgba(249,221,202,0.62),transparent_29%)]" />
          <div className="mx-auto grid max-w-7xl gap-14 px-5 pb-24 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-20 lg:pb-32 lg:pt-28">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d5ddd5] bg-white/80 px-3 py-1.5 text-xs font-bold text-[#315244] shadow-sm">
                <span className="h-2 w-2 rounded-full bg-[#e36a3d]" />
                Browser-local validation prototype
              </div>
              <h1 className="mt-7 max-w-3xl text-5xl font-bold leading-[1.02] tracking-[-0.055em] text-[#14241c] sm:text-6xl lg:text-[68px]">
                Close the vendor statement with{" "}
                <span className="relative whitespace-nowrap text-[#d95f34]">
                  evidence
                  <svg
                    className="absolute -bottom-2 left-0 w-full"
                    viewBox="0 0 260 13"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 9.4C64 3.9 158 2.5 257 5.2"
                      stroke="currentColor"
                      strokeWidth="5"
                      strokeLinecap="round"
                      opacity=".28"
                    />
                  </svg>
                </span>
                , not guesswork.
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-8 text-[#536159] sm:text-xl">
                Compare a redacted vendor statement with your AP export. Rows
                match only when transaction fields and status evidence agree;
                everything else stays visible for a human decision.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void loadSample()}
                  disabled={loadingSample}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#183e32] px-6 text-sm font-bold text-white shadow-[0_12px_30px_rgba(24,62,50,0.2)] transition hover:-translate-y-0.5 hover:bg-[#103328] disabled:cursor-wait disabled:opacity-70"
                >
                  <Sparkles className="h-4 w-4" />
                  {loadingSample ? "Loading sample…" : "Run the sample audit"}
                </button>
                <a
                  href="#workspace"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[#cad2cb] bg-white/80 px-6 text-sm font-bold text-[#264538] transition hover:bg-white"
                >
                  Use my redacted CSVs
                  <ArrowRight className="h-4 w-4" />
                </a>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold text-[#66736b]">
                <span className="inline-flex items-center gap-2">
                  <LockKeyhole className="h-4 w-4 text-[#2a6c55]" />
                  CSV content stays in this tab
                </span>
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[#2a6c55]" />
                  No credentials or bank connection
                </span>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-7 -z-10 rotate-2 rounded-[40px] bg-[#dfe8dc]/70 blur-sm" />
              <div className="overflow-hidden rounded-[26px] border border-white/80 bg-white shadow-[0_34px_90px_rgba(40,55,45,0.18)]">
                <div className="flex items-center justify-between border-b border-[#e6e9e5] px-5 py-4 sm:px-6">
                  <div>
                    <p className="text-sm font-bold text-[#20342a]">
                      August reconciliation
                    </p>
                    <p className="mt-0.5 text-xs text-[#536159]">
                      Northstar Foods · illustrative sample
                    </p>
                  </div>
                  <span className="rounded-full bg-[#fff0e8] px-3 py-1.5 text-[11px] font-bold text-[#bd4b24]">
                    6 to review
                  </span>
                </div>
                <div className="grid grid-cols-3 border-b border-[#e8ebe7] bg-[#fbfcfa]">
                  {[
                    ["19", "Source rows"],
                    ["4", "Field matches"],
                    ["6", "Findings"],
                  ].map(([value, label], index) => (
                    <div
                      key={label}
                      className={`px-3 py-5 text-center ${index ? "border-l border-[#e8ebe7]" : ""}`}
                    >
                      <p className="text-2xl font-bold tracking-tight text-[#1b3126]">
                        {value}
                      </p>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#536159]">
                        {label}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="p-5 sm:p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#536159]">
                      Review queue
                    </p>
                    <span className="text-xs font-semibold text-[#426151]">
                      Every row traced
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {[
                      ["INV-1043", "Amount mismatch", "$1,197.80 / $1,192.80", "orange"],
                      ["INV-1044", "Status mismatch", "paid / open", "sky"],
                      ["INV-1046", "Possible duplicate", "statement rows 8–9", "violet"],
                      ["CM-221", "Missing internally", "statement row 10", "rose"],
                    ].map(([reference, label, value, color]) => (
                      <div
                        key={reference}
                        className="flex items-center gap-3 rounded-xl border border-[#e4e8e3] px-3.5 py-3"
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            color === "orange"
                              ? "bg-orange-500"
                              : color === "sky"
                                ? "bg-sky-500"
                                : color === "violet"
                                  ? "bg-violet-500"
                                  : "bg-rose-500"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-bold text-[#22372c]">
                              {reference}
                            </span>
                            <span className="truncate text-xs font-semibold text-[#69766e]">
                              {value}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-[#59665d]">{label}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-[#68756d]" />
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex items-center gap-3 rounded-xl bg-[#eef4ef] px-4 py-3 text-xs font-semibold leading-5 text-[#3c5a4a]">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-[#2f765b]" />
                    Repeated references are opened first. Both sources must
                    include agreeing status evidence for a field match.
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-6 -left-5 hidden rotate-[-3deg] rounded-2xl border border-[#e3ddd2] bg-[#fffdf8] px-4 py-3 shadow-lg sm:block">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#66594c]">
                  Source link
                </p>
                <p className="mt-1 text-sm font-bold text-[#314138]">
                  statement.csv · row 10
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-[#dfe4de] bg-white">
          <div className="mx-auto grid max-w-7xl divide-y divide-[#e5e9e4] px-5 sm:px-8 md:grid-cols-3 md:divide-x md:divide-y-0 md:px-0">
            {[
              {
                icon: FileSpreadsheet,
                eyebrow: "Bounded input",
                title: "Two redacted CSVs",
                copy: "Statement rows on one side; invoices, credits, and payments on the other.",
              },
              {
                icon: Search,
                eyebrow: "Conservative logic",
                title: "Repeated references stay open",
                copy: "Duplicate reference/type groups are isolated before exact fields and status evidence are compared.",
              },
              {
                icon: FileCheck2,
                eyebrow: "Reviewable output",
                title: "Source rows on every finding",
                copy: "The exception CSV carries the applied rule, source filename, and row number.",
              },
            ].map(({ icon: Icon, eyebrow, title, copy }) => (
              <div key={title} className="px-1 py-8 md:px-8 lg:px-10">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eef2ed] text-[#23513f]">
                  <Icon className="h-5 w-5" />
                </div>
                <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#9f3c1c]">
                  {eyebrow}
                </p>
                <h2 className="mt-2 text-lg font-bold tracking-[-0.02em]">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-[#67736b]">{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="workflow" className="scroll-mt-24">
          <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
            <div className="grid gap-14 lg:grid-cols-[0.78fr_1.22fr] lg:gap-24">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.19em] text-[#9f3c1c]">
                  One narrow job
                </p>
                <h2 className="mt-4 text-4xl font-bold leading-tight tracking-[-0.045em] sm:text-5xl">
                  Find what needs a person before close.
                </h2>
                <p className="mt-6 text-base leading-7 text-[#5f6c64]">
                  This MVP does not read PDFs, normalize line items, contact
                  vendors, move money, or decide that funds are owed. It tests
                  whether a small, auditable matching workflow is useful.
                </p>
                <a
                  href="#boundaries"
                  className="mt-7 inline-flex items-center gap-2 text-sm font-bold text-[#1e5d46]"
                >
                  See the product boundaries
                  <ArrowRight className="h-4 w-4" />
                </a>
              </div>
              <ol className="grid gap-4 sm:grid-cols-3">
                {[
                  {
                    number: "01",
                    title: "Redact & export",
                    copy: "Keep only reference, date, type, amount, and optional payment status.",
                  },
                  {
                    number: "02",
                    title: "Match locally",
                    copy: "The browser opens repeated references first, then compares exact fields and two-sided status evidence.",
                  },
                  {
                    number: "03",
                    title: "Review & export",
                    copy: "Inspect unresolved items and download a row-level exception report.",
                  },
                ].map((step) => (
                  <li
                    key={step.number}
                    className="relative overflow-hidden rounded-3xl border border-[#dce2dc] bg-white p-6 shadow-[0_12px_35px_rgba(35,52,42,0.05)]"
                  >
                    <span className="text-5xl font-bold tracking-[-0.06em] text-[#68756d]">
                      {step.number}
                    </span>
                    <h3 className="mt-8 text-lg font-bold">{step.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-[#68756d]">
                      {step.copy}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="workspace" className="scroll-mt-20 bg-[#17392f]">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-24">
            <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-[#dce9df]">
                  <LockKeyhole className="h-3.5 w-3.5" />
                  Local workspace
                </div>
                <h2 className="mt-5 max-w-2xl text-4xl font-bold tracking-[-0.045em] text-white sm:text-5xl">
                  Test the matching logic yourself.
                </h2>
                <p className="mt-5 max-w-2xl text-base leading-7 text-[#c1d1c7]">
                  Uploaded CSV content is held in memory in this browser tab.
                  It is not posted to an API or written to browser storage.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void loadSample()}
                  disabled={loadingSample}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-[#1b4335] transition hover:bg-[#f1f5f1] disabled:opacity-60"
                >
                  <Sparkles className="h-4 w-4" />
                  {loadingSample ? "Loading…" : "Load sample"}
                </button>
                <button
                  type="button"
                  onClick={clearWorkspace}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-5 text-sm font-bold text-white transition hover:bg-white/10"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Clear
                </button>
              </div>
            </div>

            <div className="mt-10 rounded-[28px] bg-[#f7f5ef] p-4 shadow-[0_30px_80px_rgba(0,0,0,0.18)] sm:p-6 lg:p-8">
              <fieldset className="rounded-2xl border border-[#d6ddd7] bg-white p-5">
                <legend className="px-2 text-sm font-bold text-[#20352a]">
                  Reconciliation provenance
                </legend>
                <p className="mb-5 text-xs leading-5 text-[#59665d]">
                  Required for the audit trail. Every source row must fall
                  inside this statement period.
                </p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="text-xs font-bold text-[#35483e]">
                    Vendor
                    <input
                      required
                      value={provenance.vendor}
                      onChange={(event) =>
                        updateProvenance("vendor", event.target.value)
                      }
                      className="mt-2 min-h-11 w-full rounded-xl border border-[#b8c2ba] bg-white px-3.5 text-sm font-normal text-[#20352a] placeholder:text-[#5f6c64]"
                      placeholder="Northstar Foods"
                    />
                  </label>
                  <label className="text-xs font-bold text-[#35483e]">
                    Restaurant location
                    <input
                      required
                      value={provenance.location}
                      onChange={(event) =>
                        updateProvenance("location", event.target.value)
                      }
                      className="mt-2 min-h-11 w-full rounded-xl border border-[#b8c2ba] bg-white px-3.5 text-sm font-normal text-[#20352a] placeholder:text-[#5f6c64]"
                      placeholder="River North"
                    />
                  </label>
                  <label className="text-xs font-bold text-[#35483e]">
                    Period start
                    <input
                      required
                      type="date"
                      value={provenance.periodStart}
                      onChange={(event) =>
                        updateProvenance("periodStart", event.target.value)
                      }
                      className="mt-2 min-h-11 w-full rounded-xl border border-[#b8c2ba] bg-white px-3.5 text-sm font-normal text-[#20352a]"
                    />
                  </label>
                  <label className="text-xs font-bold text-[#35483e]">
                    Period end
                    <input
                      required
                      type="date"
                      value={provenance.periodEnd}
                      onChange={(event) =>
                        updateProvenance("periodEnd", event.target.value)
                      }
                      className="mt-2 min-h-11 w-full rounded-xl border border-[#b8c2ba] bg-white px-3.5 text-sm font-normal text-[#20352a]"
                    />
                  </label>
                </div>
              </fieldset>

              <div className="mt-8 grid gap-7 lg:grid-cols-2">
                <FileDropzone
                  title="1. Vendor statement"
                  description="One distributor statement period, exported and redacted."
                  source="statement"
                  value={statement}
                  onFile={processFile}
                />
                <FileDropzone
                  title="2. Internal AP ledger"
                  description="Corresponding invoices, credits, and payment records."
                  source="ledger"
                  value={ledger}
                  onFile={processFile}
                />
              </div>

              <div className="mt-7 flex flex-col gap-4 border-t border-[#dce2dc] pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3 text-xs leading-5 text-[#66736b]">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#2d7358]" />
                  <span>
                    Only approved columns are accepted. Unexpected fields are
                    blocked so you can remove account numbers, names, banking
                    data, and negotiated line-item detail first.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => runReconciliation()}
                  className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-[#a94321] px-6 text-sm font-bold text-white shadow-sm transition hover:bg-[#8f3519]"
                >
                  Run reconciliation
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              {workspaceMessage ? (
                <p
                  className="mt-4 rounded-xl border border-[#d9dfd9] bg-white px-4 py-3 text-sm font-semibold text-[#405148]"
                  role="status"
                >
                  {workspaceMessage}
                </p>
              ) : null}
              <p className="mt-4 text-center text-xs text-[#59665d]">
                Pilot limit: {MAX_INVOICE_CREDIT_ROWS} invoice/credit rows per
                file; payment rows do not count · Refreshing or closing this tab
                clears the workspace
              </p>
            </div>

            {report ? (
              <div className="mt-8 overflow-hidden rounded-[28px] bg-white shadow-[0_30px_80px_rgba(0,0,0,0.18)]">
                <div className="border-b border-[#e2e7e2] px-5 py-6 sm:px-8">
                  <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                          <CheckCircle2 className="h-4 w-4" />
                        </span>
                        <div>
                          <h3 className="font-bold text-[#193126]">
                            Reconciliation report
                          </h3>
                          <p className="mt-0.5 text-xs text-[#536159]">
                            Generated locally · {new Date(report.generatedAt).toLocaleString()}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-[#405148]">
                            {report.provenance.vendor} ·{" "}
                            {report.provenance.location} ·{" "}
                            {report.provenance.periodStart}–{report.provenance.periodEnd}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          downloadText(
                            "tableproof-exceptions.csv",
                            buildReconciliationCsv(report, true),
                          )
                        }
                        className="inline-flex min-h-10 items-center gap-2 rounded-full bg-[#193d31] px-4 text-xs font-bold text-white transition hover:bg-[#102e25]"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Exception CSV
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          downloadText(
                            "tableproof-full-audit.csv",
                            buildReconciliationCsv(report, false),
                          )
                        }
                        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#d4dbd5] px-4 text-xs font-bold text-[#345044] transition hover:bg-[#f5f7f5]"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Full audit CSV
                      </button>
                    </div>
                  </div>

                  <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {[
                      ["Rows processed", report.summary.rowsProcessed, "Across both sources"],
                      ["Field matches", report.summary.matched, "Both sources and status agree"],
                      ["Exceptions", report.summary.exceptionCount, "Kept open for review"],
                      [
                        "Judgment needed",
                        report.summary.review_required +
                          report.summary.possible_duplicate,
                        "Never auto-confirmed",
                      ],
                    ].map(([label, value, helper]) => (
                      <div
                        key={label}
                        className="rounded-2xl border border-[#e2e7e2] bg-[#fafbf9] p-4"
                      >
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#536159]">
                          {label}
                        </p>
                        <p className="mt-2 text-3xl font-bold tracking-[-0.04em] text-[#1d382c]">
                          {value}
                        </p>
                        <p className="mt-1 text-xs text-[#536159]">{helper}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="px-5 py-5 sm:px-8">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                    <div>
                      <p className="text-sm font-bold text-[#263a30]">
                        Finding ledger
                      </p>
                      <p className="mt-1 text-xs text-[#536159]">
                        Select a row to inspect its rule and source trail.
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-xs font-semibold text-[#617067]">
                      Show
                      <select
                        value={filter}
                        onChange={(event) => {
                          setFilter(event.target.value as FilterValue);
                          setSelectedFindingId(undefined);
                        }}
                        className="min-h-10 rounded-xl border border-[#d6ddd7] bg-white px-3 pr-8 text-xs font-bold text-[#2c4438]"
                      >
                        {FILTERS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-5 overflow-x-auto rounded-2xl border border-[#e0e5e0]">
                    <table className="w-full min-w-[900px] border-collapse text-left">
                      <thead className="bg-[#f6f8f5]">
                        <tr className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#536159]">
                          <th className="px-4 py-3">Finding</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Reference</th>
                          <th className="px-4 py-3">Statement / ledger</th>
                          <th className="px-4 py-3">Source trail</th>
                          <th className="px-4 py-3 text-right">Inspect</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e7eae7]">
                        {filteredFindings.map((item) => (
                          <tr
                            key={item.id}
                            className={`text-sm transition hover:bg-[#fafbf9] ${
                              selectedFindingId === item.id ? "bg-[#f1f6f2]" : ""
                            }`}
                          >
                            <td className="px-4 py-4 font-mono text-xs font-bold text-[#536159]">
                              {item.id}
                            </td>
                            <td className="px-4 py-4">
                              <StatusPill status={item.status} />
                            </td>
                            <td className="px-4 py-4">
                              <p className="font-bold text-[#20352a]">
                                {item.reference}
                              </p>
                              <p className="mt-1 text-xs capitalize text-[#536159]">
                                {item.type}
                              </p>
                            </td>
                            <td className="px-4 py-4 font-semibold tabular-nums text-[#35483e]">
                              {currency(item.statementAmountCents)}
                              <span className="mx-2 text-[#65716a]">/</span>
                              {currency(item.ledgerAmountCents)}
                            </td>
                            <td className="max-w-[310px] px-4 py-4 text-xs leading-5 text-[#6b776f]">
                              <span className="block truncate">
                                S: {traceLabel(item.statementTraces)}
                              </span>
                              <span className="block truncate">
                                L: {traceLabel(item.ledgerTraces)}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <button
                                type="button"
                                onClick={() => setSelectedFindingId(item.id)}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#d9dfda] text-[#355145] transition hover:bg-white"
                                aria-label={`Inspect ${item.id}`}
                              >
                                <Search className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredFindings.length === 0 ? (
                      <div className="px-5 py-12 text-center text-sm text-[#536159]">
                        No findings in this filter.
                      </div>
                    ) : null}
                  </div>

                  {selectedFinding ? (
                    <div className="mt-5 rounded-2xl border border-[#d8dfd9] bg-white p-5 shadow-[0_12px_30px_rgba(31,49,39,0.06)] sm:p-6">
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-[#536159]">
                              {selectedFinding.id}
                            </span>
                            <StatusPill status={selectedFinding.status} />
                          </div>
                          <h4 className="mt-3 text-xl font-bold tracking-[-0.025em] text-[#20372b]">
                            {selectedFinding.reference}
                          </h4>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedFindingId(undefined)}
                          className="flex h-9 w-9 items-center justify-center self-end rounded-lg text-[#536159] hover:bg-[#f2f5f2] sm:self-auto"
                          aria-label="Close finding details"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-5 grid gap-4 lg:grid-cols-2">
                        <SourceCard
                          title="Vendor statement evidence"
                          traces={selectedFinding.statementTraces}
                        />
                        <SourceCard
                          title="Internal ledger evidence"
                          traces={selectedFinding.ledgerTraces}
                        />
                      </div>
                      <div className="mt-4 grid gap-4 rounded-xl bg-[#f2f5f1] p-4 lg:grid-cols-2">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#536159]">
                            Applied rule
                          </p>
                          <p className="mt-2 text-sm font-semibold leading-6 text-[#344a3e]">
                            {selectedFinding.rule}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#536159]">
                            Why it is open
                          </p>
                          <p className="mt-2 text-sm leading-6 text-[#55645b]">
                            {selectedFinding.detail}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section id="boundaries" className="scroll-mt-20 bg-[#f7f5ef]">
          <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
            <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:gap-24">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.19em] text-[#9f3c1c]">
                  Trust starts with limits
                </p>
                <h2 className="mt-4 text-4xl font-bold leading-tight tracking-[-0.045em] sm:text-5xl">
                  A review aid, not an accounts-payable system.
                </h2>
                <p className="mt-6 text-base leading-7 text-[#5e6b63]">
                  TableProof is an MVP for testing a narrow workflow. A finding
                  is a prompt to inspect the source records—not a conclusion
                  that a vendor owes money or that a payment should be made.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-700 text-white">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-lg font-bold text-emerald-950">
                    In this MVP
                  </h3>
                  <ul className="mt-4 space-y-3 text-sm leading-6 text-emerald-950/75">
                    {[
                      "Redacted CSV input",
                      "Guarded field matching",
                      "Conservative exception states",
                      "Source filename and row trace",
                      "Local CSV report download",
                    ].map((item) => (
                      <li key={item} className="flex gap-2.5">
                        <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-700" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-3xl border border-[#e4d9ce] bg-[#fffaf3] p-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#a94321] text-white">
                    X
                  </div>
                  <h3 className="mt-5 text-lg font-bold text-[#4d3025]">
                    Deliberately excluded
                  </h3>
                  <ul className="mt-4 space-y-3 text-sm leading-6 text-[#6e574d]">
                    {[
                      "Vendor, bank, or portal credentials",
                      "PDF/OCR and handwritten adjustments",
                      "SKU or contract-price analysis",
                      "Vendor outreach or collections",
                      "Payment initiation or legal conclusions",
                    ].map((item) => (
                      <li key={item} className="flex gap-2.5">
                        <X className="mt-1 h-4 w-4 shrink-0 text-[#9f3c1c]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="pilot" className="scroll-mt-20 border-t border-[#dfe4de] bg-white">
          <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
            <div className="grid gap-14 lg:grid-cols-[0.75fr_1.25fr] lg:gap-24">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-[#f2eee5] px-3 py-1.5 text-xs font-bold text-[#715d4a]">
                  <HelpCircle className="h-3.5 w-3.5" />
                  Offer under validation
                </div>
                <h2 className="mt-6 text-4xl font-bold leading-tight tracking-[-0.045em] sm:text-5xl">
                  Is one focused pilot worth testing?
                </h2>
                <p className="mt-6 text-base leading-7 text-[#5f6c64]">
                  The proposed pilot is intentionally bounded: one restaurant
                  location, one broadline distributor, two statement periods,
                  and up to 150 invoices or credits.
                </p>
                <div className="mt-7 rounded-2xl border border-[#e1e5df] bg-[#f8f9f6] p-5">
                  <p className="text-sm font-bold text-[#263c31]">
                    Proposed validation price: $250 upfront
                  </p>
                  <p className="mt-2 text-xs leading-5 text-[#68756d]">
                    This site does not take payment. Scope, data handling, and
                    payment would be agreed in writing only after a fit review.
                  </p>
                </div>
                <ul className="mt-7 space-y-3 text-sm text-[#56655c]">
                  {[
                    "Best fit: independent groups with 2–10 locations",
                    "One named owner of bookkeeping or close",
                    "Not already using MarginEdge or xtraCHEF reconciliation",
                    "Able to export and redact complete source records",
                  ].map((item) => (
                    <li key={item} className="flex gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2f7359]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-[28px] border border-[#dce2dc] bg-[#f8f8f4] p-5 shadow-[0_20px_60px_rgba(34,50,41,0.08)] sm:p-8">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.17em] text-[#9f3c1c]">
                      Pilot intake
                    </p>
                    <h3 className="mt-2 text-2xl font-bold tracking-[-0.025em]">
                      Check the fit before sharing files
                    </h3>
                  </div>
                  <span className="hidden h-10 w-10 items-center justify-center rounded-xl bg-white text-[#285440] shadow-sm sm:flex">
                    <Clipboard className="h-5 w-5" />
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-[#68756d]">
                  This form prepares an email in your browser. It does not
                  submit to or persist in a TableProof database.
                </p>

                <form onSubmit={preparePilotBrief} className="mt-7 space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-[#35483e]">
                      Your name
                      <input
                        required
                        autoComplete="name"
                        value={pilotForm.name}
                        onChange={(event) =>
                          updatePilotField("name", event.target.value)
                        }
                        className="mt-2 min-h-11 w-full rounded-xl border border-[#b8c2ba] bg-white px-3.5 text-sm font-normal text-[#20352a] placeholder:text-[#5f6c64]"
                        placeholder="Jordan Lee"
                      />
                    </label>
                    <label className="text-sm font-semibold text-[#35483e]">
                      Work email
                      <input
                        required
                        type="email"
                        autoComplete="email"
                        value={pilotForm.email}
                        onChange={(event) =>
                          updatePilotField("email", event.target.value)
                        }
                        className="mt-2 min-h-11 w-full rounded-xl border border-[#b8c2ba] bg-white px-3.5 text-sm font-normal text-[#20352a] placeholder:text-[#5f6c64]"
                        placeholder="jordan@restaurant.com"
                      />
                    </label>
                    <label className="text-sm font-semibold text-[#35483e]">
                      Restaurant or group
                      <input
                        required
                        value={pilotForm.restaurant}
                        onChange={(event) =>
                          updatePilotField("restaurant", event.target.value)
                        }
                        className="mt-2 min-h-11 w-full rounded-xl border border-[#b8c2ba] bg-white px-3.5 text-sm font-normal text-[#20352a] placeholder:text-[#5f6c64]"
                        placeholder="Restaurant name"
                      />
                    </label>
                    <label className="text-sm font-semibold text-[#35483e]">
                      Your role
                      <select
                        required
                        value={pilotForm.role}
                        onChange={(event) =>
                          updatePilotField("role", event.target.value)
                        }
                        className="mt-2 min-h-11 w-full rounded-xl border border-[#d6ddd7] bg-white px-3.5 text-sm font-normal text-[#20352a]"
                      >
                        <option value="">Select role</option>
                        <option>Owner / operator</option>
                        <option>Controller / finance lead</option>
                        <option>Bookkeeper</option>
                        <option>Operations lead</option>
                        <option>Other</option>
                      </select>
                    </label>
                    <label className="text-sm font-semibold text-[#35483e]">
                      Number of locations
                      <select
                        required
                        value={pilotForm.locations}
                        onChange={(event) =>
                          updatePilotField("locations", event.target.value)
                        }
                        className="mt-2 min-h-11 w-full rounded-xl border border-[#d6ddd7] bg-white px-3.5 text-sm font-normal text-[#20352a]"
                      >
                        <option value="">Select range</option>
                        <option>1</option>
                        <option>2–5</option>
                        <option>6–10</option>
                        <option>11+</option>
                      </select>
                    </label>
                    <label className="text-sm font-semibold text-[#35483e]">
                      Primary distributor
                      <input
                        required
                        value={pilotForm.distributor}
                        onChange={(event) =>
                          updatePilotField("distributor", event.target.value)
                        }
                        className="mt-2 min-h-11 w-full rounded-xl border border-[#b8c2ba] bg-white px-3.5 text-sm font-normal text-[#20352a] placeholder:text-[#5f6c64]"
                        placeholder="Distributor name"
                      />
                    </label>
                    <label className="text-sm font-semibold text-[#35483e]">
                      Current process
                      <select
                        required
                        value={pilotForm.currentProcess}
                        onChange={(event) =>
                          updatePilotField("currentProcess", event.target.value)
                        }
                        className="mt-2 min-h-11 w-full rounded-xl border border-[#d6ddd7] bg-white px-3.5 text-sm font-normal text-[#20352a]"
                      >
                        <option value="">Select process</option>
                        <option>Spreadsheet / manual</option>
                        <option>No formal reconciliation</option>
                        <option>MarginEdge</option>
                        <option>xtraCHEF</option>
                        <option>Other software</option>
                      </select>
                    </label>
                    <label className="text-sm font-semibold text-[#35483e]">
                      Redacted export readiness
                      <select
                        required
                        value={pilotForm.dataReady}
                        onChange={(event) =>
                          updatePilotField("dataReady", event.target.value)
                        }
                        className="mt-2 min-h-11 w-full rounded-xl border border-[#d6ddd7] bg-white px-3.5 text-sm font-normal text-[#20352a]"
                      >
                        <option value="">Select readiness</option>
                        <option>Both statement and AP export ready</option>
                        <option>Statement ready; AP export unclear</option>
                        <option>AP export ready; statement unclear</option>
                        <option>Need help confirming exports</option>
                      </select>
                    </label>
                  </div>

                  {incumbentUser ? (
                    <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      Paid-pilot intake is unavailable for operators already
                      using MarginEdge or xtraCHEF reconciliation. This pilot is
                      limited to teams without a full-suite reconciliation workflow.
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={incumbentUser}
                    className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#193d31] px-6 text-sm font-bold text-white transition hover:bg-[#102f25] disabled:cursor-not-allowed disabled:bg-[#65746c] disabled:text-white"
                  >
                    {incumbentUser
                      ? "Paid pilot unavailable for this setup"
                      : "Prepare pilot request"}
                    {!incumbentUser ? <ArrowRight className="h-4 w-4" /> : null}
                  </button>
                </form>

                {pilotBrief ? (
                  <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                    <div className="flex gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                      <div>
                        <p className="text-sm font-bold text-emerald-950">
                          Your pilot brief is ready
                        </p>
                        <p className="mt-1 text-xs leading-5 text-emerald-900/75">
                          Nothing has been sent. Review your email draft before
                          choosing to send it.
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      <a
                        href={mailtoHref}
                        className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full bg-emerald-800 px-4 text-xs font-bold text-white"
                      >
                        Open email draft
                        <ArrowRight className="h-3.5 w-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => void copyPilotBrief()}
                        className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full border border-emerald-300 bg-white px-4 text-xs font-bold text-emerald-900"
                      >
                        <Clipboard className="h-3.5 w-3.5" />
                        {copied ? "Copied" : "Copy brief"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#315247] bg-[#15362c] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
              <FileCheck2 className="h-[18px] w-[18px]" />
            </span>
            <div>
              <p className="text-sm font-bold">TableProof</p>
              <p className="mt-0.5 text-xs text-[#c7d8ce]">
                Restaurant statement reconciliation · validation MVP
              </p>
            </div>
          </div>
          <p className="max-w-xl text-xs leading-5 text-[#c7d8ce] md:text-right">
            Review aid only. No credentials, payment movement, sensitive-data
            persistence, or conclusion that money is owed.
          </p>
        </div>
      </footer>
    </div>
  );
}
