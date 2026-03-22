'use client';

import React, { useState, useRef } from 'react';
import {
  Building2, FileText, PenLine, ArrowLeft, ArrowRight, Upload,
  CheckCircle2, Loader2, AlertCircle, ChevronRight, X, Info,
  CreditCard, Receipt, FileSpreadsheet, Banknote
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';

interface DataSourceScreenProps {
  user: any;
  onConnectBank: () => void;     // Go to Plaid flow
  onSkipToApp: () => void;       // Skip everything, go to dashboard
  onBack: () => void;
}

type DataSource = 'bank' | 'upload' | 'manual' | null;
type UploadState = 'idle' | 'uploading' | 'success' | 'error';

interface UploadedFile {
  name: string;
  type: string;
  result?: {
    transactionsImported?: number;
    bankName?: string;
    message?: string;
    docType?: string;
    merchant?: string;
    amount?: number;
    redirect?: boolean;
  };
  error?: string;
}

const SUPPORTED_PDF_TYPES = [
  {
    icon: '🏦',
    title: 'Bank Statements',
    desc: 'Chase, Bank of America, Wells Fargo, etc.',
    examples: 'Monthly or quarterly PDF statements',
    color: 'blue',
  },
  {
    icon: '💳',
    title: 'Credit Card Statements',
    desc: 'Visa, Mastercard, Amex, Discover',
    examples: 'Any credit card monthly statement',
    color: 'purple',
  },
  {
    icon: '🧾',
    title: 'Receipts & Invoices',
    desc: 'Photos or PDFs of business receipts',
    examples: 'Restaurant, supplies, subscriptions',
    color: 'emerald',
  },
  {
    icon: '📊',
    title: 'Expense Reports',
    desc: 'Spreadsheet exports or PDF summaries',
    examples: 'Expense tracker exports',
    color: 'orange',
  },
];

const MANUAL_TIPS = [
  { icon: '📅', text: 'Enter transactions one at a time or in bulk' },
  { icon: '📸', text: 'Upload receipt photos to auto-fill details' },
  { icon: '🤖', text: 'AI will suggest which expenses are deductible' },
  { icon: '📤', text: 'You can connect your bank anytime later in Settings' },
];

export function DataSourceScreen({ user, onConnectBank, onSkipToApp, onBack }: DataSourceScreenProps) {
  const [selected, setSelected] = useState<DataSource>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [currentYear] = useState(new Date().getFullYear());
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('docType', 'auto');
    fd.append('year', String(currentYear));

    setUploadState('uploading');
    try {
      const res = await makeAuthenticatedRequest('/api/tax/import-bank-statement', {
        method: 'POST',
        body: fd,
      });

      const data = await res.json();
      const uploaded: UploadedFile = { name: file.name, type: file.type, result: data };

      // If GPT detected it's a tax form, redirect to doc import
      if (data.redirect) {
        uploaded.error = data.message;
      }

      setUploadedFiles(prev => [...prev, uploaded]);
      setUploadState('success');
    } catch (err: any) {
      setUploadedFiles(prev => [...prev, { name: file.name, type: file.type, error: err.message || 'Upload failed' }]);
      setUploadState('error');
    }
  }

  function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const valid = arr.filter(f =>
      f.type.startsWith('image/') ||
      f.type === 'application/pdf' ||
      f.name.endsWith('.pdf')
    );
    if (valid.length === 0) return;
    valid.forEach(uploadFile);
  }

  const totalImported = uploadedFiles.reduce((sum, f) => sum + (f.result?.transactionsImported || 0), 0);
  const hasSuccessfulUploads = uploadedFiles.some(f => (f.result?.transactionsImported || 0) > 0);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="bg-background/80 backdrop-blur-sm border-b border-border z-50 shadow-sm flex-shrink-0">
        <div className="flex items-center justify-between px-4 py-3 max-w-xl mx-auto">
          <button
            onClick={selected ? () => setSelected(null) : onBack}
            className="w-9 h-9 bg-card border border-border rounded-xl flex items-center justify-center text-foreground hover:bg-muted transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">W</span>
            </div>
            <span className="font-bold text-foreground">WriteOff</span>
          </div>
          <button
            onClick={onSkipToApp}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
          >
            Skip
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="flex-shrink-0 px-4 pt-4 pb-2 max-w-xl mx-auto w-full">
        <div className="flex items-center gap-2 justify-center mb-1">
          {['Profile', 'Data'].map((label, i) => (
            <React.Fragment key={label}>
              <div className="flex items-center gap-1.5">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i < 2 ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}>
                  {i + 1}
                </div>
                <span className={`text-xs font-medium ${i < 2 ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
              </div>
              {i < 1 && <div className="w-8 h-px bg-primary/40" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-2 max-w-xl mx-auto w-full">

        {/* ── SELECTION SCREEN ── */}
        {!selected && (
          <div className="space-y-4">
            <div className="text-center py-2">
              <h1 className="text-xl font-bold text-foreground">How do you want to add your data?</h1>
              <p className="text-sm text-muted-foreground mt-1.5">
                Choose the option that works best for you. You can always add more later.
              </p>
            </div>

            {/* Option 1: Connect Bank */}
            <button
              type="button"
              onClick={() => setSelected('bank')}
              className="w-full text-left rounded-2xl border-2 border-primary/20 hover:border-primary/50 bg-gradient-to-br from-blue-50/50 to-blue-100/30 dark:from-blue-950/30 dark:to-blue-900/20 p-4 transition-all hover:shadow-md group"
            >
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-foreground">Connect Bank Account</span>
                    <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded-full font-medium">Recommended</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Automatically imports all transactions. AI categorizes them and flags deductibles.</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {['Chase', 'Bank of America', 'Wells Fargo', 'Citi', '12,000+ banks'].map(bank => (
                      <span key={bank} className="text-xs bg-background/80 border border-border px-1.5 py-0.5 rounded text-muted-foreground">{bank}</span>
                    ))}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-primary transition-colors" />
              </div>
            </button>

            {/* Option 2: Upload PDFs */}
            <button
              type="button"
              onClick={() => setSelected('upload')}
              className="w-full text-left rounded-2xl border-2 border-border hover:border-primary/40 bg-card p-4 transition-all hover:shadow-sm group"
            >
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-foreground block mb-0.5">Upload Bank Statements or Receipts</span>
                  <p className="text-xs text-muted-foreground">Upload PDF statements, receipt photos, or expense reports. AI reads and imports all transactions.</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {['Bank statements', 'Credit card PDFs', 'Receipt photos', 'Expense reports'].map(t => (
                      <span key={t} className="text-xs bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 rounded text-emerald-700 dark:text-emerald-400">{t}</span>
                    ))}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-primary transition-colors" />
              </div>
            </button>

            {/* Option 3: Manual Entry */}
            <button
              type="button"
              onClick={() => setSelected('manual')}
              className="w-full text-left rounded-2xl border-2 border-border hover:border-primary/40 bg-card p-4 transition-all hover:shadow-sm group"
            >
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-violet-600 flex items-center justify-center shrink-0">
                  <PenLine className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-foreground block mb-0.5">Enter Manually</span>
                  <p className="text-xs text-muted-foreground">Type in your income and expenses one by one. Best for people with fewer transactions.</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {['Add income', 'Log expenses', 'Full privacy', 'No bank required'].map(t => (
                      <span key={t} className="text-xs bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 px-1.5 py-0.5 rounded text-violet-700 dark:text-violet-400">{t}</span>
                    ))}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-primary transition-colors" />
              </div>
            </button>

            {/* Privacy note */}
            <div className="flex items-start gap-2 px-1 py-2">
              <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                WriteOff never sells your financial data. Bank connections use Plaid with 256-bit encryption. You can disconnect anytime.
              </p>
            </div>
          </div>
        )}

        {/* ── BANK CONNECT DETAIL ── */}
        {selected === 'bank' && (
          <div className="space-y-4 py-2">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-3">
                <Building2 className="w-7 h-7 text-white" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Connect Your Bank</h2>
              <p className="text-sm text-muted-foreground mt-1">Securely import up to 2 years of transactions in minutes</p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              {[
                { icon: '⚡', label: 'Instant import', desc: 'All transactions pulled automatically' },
                { icon: '🤖', label: 'AI categorization', desc: 'Every expense analyzed for deductibility' },
                { icon: '🔒', label: 'Bank-level security', desc: 'Read-only access via Plaid  -  WriteOff cannot move money' },
                { icon: '🔌', label: 'Disconnect anytime', desc: 'Revoke access in Settings at any time' },
              ].map(item => (
                <div key={item.label} className="flex items-start gap-3">
                  <span className="text-base w-5 shrink-0">{item.icon}</span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <Button
              onClick={onConnectBank}
              className="w-full h-12 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Building2 className="w-4 h-4 mr-2" />
              Connect Bank with Plaid
              <ArrowRight className="w-4 h-4 ml-auto" />
            </Button>

            <button
              onClick={() => setSelected(null)}
              className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-1 transition-colors"
            >
              Choose a different method
            </button>
          </div>
        )}

        {/* ── PDF UPLOAD DETAIL ── */}
        {selected === 'upload' && (
          <div className="space-y-4 py-2">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center mx-auto mb-3">
                <Upload className="w-7 h-7 text-white" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Upload Your Documents</h2>
              <p className="text-sm text-muted-foreground mt-1">AI reads your statements and imports all transactions</p>
            </div>

            {/* What works */}
            <div className="grid grid-cols-2 gap-2">
              {SUPPORTED_PDF_TYPES.map(item => (
                <div key={item.title} className="rounded-xl border border-border bg-card p-3">
                  <div className="text-xl mb-1">{item.icon}</div>
                  <p className="text-xs font-semibold text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                  <p className="text-xs text-muted-foreground/70 mt-0.5 italic">{item.examples}</p>
                </div>
              ))}
            </div>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
              className={`rounded-xl border-2 border-dashed p-6 text-center transition-all cursor-pointer ${
                dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,image/*"
                className="hidden"
                onChange={e => e.target.files && handleFiles(e.target.files)}
              />
              {uploadState === 'uploading' ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">Reading document with AI...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                    <Upload className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground">Drop files here or tap to upload</p>
                  <p className="text-xs text-muted-foreground">PDF, JPG, PNG  -  bank statements, credit card statements, receipts</p>
                </div>
              )}
            </div>

            {/* Upload results */}
            {uploadedFiles.length > 0 && (
              <div className="space-y-2">
                {uploadedFiles.map((f, i) => (
                  <div key={i} className={`rounded-xl border p-3 flex items-start gap-3 ${
                    f.error ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20' :
                    'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20'
                  }`}>
                    {f.error ? (
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{f.name}</p>
                      {f.error ? (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{f.error}</p>
                      ) : (
                        <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                          {f.result?.transactionsImported
                            ? `${f.result.transactionsImported} transactions imported from ${f.result.bankName || 'statement'}`
                            : f.result?.merchant
                            ? `Receipt: ${f.result.merchant}  -  $${f.result.amount}`
                            : f.result?.message || 'Processed successfully'}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Proceed */}
            <div className="space-y-2 pb-2">
              {hasSuccessfulUploads && (
                <Button
                  onClick={onSkipToApp}
                  className="w-full h-12 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Continue with {totalImported} imported transactions
                  <ArrowRight className="w-4 h-4 ml-auto" />
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-10 text-sm"
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload more documents
              </Button>
              <button
                onClick={onSkipToApp}
                className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-1.5 transition-colors"
              >
                {hasSuccessfulUploads ? 'Continue to dashboard' : 'Skip for now  -  I\'ll add data later'}
              </button>
            </div>
          </div>
        )}

        {/* ── MANUAL ENTRY DETAIL ── */}
        {selected === 'manual' && (
          <div className="space-y-4 py-2">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-violet-600 flex items-center justify-center mx-auto mb-3">
                <PenLine className="w-7 h-7 text-white" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Manual Entry</h2>
              <p className="text-sm text-muted-foreground mt-1">You're in full control  -  add what you need, when you need it</p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              {MANUAL_TIPS.map(tip => (
                <div key={tip.text} className="flex items-start gap-3">
                  <span className="text-base w-5 shrink-0">{tip.icon}</span>
                  <p className="text-sm text-foreground">{tip.text}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-3">
              <p className="text-xs text-blue-800 dark:text-blue-300">
                <span className="font-semibold">Tip:</span> You can connect your bank account or upload statements anytime  -  just go to Settings → Connect Bank. Many users start manual and connect later.
              </p>
            </div>

            {/* Quick action cards */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: Banknote, label: 'Add Income', sub: '1099, freelance, sales', screen: 'income-tracking', color: 'emerald' },
                { icon: Receipt, label: 'Add Expense', sub: 'Business purchases', screen: 'add-manual-transaction', color: 'blue' },
                { icon: FileSpreadsheet, label: 'Tax Organizer', sub: 'W-2, investments, SSN', screen: 'tax-organizer', color: 'violet' },
                { icon: CreditCard, label: 'Import Document', sub: 'W-2, 1099 forms', screen: 'document-import', color: 'orange' },
              ].map(({ icon: Icon, label, sub, color }) => (
                <div key={label} className="rounded-xl border border-border bg-card p-3 flex items-start gap-2">
                  <div className={`w-8 h-8 rounded-lg bg-${color}-100 dark:bg-${color}-950/30 flex items-center justify-center shrink-0`}>
                    <Icon className={`w-4 h-4 text-${color}-600 dark:text-${color}-400`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">{label}</p>
                    <p className="text-xs text-muted-foreground">{sub}</p>
                  </div>
                </div>
              ))}
            </div>

            <Button
              onClick={onSkipToApp}
              className="w-full h-12 text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white"
            >
              <PenLine className="w-4 h-4 mr-2" />
              Go to Dashboard  -  I'll add data manually
              <ArrowRight className="w-4 h-4 ml-auto" />
            </Button>
            <button
              onClick={() => setSelected(null)}
              className="w-full text-xs text-muted-foreground hover:text-foreground text-center py-1 transition-colors"
            >
              Back to options
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
