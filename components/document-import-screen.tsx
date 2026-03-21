"use client";

import React, { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Upload, FileText, CheckCircle2, AlertCircle,
  Loader2, Camera, DollarSign, Building2, Receipt, Info,
} from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

interface Props {
  user: { id: string; email?: string };
  onBack: () => void;
  onNavigate?: (screen: string) => void;
}

type DocType = "auto" | "w2" | "1099" | "platform_summary";

const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0 })}`;

const DOC_TYPES: { value: DocType; label: string; icon: React.ElementType; desc: string }[] = [
  { value: "auto",             label: "Auto-detect",         icon: FileText,   desc: "Let AI identify the document type" },
  { value: "w2",               label: "W-2 Form",            icon: Building2,  desc: "Employer wage and withholding" },
  { value: "1099",             label: "1099 Form",           icon: Receipt,    desc: "1099-NEC, 1099-K, 1099-MISC" },
  { value: "platform_summary", label: "Platform Summary",    icon: DollarSign, desc: "Uber, DoorDash, Etsy, Upwork annual" },
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
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = (f: File) => {
    setFile(f);
    setResult(null);
    setError(null);
    setCommitted(false);
    if (f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const handleExtract = async () => {
    if (!file) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("docType", docType);
      fd.append("taxYear", year);
      fd.append("commit", "false"); // Preview first, commit separately

      const res = await makeAuthenticatedRequest("/api/tax/import-document", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        const errData = data;
        if (errData.tips) setError(`${errData.warning}\n\nTips: ${errData.tips.join(' • ')}`);
        else throw new Error(errData.error || "Extraction failed");
        return;
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to extract document");
    } finally { setLoading(false); }
  };

  const handleCommit = async () => {
    if (!file || !result) return;
    setCommitting(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("docType", result.docType || docType);
      fd.append("taxYear", String(result.taxYear || year));
      fd.append("commit", "true");

      const res = await makeAuthenticatedRequest("/api/tax/import-document", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setCommitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally { setCommitting(false); }
  };

  const ext = result?.extracted;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
          <Button onClick={onBack} variant="ghost" size="icon" className="shrink-0 min-h-[44px] min-w-[44px]">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">Import Tax Document</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Upload a photo or scan — AI extracts the data</p>
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
        {/* Info banner */}
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30 px-4 py-3 text-xs text-blue-800 dark:text-blue-300">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <p>Upload a photo or scan of your W-2, 1099, or platform annual summary. GPT-4o extracts wages, withholding, and income amounts — then you confirm before saving.</p>
        </div>

        {/* Document type selector */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {DOC_TYPES.map(({ value, label, icon: Icon, desc }) => (
            <button
              key={value}
              onClick={() => setDocType(value)}
              className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-all ${
                docType === value
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40"
              }`}
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
          className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed cursor-pointer transition-all min-h-[160px] ${
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
          } ${preview ? "py-3" : "py-10"}`}
        >
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="image/*,.pdf"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          {preview ? (
            <img src={preview} alt="Document preview" className="max-h-48 max-w-full rounded-lg object-contain" />
          ) : (
            <>
              <Upload className="w-8 h-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm font-medium text-foreground">Drop file here or click to upload</p>
              <p className="text-xs text-muted-foreground mt-1">JPG, PNG, PDF — phone photo works great</p>
            </>
          )}
          {file && <p className="text-xs text-muted-foreground mt-2">{file.name}</p>}
        </div>

        {/* Camera shortcut on mobile */}
        <Button
          variant="outline"
          onClick={() => { if (fileRef.current) { fileRef.current.accept = "image/*"; fileRef.current.capture = "environment"; fileRef.current.click(); } }}
          className="w-full gap-2 sm:hidden"
        >
          <Camera className="w-4 h-4" />
          Take a photo with camera
        </Button>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {file && !result && (
          <Button onClick={handleExtract} disabled={loading} className="w-full min-h-[48px] gap-2 text-base font-semibold">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
            {loading ? "Extracting data…" : "Extract Data with AI"}
          </Button>
        )}

        {/* Results */}
        {result && ext && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                Extracted — {result.summary}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Confidence: {Math.round((ext.confidence || 0) * 100)}% — verify before saving
              </p>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              {/* W-2 fields */}
              {(result.docType === "w2" || ext.box1Wages !== undefined) && [
                { label: "Employer", value: ext.employerName },
                { label: "EIN", value: ext.employerEIN },
                { label: "Box 1 — Wages", value: ext.box1Wages != null ? fmt(ext.box1Wages) : null },
                { label: "Box 2 — Federal Withheld", value: ext.box2FederalWithheld != null ? fmt(ext.box2FederalWithheld) : null },
                { label: "Box 3 — SS Wages", value: ext.box3SocialSecurityWages != null ? fmt(ext.box3SocialSecurityWages) : null },
                { label: "Box 4 — SS Withheld", value: ext.box4SocialSecurityWithheld != null ? fmt(ext.box4SocialSecurityWithheld) : null },
                { label: "Box 16 — State Wages", value: ext.box16StateWages != null ? fmt(ext.box16StateWages) : null },
                { label: "Box 17 — State Withheld", value: ext.box17StateWithheld != null ? fmt(ext.box17StateWithheld) : null },
                { label: "State", value: ext.state },
              ].filter(f => f.value).map(({ label, value }) => (
                <div key={label} className="flex justify-between py-1 border-b border-border/50 last:border-0">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="text-xs font-medium">{value}</span>
                </div>
              ))}
              {/* 1099 fields */}
              {(result.docType === "1099" || ext.formVariant) && [
                { label: "Form Type", value: `1099-${ext.formVariant || "NEC"}` },
                { label: "Payer", value: ext.payerName },
                { label: "Amount", value: ext.grossAmount != null ? fmt(ext.grossAmount) : ext.box1Amount != null ? fmt(ext.box1Amount) : null },
                { label: "Federal Withheld", value: (ext.box4FederalWithheld || ext.box2FederalWithheld) != null ? fmt(ext.box4FederalWithheld || ext.box2FederalWithheld) : null },
              ].filter(f => f.value).map(({ label, value }) => (
                <div key={label} className="flex justify-between py-1 border-b border-border/50 last:border-0">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="text-xs font-medium">{value}</span>
                </div>
              ))}
              {/* Platform fields */}
              {(result.docType === "platform_summary" || ext.grossEarnings !== undefined) && [
                { label: "Platform", value: ext.platform },
                { label: "Gross Earnings", value: ext.grossEarnings != null ? fmt(ext.grossEarnings) : null },
                { label: "Platform Fees", value: ext.platformFees != null ? fmt(ext.platformFees) : null },
                { label: "Net Earnings", value: ext.netEarnings != null ? fmt(ext.netEarnings) : null },
                { label: "Miles Driven", value: ext.milesDriven != null ? `${ext.milesDriven.toLocaleString()} mi` : null },
                { label: "1099-K Amount", value: ext.form1099KAmount != null ? fmt(ext.form1099KAmount) : null },
                { label: "1099-NEC Amount", value: ext.form1099NECAmount != null ? fmt(ext.form1099NECAmount) : null },
              ].filter(f => f.value).map(({ label, value }) => (
                <div key={label} className="flex justify-between py-1 border-b border-border/50 last:border-0">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="text-xs font-medium">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {result && !committed && (
          <>
            {/* Verification warnings — shown BEFORE save button */}
            {(result.verificationRequired?.length > 0 || result.imageIssues?.length > 0) && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/30 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Verify before saving</p>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Check each item below against your actual document. Errors on a tax return can trigger IRS notices.
                </p>
                <ul className="space-y-1">
                  {[...(result.verificationRequired || []), ...(result.imageIssues || [])].map((w: string, i: number) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                      <span className="mt-0.5 shrink-0">•</span>{w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Accuracy disclaimer */}
            <div className="text-xs text-muted-foreground text-center px-2">
              AI extraction is not 100% accurate. Always compare extracted values to your original document before saving.
              Dollar amounts on the form are what matter — not the AI's interpretation.
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => { setResult(null); setFile(null); setPreview(null); }} className="flex-1">
                Try Again
              </Button>
              <Button onClick={handleCommit} disabled={committing} className="flex-1 gap-2 font-semibold">
                {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {committing ? "Saving…" : "Save to WriteOff"}
              </Button>
            </div>
          </>
        )}

        {committed && (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
            <p className="text-base font-semibold text-foreground">Saved successfully</p>
            <p className="text-sm text-muted-foreground text-center">
              {result?.docType === "w2" ? "W-2 added to your income" : result?.docType === "1099" ? "1099 added to your income" : "Earnings added as income"}
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => { setResult(null); setFile(null); setPreview(null); setCommitted(false); }}>
                Import Another
              </Button>
              {onNavigate && (
                <Button onClick={() => onNavigate("tax-preview")}>
                  View Tax Preview
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DocumentImportScreen;
