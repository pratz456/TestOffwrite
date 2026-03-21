"use client";

import React, { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Upload, FileText, CheckCircle2, AlertCircle, XCircle,
  Loader2, Camera, DollarSign, Building2, Receipt, Info, Edit3, Eye,
} from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface Props {
  user: { id: string; email?: string };
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

type DocType = "auto" | "w2" | "1099" | "platform_summary";

// ── Field definitions with full context ──────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  irsLabel: string;         // Exact IRS label
  location: string;         // Where to find it on the physical form
  flowsTo: string;          // Which 1040 line it affects
  isMonetary: boolean;
  isCritical: boolean;      // Wrong value = IRS notice
  warningIfZero?: string;
  sanityCheck?: (v: number, allFields: Record<string, any>) => string | null;
}

const W2_FIELDS: FieldDef[] = [
  {
    key: "employerName",
    label: "Employer Name",
    irsLabel: "Box c - Employer's name, address, and ZIP code",
    location: "Center-left of the W-2, below the boxes for Social Security numbers",
    flowsTo: "Identification only - not a dollar amount",
    isMonetary: false,
    isCritical: false,
  },
  {
    key: "employerEIN",
    label: "Employer EIN",
    irsLabel: "Box b - Employer identification number (EIN)",
    location: "Top-left area, format XX-XXXXXXX",
    flowsTo: "IRS matching - must match what employer filed",
    isMonetary: false,
    isCritical: true,
  },
  {
    key: "box1Wages",
    label: "Box 1 - Wages, Tips, Other Compensation",
    irsLabel: "Box 1",
    location: "Upper-right section of the W-2, first numbered box",
    flowsTo: "Form 1040 Line 1a (Total wages)",
    isMonetary: true,
    isCritical: true,
    warningIfZero: "Box 1 is your taxable wages - it should not be $0 unless you had no taxable pay",
    sanityCheck: (v, f) => {
      if (f.box3SocialSecurityWages && Math.abs(v - f.box3SocialSecurityWages) / Math.max(v, 1) > 0.15) {
        return `Box 1 ($${v.toLocaleString()}) differs from Box 3 ($${f.box3SocialSecurityWages.toLocaleString()}) by more than 15% - this can happen with 401(k) contributions but verify both boxes`;
      }
      return null;
    },
  },
  {
    key: "box2FederalWithheld",
    label: "Box 2 - Federal Income Tax Withheld",
    irsLabel: "Box 2",
    location: "Directly below Box 1 on the right side",
    flowsTo: "Form 1040 Line 25a (Federal tax withheld) - reduces your balance due or increases your refund",
    isMonetary: true,
    isCritical: true,
    warningIfZero: "Box 2 being $0 is possible but unusual - verify you did not have any withholding",
    sanityCheck: (v, f) => {
      if (f.box1Wages && v > f.box1Wages) {
        return `Box 2 ($${v.toLocaleString()}) is larger than Box 1 wages ($${f.box1Wages.toLocaleString()}) - this is impossible. Check for a misread.`;
      }
      return null;
    },
  },
  {
    key: "box3SocialSecurityWages",
    label: "Box 3 - Social Security Wages",
    irsLabel: "Box 3",
    location: "Left side, middle section - labeled 'Social security wages'",
    flowsTo: "Not on Form 1040 directly - used for Social Security tax verification",
    isMonetary: true,
    isCritical: false,
  },
  {
    key: "box4SocialSecurityWithheld",
    label: "Box 4 - Social Security Tax Withheld",
    irsLabel: "Box 4",
    location: "Directly to the right of Box 3",
    flowsTo: "Not deducted from income - already paid through payroll",
    isMonetary: true,
    isCritical: false,
    sanityCheck: (v, f) => {
      if (f.box3SocialSecurityWages) {
        const expected = Math.min(f.box3SocialSecurityWages, 176100) * 0.062;
        if (Math.abs(v - expected) > 50) {
          return `Box 4 ($${v.toLocaleString()}) differs from expected SS withholding of $${Math.round(expected).toLocaleString()} - verify this is correct`;
        }
      }
      return null;
    },
  },
  {
    key: "box5MedicareWages",
    label: "Box 5 - Medicare Wages",
    irsLabel: "Box 5",
    location: "Below Box 3, labeled 'Medicare wages and tips'",
    flowsTo: "Not on Form 1040 directly - used for Medicare tax verification",
    isMonetary: true,
    isCritical: false,
  },
  {
    key: "box6MedicareWithheld",
    label: "Box 6 - Medicare Tax Withheld",
    irsLabel: "Box 6",
    location: "Directly to the right of Box 5",
    flowsTo: "Not deducted from income - already paid through payroll",
    isMonetary: true,
    isCritical: false,
  },
  {
    key: "box16StateWages",
    label: "Box 16 - State Wages",
    irsLabel: "Box 16",
    location: "Bottom section, labeled 'State wages, tips, etc.'",
    flowsTo: "Your state tax return - not on federal Form 1040",
    isMonetary: true,
    isCritical: false,
  },
  {
    key: "box17StateWithheld",
    label: "Box 17 - State Income Tax Withheld",
    irsLabel: "Box 17",
    location: "Bottom section, directly to the right of Box 16",
    flowsTo: "Your state tax return - reduces state balance due",
    isMonetary: true,
    isCritical: false,
  },
  {
    key: "state",
    label: "State",
    irsLabel: "Box 15 - State",
    location: "Bottom-left, 2-letter state abbreviation",
    flowsTo: "Determines which state return to file",
    isMonetary: false,
    isCritical: false,
  },
];

const FORM_1099_FIELDS: FieldDef[] = [
  { key: "payerName", label: "Payer Name", irsLabel: "Payer's name", location: "Top-left of the 1099 form", flowsTo: "Identification only", isMonetary: false, isCritical: false },
  { key: "payerEIN", label: "Payer EIN", irsLabel: "Payer's TIN", location: "Below payer name, format XX-XXXXXXX", flowsTo: "IRS matching", isMonetary: false, isCritical: true },
  {
    key: "box1Amount",
    label: "Box 1 - Nonemployee Compensation (1099-NEC) / Gross Payments (1099-K)",
    irsLabel: "Box 1",
    location: "First box on the form - labeled differently depending on form type",
    flowsTo: "Schedule C Line 1 (business income) → Form 1040 Line 8",
    isMonetary: true,
    isCritical: true,
    warningIfZero: "Box 1 is your main income amount - verify this is correct",
  },
  { key: "box4FederalWithheld", label: "Box 4 - Federal Income Tax Withheld", irsLabel: "Box 4", location: "Usually in the middle section", flowsTo: "Form 1040 Line 25b (reduces balance due)", isMonetary: true, isCritical: true },
];

const PLATFORM_FIELDS: FieldDef[] = [
  { key: "platform", label: "Platform", irsLabel: "N/A - platform branding", location: "Top of the document", flowsTo: "Income source identification", isMonetary: false, isCritical: false },
  { key: "grossEarnings", label: "Gross Earnings (before fees)", irsLabel: "Gross earnings / Gross trip earnings", location: "Usually the largest amount near the top", flowsTo: "Schedule C Line 1 - your total self-employment income before deductions", isMonetary: true, isCritical: true, warningIfZero: "Gross earnings should not be $0" },
  { key: "platformFees", label: "Platform Fees / Service Fees", irsLabel: "Uber service fee, Etsy transaction fees, etc.", location: "Deduction section - subtracted from gross", flowsTo: "Schedule C Line 10 (Commissions and fees) - deductible", isMonetary: true, isCritical: false },
  { key: "netEarnings", label: "Net Earnings (after fees)", irsLabel: "Net earnings / Driver pay", location: "Bottom summary - gross minus fees", flowsTo: "NOT what you report as income - report gross, then deduct fees separately", isMonetary: true, isCritical: false },
  { key: "milesDriven", label: "Miles Driven", irsLabel: "Mileage / Online miles", location: "Activity summary section", flowsTo: "Schedule C Line 9 (Car and truck expenses) at $0.70/mile (2025)", isMonetary: false, isCritical: false },
  { key: "form1099KAmount", label: "1099-K Amount", irsLabel: "Box 1a on Form 1099-K", location: "Tax document section", flowsTo: "Schedule C Line 1 - must match what you report", isMonetary: true, isCritical: true },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ConfidenceDot({ score }: { score: number | undefined }) {
  if (score === undefined) return null;
  const color = score >= 0.9 ? "bg-green-500" : score >= 0.75 ? "bg-amber-400" : "bg-red-500";
  const label = score >= 0.9 ? "High confidence" : score >= 0.75 ? "Medium - verify" : "Low - must verify";
  return (
    <div className="flex items-center gap-1.5 shrink-0" title={label}>
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-xs text-muted-foreground hidden sm:inline">{Math.round(score * 100)}%</span>
    </div>
  );
}

function FieldRow({
  def, value, fieldConf, onEdit, crossCheckWarning,
}: {
  def: FieldDef;
  value: string | number | null | undefined;
  fieldConf: number | undefined;
  onEdit: (key: string, val: string) => void;
  crossCheckWarning?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));

  if (value === null || value === undefined || value === "") return null;

  const displayVal = def.isMonetary && typeof value === "number" ? fmt(value) : String(value);
  const isLowConf = fieldConf !== undefined && fieldConf < 0.8;
  const hasCrossCheck = !!crossCheckWarning;

  return (
    <div className={`border border-border/50 rounded-lg p-3 space-y-2 ${isLowConf || hasCrossCheck ? "border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-950/20" : "bg-card"}`}>
      {/* Field header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-foreground">{def.label}</p>
            {def.isCritical && (
              <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded font-medium">Tax-critical</span>
            )}
            {(isLowConf || hasCrossCheck) && (
              <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded font-medium">⚠ Verify</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{def.irsLabel}</p>
        </div>
        <ConfidenceDot score={fieldConf} />
      </div>

      {/* Editable value */}
      <div className="flex items-center gap-2">
        {editing ? (
          <>
            <Input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="h-8 text-sm font-mono"
              autoFocus
            />
            <Button size="sm" className="h-8 px-2" onClick={() => { onEdit(def.key, draft); setEditing(false); }}>
              <CheckCircle2 className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditing(false)}>
              <XCircle className="w-3.5 h-3.5" />
            </Button>
          </>
        ) : (
          <>
            <span className="text-base font-bold tabular-nums text-foreground flex-1">{displayVal}</span>
            <Button size="sm" variant="ghost" className="h-8 px-2 gap-1 text-xs" onClick={() => { setDraft(String(value ?? "")); setEditing(true); }}>
              <Edit3 className="w-3.5 h-3.5" />
              Edit
            </Button>
          </>
        )}
      </div>

      {/* Where to find it */}
      <div className="rounded bg-muted/50 px-2.5 py-2 space-y-1">
        <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <Eye className="w-3 h-3 shrink-0" />
          Where on your document:
        </p>
        <p className="text-xs text-muted-foreground">{def.location}</p>
      </div>

      {/* Where it flows to */}
      <div className="text-xs text-muted-foreground flex items-start gap-1.5">
        <FileText className="w-3 h-3 shrink-0 mt-0.5" />
        <span><strong className="text-foreground">Used for:</strong> {def.flowsTo}</span>
      </div>

      {/* Warnings */}
      {crossCheckWarning && (
        <div className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {crossCheckWarning}
        </div>
      )}
      {def.warningIfZero && (typeof value === "number" ? value : parseFloat(String(value))) === 0 && (
        <div className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {def.warningIfZero}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const DOC_TYPES: { value: DocType; label: string; icon: React.ElementType }[] = [
  { value: "auto",             label: "Auto-detect",      icon: FileText   },
  { value: "w2",               label: "W-2 Form",         icon: Building2  },
  { value: "1099",             label: "1099 Form",        icon: Receipt    },
  { value: "platform_summary", label: "Platform Summary", icon: DollarSign },
];

export function DocumentImportScreen({ user, onBack, onNavigate }: Props) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear - 1));
  const [docType, setDocType] = useState<DocType>("auto");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [editedFields, setEditedFields] = useState<Record<string, any>>({});
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    setFile(f); setResult(null); setError(null);
    setCommitted(false); setEditedFields({});
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0]; if (f) handleFile(f);
  }, []);

  const handleExtract = async () => {
    if (!file) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("docType", docType);
      fd.append("taxYear", year);
      fd.append("commit", "false");
      const res = await makeAuthenticatedRequest("/api/tax/import-document", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        if (data.tips) setError(`${data.warning}\n\nTips: ${data.tips.join(" • ")}`);
        else throw new Error(data.error || "Extraction failed");
        return;
      }
      setResult(data);
      setEditedFields(data.extracted || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to extract document");
    } finally { setLoading(false); }
  };

  const handleFieldEdit = (key: string, val: string) => {
    setEditedFields(p => ({
      ...p,
      [key]: isNaN(parseFloat(val)) ? val : parseFloat(val),
    }));
  };

  const handleCommit = async () => {
    if (!file) return;
    setCommitting(true); setError(null);
    try {
      // Re-submit with edited fields merged in
      const fd = new FormData();
      fd.append("file", file);
      fd.append("docType", result?.docType || docType);
      fd.append("taxYear", String(result?.taxYear || year));
      fd.append("commit", "true");
      fd.append("overrideFields", JSON.stringify(editedFields));
      const res = await makeAuthenticatedRequest("/api/tax/import-document", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setCommitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally { setCommitting(false); }
  };

  // Determine which field definitions to show
  const getFieldDefs = (): FieldDef[] => {
    const dt = result?.docType || docType;
    if (dt === "w2" || editedFields.box1Wages !== undefined) return W2_FIELDS;
    if (dt === "1099" || editedFields.formVariant !== undefined) return FORM_1099_FIELDS;
    if (dt === "platform_summary" || editedFields.grossEarnings !== undefined) return PLATFORM_FIELDS;
    return W2_FIELDS; // default
  };

  // Run cross-checks across all fields
  const getCrossCheckWarning = (def: FieldDef): string | null => {
    if (!def.sanityCheck || !editedFields[def.key]) return null;
    const val = typeof editedFields[def.key] === "number" ? editedFields[def.key] : parseFloat(String(editedFields[def.key]));
    if (isNaN(val)) return null;
    return def.sanityCheck(val, editedFields);
  };

  const fieldConf = result?.extracted?.fieldConfidence || {};
  const totalCrossWarnings = getFieldDefs().filter(d => getCrossCheckWarning(d)).length;
  const criticalFieldsMissing = getFieldDefs()
    .filter(d => d.isCritical && !editedFields[d.key] && editedFields[d.key] !== 0).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
          <Button onClick={onBack} variant="ghost" size="icon" className="shrink-0 min-h-[44px] min-w-[44px]">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold">Import Tax Document</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">AI reads the form - you verify each field before saving</p>
          </div>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-[90px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 4 }, (_, i) => currentYear - i).map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* What this does */}
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30 px-4 py-3 text-xs text-blue-800 dark:text-blue-300">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div>
            <p>Upload a photo or scan of your W-2, 1099, or platform summary. AI extracts every field with confidence scores - you see <strong>exactly where to find each value on your document</strong> and can edit anything before saving.</p>
          </div>
        </div>

        {!result && (
          <>
            {/* Document type */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DOC_TYPES.map(({ value, label, icon: Icon }) => (
                <button key={value} onClick={() => setDocType(value)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-all ${docType === value ? "border-primary bg-primary/5 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40"}`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-xs font-medium leading-tight">{label}</span>
                </button>
              ))}
            </div>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed cursor-pointer transition-all min-h-[160px] ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"} ${preview ? "py-3" : "py-10"}`}
            >
              <input ref={fileRef} type="file" className="hidden" accept="image/*,.pdf"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              {preview
                ? <img src={preview} alt="preview" className="max-h-48 max-w-full rounded-lg object-contain" />
                : <>
                    <Upload className="w-8 h-8 text-muted-foreground/50 mb-2" />
                    <p className="text-sm font-medium">Drop file here or click to upload</p>
                    <p className="text-xs text-muted-foreground mt-1">JPG, PNG, PDF - phone photo works</p>
                  </>
              }
              {file && <p className="text-xs text-muted-foreground mt-2">{file.name}</p>}
            </div>

            <Button variant="outline" className="w-full gap-2 sm:hidden"
              onClick={() => { if (fileRef.current) { fileRef.current.accept = "image/*"; (fileRef.current as any).capture = "environment"; fileRef.current.click(); } }}>
              <Camera className="w-4 h-4" />
              Take photo with camera
            </Button>
          </>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive whitespace-pre-line">
            <AlertCircle className="w-4 h-4 inline mr-2" />{error}
          </div>
        )}

        {file && !result && (
          <Button onClick={handleExtract} disabled={loading} className="w-full min-h-[48px] gap-2 text-base font-semibold">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
            {loading ? "Extracting fields…" : "Extract with AI"}
          </Button>
        )}

        {/* Results: field-by-field verification */}
        {result && !committed && (
          <>
            {/* Summary header */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-foreground">{result.summary}</p>
                <p className="text-xs text-muted-foreground">
                  Overall confidence: {Math.round((result.extracted?.confidence || 0) * 100)}% •{" "}
                  {totalCrossWarnings > 0 && <span className="text-amber-600">{totalCrossWarnings} cross-check warning{totalCrossWarnings > 1 ? "s" : ""} •</span>}{" "}
                  Review each field below
                </p>
              </div>
              <Button variant="ghost" size="sm" className="text-xs gap-1"
                onClick={() => { setResult(null); setFile(null); setPreview(null); }}>
                Try different file
              </Button>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> High confidence</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Verify manually</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Low - must verify</span>
            </div>

            {/* Field rows */}
            <div className="space-y-2">
              {getFieldDefs().map(def => (
                <FieldRow
                  key={def.key}
                  def={def}
                  value={editedFields[def.key]}
                  fieldConf={fieldConf[def.key]}
                  onEdit={handleFieldEdit}
                  crossCheckWarning={getCrossCheckWarning(def)}
                />
              ))}
            </div>

            {/* Image quality issues */}
            {result.imageIssues?.length > 0 && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3">
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-1">Image quality issues detected</p>
                <ul className="space-y-0.5">
                  {result.imageIssues.map((issue: string, i: number) => (
                    <li key={i} className="text-xs text-amber-700 dark:text-amber-400">• {issue}</li>
                  ))}
                </ul>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">For best accuracy: lay document flat on white surface, use rear camera in natural light, ensure all 4 corners are visible.</p>
              </div>
            )}

            {/* Disclaimer */}
            <div className="text-xs text-center text-muted-foreground px-2 leading-relaxed">
              AI is not 100% accurate. The values above are what the AI read - your actual document is the source of truth.
              Edit any field using the Edit button before saving. Tax-critical fields are labeled.
            </div>

            {/* Save button */}
            <Button
              onClick={handleCommit}
              disabled={committing || criticalFieldsMissing > 0}
              className="w-full min-h-[48px] gap-2 text-base font-semibold"
            >
              {committing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              {committing ? "Saving…" : criticalFieldsMissing > 0 ? `${criticalFieldsMissing} required field${criticalFieldsMissing > 1 ? "s" : ""} missing` : "Save Verified Data to WriteOff"}
            </Button>
          </>
        )}

        {committed && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
            <p className="text-base font-semibold">Saved to WriteOff</p>
            <p className="text-sm text-muted-foreground text-center">
              {result?.docType === "w2" ? "W-2 wages and withholding added to your return" :
               result?.docType === "1099" ? "1099 income added to your return" :
               "Earnings added as self-employment income"}
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => { setResult(null); setFile(null); setPreview(null); setCommitted(false); setEditedFields({}); }}>
                Import Another
              </Button>
              {onNavigate && <Button onClick={() => onNavigate("tax-preview")}>View Tax Preview</Button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DocumentImportScreen;
