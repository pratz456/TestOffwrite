"use client";

import { formatTransactionDate } from '@/lib/transactions/calendar-date';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToasts } from '@/components/ui/toast';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ReceiptPreview } from '@/components/receipt-preview';
import { auth, localEmulatorConfig } from '@/lib/firebase/client';
import { consolidateCategory } from '@/lib/utils';
import { getTransactionId } from '@/lib/utils/transaction-id';
import { protectedScreenUrl } from '@/lib/navigation/protected-screens';
import { useUpdateTransaction } from '@/lib/firebase/mutations';
import { attachCaptureVideo, createMediaCapture } from '@/lib/browser/media-capture';
// Using API route instead of direct database access
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Bot,
  AlertTriangle,
  Building2,
  User,
  Upload,
  FileText,
  Trash2,
  Camera
} from 'lucide-react';

interface TransactionDetailScreenProps {
  transaction: {
    id: string;
    merchant_name: string;
    amount: number;
    date: string;
    datetime?: string; // Full datetime from Plaid (ISO format)
    category: string;
    description?: string;
    notes?: string;
    is_deductible?: boolean | null;
    expense_type?: 'business' | 'personal'; // Explicit classification from AI or user
    deductible_reason?: string;
    deduction_score?: number;
    ai_analysis?: string; // Original AI analysis text - never overwritten
    user_classification_reason?: string; // User's reason for classification
    receipt_url?: string; // URL to uploaded receipt image
    receipt_filename?: string; // Original filename of the receipt
    trans_id?: string; // Transaction ID from Plaid
    account_id?: string; // Account ID
    
    // Transaction-Specific Context Fields
    business_purpose?: string; // Why this expense was necessary for business
    attendees?: string[]; // For meal expenses - who attended
    travel_destination?: string; // For travel expenses - where and why
    equipment_details?: {
      make?: string;
      model?: string;
      year?: number;
      business_use_percentage?: number;
      depreciation_method?: 'straight_line' | 'declining_balance' | 'section_179';
    };
    client_project?: string; // Associated client or project name
    documentation_status?: 'complete' | 'partial' | 'missing'; // Receipt/documentation status
    meeting_notes?: string; // Notes about business meetings or discussions
    mileage_details?: {
      start_location?: string;
      end_location?: string;
      miles?: number;
      business_purpose?: string;
    };

    // Location fields from Plaid
    location?: { city?: string; state?: string; address?: string; lat?: number; lon?: number };
    city?: string;
    state?: string;

    // AI Analysis Fields from initial analysis
    ai?: {
      status_label?: string;
      score_pct?: number;
      reasoning?: string;
      irs?: { publication?: string; section?: string };
      required_docs?: string[];
      category_hint?: string;
      risk_flags?: string[];
      model?: string;
      last_analyzed_at?: number;
      key_analysis_factors?: {
        business_purpose?: string;
        ordinary_necessary?: string;
        documentation_required?: string[];
        audit_risk?: 'Low' | 'Medium' | 'High';
        specific_rules?: string[];
        limitations?: string[];
        deduction_status?: 'Likely Deductible' | 'Possibly Deductible' | 'Unlikely Deductible' | 'Income';
        deduction_percentage?: number;
        reasoning_summary?: string;
        irs_reference?: string;
      };
    } | null;

    // New AI Analysis Fields (for re-run analysis)
    deductionStatus?: 'Likely Deductible' | 'Possibly Deductible' | 'Non-Deductible';
    confidence?: number; // 0-1 confidence score
    reasoning?: string; // Short IRS-aligned explanation (≤280 chars)
    irsPublication?: string; // IRS publication reference
    irsSection?: string; // IRS section reference
    analysisUpdatedAt?: string; // When the analysis was last updated
  };
  onBack: () => void;
  onSave: (updatedTransaction: any) => void;
}

export const TransactionDetailScreen: React.FC<TransactionDetailScreenProps> = ({
  transaction,
  onBack,
  onSave
}) => {
  // Router hook (top-level hook call)
  const router = useRouter();

  // State for unsaved changes confirmation dialog
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  const performBackNavigation = () => {
    onBack && onBack();
    setTimeout(() => {
      try {
        router.back();
      } catch (e) {
        try { router.push('/protected'); } catch (e) { window.location.href = '/protected'; }
      }
    }, 60);
  };

  const handleBackNavigation = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      performBackNavigation();
    }
  };
  // Initialize classification from expense_type (AI classification) or fall back to is_deductible
  const getInitialClassification = (): 'business' | 'personal' | null => {
    // Prefer explicit expense_type from AI analysis
    if (transaction.expense_type) {
      return transaction.expense_type;
    }
    // Fall back to is_deductible if expense_type not available
    if (typeof transaction.is_deductible !== 'boolean') {
      return null; // No default for needs review items - user must choose
    }
    return transaction.is_deductible ? 'business' : 'personal';
  };

  const [classification, setClassification] = useState<'business' | 'personal' | null>(
    getInitialClassification()
  );
  const [additionalContext, setAdditionalContext] = useState(transaction.notes || '');
  const [businessPurpose, setBusinessPurpose] = useState(transaction.business_purpose || '');
  const [clientProject, setClientProject] = useState(transaction.client_project || '');
  const [documentationStatus, setDocumentationStatus] = useState<'complete' | 'partial' | 'missing'>(
    transaction.documentation_status || 'missing'
  );
  const [meetingNotes, setMeetingNotes] = useState(transaction.meeting_notes || '');
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const cameraCapture = useRef(createMediaCapture(constraints => navigator.mediaDevices.getUserMedia(constraints)));
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Debounced save for context fields
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // AI Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Get current user for optimistic updates
  const currentUser = auth.currentUser;
  const userId = currentUser?.uid;

  // AI runs only after an explicit click, independently of record saves.
  // The isolated demo deliberately has no external provider credentials.
  const isLocalPreview = Boolean(localEmulatorConfig);
  const isAnalyzingRef = useRef(false);
  const [analysisUnavailable, setAnalysisUnavailable] = useState(isLocalPreview);

  useEffect(() => {
    setAnalysisError(null);
    setAnalysisUnavailable(isLocalPreview);
  }, [userId, transaction.id, isLocalPreview]);

  // Use React Query mutation with optimistic updates for instant UI feedback
  const updateTransactionMutation = useUpdateTransaction();
  const { showSuccess, showError } = useToasts();

  // Update local state when transaction prop changes
  useEffect(() => {
    setClassification(getInitialClassification());
    setAdditionalContext(transaction.notes || '');
    setBusinessPurpose(transaction.business_purpose || '');
    setClientProject(transaction.client_project || '');
    setDocumentationStatus(transaction.documentation_status || 'missing');
    setMeetingNotes(transaction.meeting_notes || '');
  }, [transaction]);

  // Check if currently saving
  const isSaving = updateTransactionMutation.isPending;

  // Debounced save function
  const debouncedSave = useCallback((updates: Record<string, any>) => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(async () => {
      if (!userId) return;
      
      try {
        await updateTransactionMutation.mutateAsync({
          transactionId: getTransactionId(transaction),
          userId,
          updates
        });
      } catch (error) {
        console.error('Error saving context field:', error);
      }
    }, 500);
  }, [userId, transaction.trans_id, transaction.id, updateTransactionMutation]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  // Handle classification change (but don't auto-save)
  const handleClassificationChange = (newClassification: 'business' | 'personal') => {
    setClassification(newClassification);
  };

  // Handle manual save of all changes
  const handleSaveChanges = async () => {
    if (!userId) {
      showError('Authentication Error', 'Please sign in to save changes');
      return;
    }

    if (classification === null) {
      showError('Classification Required', 'Please select whether this is a business or personal expense');
      return;
    }

    const updates = {
      is_deductible: classification === 'business',
      expense_type: classification, // Store explicit classification
      user_classification_reason: classification === 'business'
        ? (additionalContext || 'Classified as business expense by user')
        : 'Classified as personal expense by user',
      notes: additionalContext || undefined
    };

    const transactionId = getTransactionId(transaction);

    try {
      // Use React Query mutation with optimistic updates for instant UI feedback
      await updateTransactionMutation.mutateAsync({
        transactionId,
        userId,
        updates
      });

      showSuccess('Changes Saved', 'Transaction updated successfully');

      // Call onSave callback for parent component to update local state
      const updatedTransaction = {
        ...transaction,
        is_deductible: updates.is_deductible,
        user_classification_reason: updates.user_classification_reason,
        notes: updates.notes || undefined,
      };

      await onSave(updatedTransaction);

    } catch (error) {
      console.error('Error updating transaction:', error);
      showError('Update Failed', 'Failed to save changes. Please try again.');
    }
  };

  // Handle receipt file selection
  const handleReceiptFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        showError('Invalid File Type', 'Please upload an image (JPG, PNG, GIF) or PDF file');
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        showError('File Too Large', 'Please upload a file smaller than 10MB');
        return;
      }

      setReceiptFile(file);
    }
  };

  // Start camera
  const startCamera = async () => {
    try {
      const stream = await cameraCapture.current.start({
        video: {
          facingMode: 'environment', // Use back camera on mobile
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      if (!stream) return;
      setCameraStream(stream);
      setShowCamera(true);
    } catch (error) {
      cameraCapture.current.stop();
      setCameraStream(null);
      setShowCamera(false);
      console.error('Error accessing camera:', error);
      showError('Camera Access Denied', 'Please allow camera access to take photos');
    }
  };

  // Stop camera
  const stopCamera = () => {
    cameraCapture.current.stop();
    setCameraStream(null);
    setShowCamera(false);
  };

  // Take photo
  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      if (!video.videoWidth || !video.videoHeight) {
        showError('Camera Starting', 'Wait for the camera preview before taking a photo.');
        return;
      }

      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0);

        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' });
            setReceiptFile(file);
            stopCamera();
          }
        }, 'image/jpeg', 0.8);
      }
    }
  };

  // The video exists only after showCamera is committed to the DOM.
  useEffect(() => {
    if (showCamera && cameraStream && videoRef.current) return attachCaptureVideo(videoRef.current, cameraStream);
  }, [showCamera, cameraStream]);

  useEffect(() => {
    const capture = cameraCapture.current;
    return () => capture.stop();
  }, []);

  // Handle receipt upload
  const handleReceiptUpload = async () => {
    if (!receiptFile || !userId) return;

    setIsUploadingReceipt(true);

    try {
      const formData = new FormData();
      formData.append('file', receiptFile);
      formData.append('transactionId', getTransactionId(transaction));
      formData.append('userId', userId);

      const response = await fetch('/api/upload-receipt', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload receipt');
      }

      const result = await response.json();

      // Update the transaction with receipt info
      const updates = {
        receipt_url: result.receiptUrl,
        receipt_filename: receiptFile.name
      };

      await updateTransactionMutation.mutateAsync({
        transactionId: getTransactionId(transaction),
        userId,
        updates
      });

      showSuccess('Receipt Uploaded', 'Receipt has been successfully uploaded and attached to this transaction');

      // Update local state
      const updatedTransaction = {
        ...transaction,
        receipt_url: result.receiptUrl,
        receipt_filename: receiptFile.name,
      };

      await onSave(updatedTransaction);
      setReceiptFile(null);

    } catch (error) {
      console.error('Error uploading receipt:', error);
      showError('Upload Failed', 'Failed to upload receipt. Please try again.');
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  // Handle receipt deletion
  const handleReceiptDelete = async () => {
    if (!userId) return;

    try {
      const updates: { receipt_url?: string; receipt_filename?: string } = {
        receipt_url: '',
        receipt_filename: ''
      };

      await updateTransactionMutation.mutateAsync({
        transactionId: getTransactionId(transaction),
        userId,
        updates
      });

      showSuccess('Receipt Deleted', 'Receipt has been removed from this transaction');

      // Update local state
      const updatedTransaction = {
        ...transaction,
        receipt_url: undefined,
        receipt_filename: undefined,
      };

      await onSave(updatedTransaction);

    } catch (error) {
      console.error('Error deleting receipt:', error);
      showError('Delete Failed', 'Failed to delete receipt. Please try again.');
    }
  };

  // Handle AI Analysis
  const handleAnalyzeTransaction = async () => {
    if (isLocalPreview || isAnalyzingRef.current || analysisUnavailable) return;
    if (!userId || !currentUser) {
      showError('Authentication Error', 'Please log in to analyze transactions');
      return;
    }

    isAnalyzingRef.current = true;
    setIsAnalyzing(true);
    setAnalysisError(null);
    let unavailable = false;

    try {
      // Get the current user's ID token for authentication
      const token = await currentUser.getIdToken();

      const transactionId = getTransactionId(transaction);
      const trimmedAdditionalContext = (additionalContext || '').trim();
      const trimmedBusinessPurpose = (businessPurpose || '').trim();
      const trimmedClientProject = (clientProject || '').trim();
      const trimmedMeetingNotes = (meetingNotes || '').trim();

      const response = await fetch('/api/ai/analyze-transaction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          transactionId: transactionId,
          transaction: {
            merchant_name: transaction.merchant_name,
            amount: transaction.amount,
            category: transaction.category,
            date: transaction.date,
            datetime: transaction.datetime, // Include datetime from Plaid
            account_id: transaction.account_id,
            description: transaction.description,

            // Prefer user-added context over original description.
            notes: trimmedAdditionalContext || undefined,

            // User-added transaction context fields (saved via debouncedSave).
            business_purpose: trimmedBusinessPurpose || undefined,
            client_project: trimmedClientProject || undefined,
            documentation_status: documentationStatus || undefined,
            meeting_notes: trimmedMeetingNotes || undefined,

            // Forward any additional context already present on the transaction record.
            attendees: transaction.attendees,
            travel_destination: transaction.travel_destination,
            equipment_details: transaction.equipment_details,
            mileage_details: transaction.mileage_details,
            city: transaction.location?.city || transaction.city,
            state: transaction.location?.state || transaction.state,
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const errorData = errorBody && typeof errorBody === 'object' ? errorBody : {};
        const providerMessage = [errorData.error, errorData.code, errorData.details, errorData.details?.code]
          .filter(value => typeof value === 'string').join(' ');
        unavailable = response.status === 503 || /AI_(?:SERVICE_)?UNAVAILABLE|insufficient_quota|credit_balance_exhausted|OpenAI.*not configured|exceeded.*quota/i.test(providerMessage);
        throw new Error(unavailable
          ? 'AI analysis is unavailable. You can still edit notes, attach receipts and record your classification manually. No new AI assessment is available here.'
          : response.status === 429
            ? 'The AI request limit was reached. Continue reviewing manually; no new AI assessment is available here.'
            : response.status >= 500
              ? 'AI analysis could not complete. Continue reviewing this transaction manually.'
              : errorData.error || 'AI analysis could not complete. Continue reviewing this transaction manually.');
      }

      const result = await response.json();

      if (result.success) {
        showSuccess('Analysis Saved', 'An AI suggestion is available for your review; it does not establish tax eligibility.');

        // Update the transaction with new analysis data (flat fields are authoritative after re-run).
        const newReasoning = result.analysis.reasoning;
        const newStatus = result.analysis.deductionStatus;
        const updatedTransaction = {
          ...transaction,
          notes: trimmedAdditionalContext || undefined,
          business_purpose: trimmedBusinessPurpose || undefined,
          client_project: trimmedClientProject || undefined,
          documentation_status: documentationStatus || undefined,
          meeting_notes: trimmedMeetingNotes || undefined,

          deductionStatus: newStatus,
          confidence: result.analysis.confidence,
          reasoning: newReasoning,
          irsPublication: result.analysis.irsReference?.publication,
          irsSection: result.analysis.irsReference?.section,
          analysisUpdatedAt: result.analysis.updatedAt,
          // Keep nested `ai` in sync so list/detail views that read key_analysis_factors see fresh text.
          ai: transaction.ai
            ? {
                ...transaction.ai,
                key_analysis_factors: {
                  ...transaction.ai.key_analysis_factors,
                  reasoning_summary: newReasoning,
                },
                last_analyzed_at: result.analysis.updatedAt
                  ? new Date(result.analysis.updatedAt).getTime()
                  : transaction.ai.last_analyzed_at,
              }
            : transaction.ai,
        };

        onSave(updatedTransaction);
      } else {
        throw new Error(result.error || 'Analysis failed');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'AI analysis could not complete. Continue reviewing manually.';
      setAnalysisError(errorMessage);
      setAnalysisUnavailable(unavailable);
      showError(unavailable ? 'AI unavailable' : 'Analysis incomplete', errorMessage);
    } finally {
      isAnalyzingRef.current = false;
      setIsAnalyzing(false);
    }
  };

  // Check if there are unsaved changes
  const hasUnsavedChanges =
    classification !== getInitialClassification() ||
    additionalContext !== (transaction.notes || '') ||
    receiptFile !== null;

  // Legible category badge colors (matches transactions list)
  const getCategoryBadgeClass = (category: string) => {
    const { consolidatedName } = consolidateCategory(category);
    const map: Record<string, string> = {
      FOOD_AND_DRINK: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-600',
      TRANSPORTATION: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border-blue-300 dark:border-blue-600',
      TRAVEL: 'bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200 border-violet-300 dark:border-violet-600',
      ENTERTAINMENT: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-600',
      PROFESSIONAL_SERVICES: 'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200 border-teal-300 dark:border-teal-600',
      OFFICE_AND_EQUIPMENT: 'bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200 border-sky-300 dark:border-sky-600',
      LOAN_AND_FINANCIAL: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 border-red-300 dark:border-red-600',
      GENERAL_MERCHANDISE: 'bg-slate-100 dark:bg-slate-700/50 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600',
      INCOME: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border-green-300 dark:border-green-600',
    };
    return map[consolidatedName] || 'bg-muted/50 dark:bg-muted/30 text-foreground border-border';
  };





  return (
    <div className="min-h-screen bg-background safe-area-inset-top safe-area-inset-bottom">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-50 shadow-sm">
        <div className="flex items-center justify-between p-4 sm:p-6">
          <button
            onClick={handleBackNavigation}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center text-foreground border border-border bg-muted/50 hover:bg-muted transition-colors no-tap-highlight"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="text-center flex-1 px-2">
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">
              Transaction Details
            </h1>
            {hasUnsavedChanges && (
              <div className="flex items-center justify-center gap-2 text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-600/50 rounded-lg px-2 sm:px-3 py-1 mt-2">
                <AlertTriangle className="w-3 h-3" />
                <span className="text-xs font-medium">Unsaved</span>
              </div>
            )}
            {isSaving && (
              <div className="flex items-center justify-center gap-2 text-sm text-green-600 dark:text-green-400 mt-2">
                <div className="w-3 h-3 border-2 border-green-600 dark:border-green-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs sm:text-sm">Saving...</span>
              </div>
            )}
          </div>
          <div className="w-11 sm:w-12"></div>
        </div>
      </header>

      <div className="p-3 sm:p-4 max-w-6xl mx-auto pb-8">
        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left Column - Transaction Info & AI Analysis */}
          <div className="lg:col-span-2 space-y-4">
            {/* Transaction Header Card */}
            <Card className="p-4 sm:p-5 bg-card border border-border rounded-xl shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-3">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center flex-shrink-0 bg-green-600/15 dark:bg-green-500/20 border border-green-600/30 dark:border-green-500/30">
                    <span className="text-green-700 dark:text-green-300 font-bold text-lg sm:text-xl">
                      {transaction.merchant_name ? transaction.merchant_name.charAt(0).toUpperCase() : 'T'}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg sm:text-xl font-bold text-foreground truncate">{transaction.merchant_name}</h2>
                    <p className="text-muted-foreground text-sm">
                      {formatTransactionDate(transaction.date, 'en-US', {
                        month: 'numeric',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                      {transaction.datetime && (
                        <span className="ml-2 text-xs">
                          {new Date(transaction.datetime).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                          })}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="text-left sm:text-right flex sm:block items-center justify-between sm:justify-end gap-2">
                  <div className="text-xl sm:text-2xl font-bold text-foreground">
                    ${Math.abs(transaction.amount).toFixed(2)}
                  </div>
                  <div className={`text-sm font-medium ${classification === 'business' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                    {classification === 'business' ? 'Marked business' : classification === 'personal' ? 'Marked personal' : 'Needs classification'}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge className={`border ${getCategoryBadgeClass(transaction.category)} rounded-lg`}>
                  {consolidateCategory(transaction.category).displayName}
                </Badge>
                {transaction.description && (
                  <span className="text-muted-foreground text-sm truncate max-w-full">{transaction.description}</span>
                )}
              </div>
            </Card>

            {/* AI Analysis Card */}
            <Card className="p-4 sm:p-5 bg-card border border-border rounded-xl shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-green-600/15 dark:bg-green-500/20 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-green-700 dark:text-green-300" />
                  </div>
                  <span className="font-semibold text-foreground">AI Analysis</span>
                </div>
                <Button
                  onClick={handleAnalyzeTransaction}
                  disabled={isAnalyzing || analysisUnavailable}
                  variant="outline"
                  size="sm"
                  className="text-green-700 dark:text-green-300 border-green-600/50 dark:border-green-500/50 hover:bg-green-600/10 dark:hover:bg-green-500/10"
                >
                  {isAnalyzing ? (
                    <>
                      <div className="w-3 h-3 border-2 border-green-600 dark:border-green-400 border-t-transparent rounded-full animate-spin mr-2" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Bot className="w-3 h-3 mr-2" />
                      {analysisUnavailable ? 'AI unavailable' : 'Run AI Analysis'}
                    </>
                  )}
                </Button>
              </div>

              {isLocalPreview && (
                <p className="mb-4 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground" role="status">
                  AI analysis is off in this local preview. You can still edit notes, attach receipts and record your classification manually.
                </p>
              )}

              {analysisError && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 dark:bg-red-900/20 border border-red-300 dark:border-red-700">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-sm font-medium">{analysisUnavailable ? 'AI unavailable' : 'Analysis incomplete'}</span>
                  </div>
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">{analysisError}</p>
                </div>
              )}

              {isAnalyzing ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-green-600 dark:text-green-400">
                    <div className="w-4 h-4 border-2 border-green-600 dark:border-green-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm font-medium">Analyzing transaction...</span>
                  </div>
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded animate-pulse" />
                    <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
                    <div className="h-4 bg-muted rounded animate-pulse w-1/2" />
                  </div>
                </div>
              ) : (transaction.deductionStatus || transaction.ai) ? (
                <div className="space-y-4">
                  <div className="space-y-3">
                    <h4 className="font-semibold text-foreground">Key Analysis Factors</h4>
                    <div className="p-4 rounded-lg bg-muted/50 dark:bg-muted/30 border border-border">
                      <ul className="text-sm text-muted-foreground space-y-2">
                        <li>• <strong>Date:</strong> {formatTransactionDate(transaction.date, 'en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                        {transaction.datetime && (
                          <span className="ml-1 text-xs">
                            at {new Date(transaction.datetime).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })}
                          </span>
                        )}
                        </li>
                        <li>• <strong>Deduction Status:</strong> {transaction.deductionStatus || transaction.ai?.key_analysis_factors?.deduction_status || transaction.ai?.status_label || 'Not Analyzed'}</li>
                        <li>• <strong>Reasoning:</strong> {transaction.reasoning || transaction.ai?.key_analysis_factors?.reasoning_summary || transaction.ai?.reasoning || transaction.deductible_reason || 'No saved reasoning'}</li>
                        {(transaction.ai?.key_analysis_factors?.irs_reference || (transaction.irsPublication || transaction.irsSection) || (transaction.ai?.irs?.publication || transaction.ai?.irs?.section)) && (
                          <li>• <strong>IRS Reference:</strong> {transaction.ai?.key_analysis_factors?.irs_reference ||
                            `${transaction.irsPublication || transaction.ai?.irs?.publication ? `Publication ${transaction.irsPublication || transaction.ai?.irs?.publication}` : ''}${(transaction.irsPublication || transaction.ai?.irs?.publication) && (transaction.irsSection || transaction.ai?.irs?.section) ? ', ' : ''}${transaction.irsSection || transaction.ai?.irs?.section ? `Section ${transaction.irsSection || transaction.ai?.irs?.section}` : ''}`
                          }</li>
                        )}
                      </ul>
                    </div>

                    {/* Additional AI Analysis Info */}
                    {transaction.ai && (
                      <>
                        {/* Suggested Documents */}
                        {transaction.ai.required_docs && transaction.ai.required_docs.length > 0 && (
                          <div className="p-3 rounded-lg bg-muted/50 dark:bg-muted/30 border border-border">
                            <div className="flex items-start gap-2">
                              <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0 bg-green-600 dark:bg-green-400" />
                              <div>
                                <span className="text-sm font-medium text-foreground block mb-1">Suggested Documents</span>
                                <ul className="text-sm text-muted-foreground space-y-1">
                                  {transaction.ai.required_docs.map((doc: string, index: number) => (
                                    <li key={index}>• {doc}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </div>
                        )}

                      </>
                    )}
                  </div>

                  {/* Analysis timestamp */}
                  {(transaction.analysisUpdatedAt || transaction.ai?.last_analyzed_at) && (
                    <div className="text-xs text-muted-foreground text-center">
                      Last analyzed: {new Date(transaction.analysisUpdatedAt || transaction.ai?.last_analyzed_at || Date.now()).toLocaleString()}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-foreground/90">
                    {transaction.ai_analysis || transaction.deductible_reason || 'No AI assessment is saved. Review the business purpose and supporting receipt yourself. Optional AI suggestions depend on service availability and do not establish deductibility.'}
                  </p>
                  <div className="space-y-3">
                    <h4 className="font-semibold text-foreground">Key Analysis Factors</h4>
                    <div className="p-4 rounded-lg bg-muted/50 dark:bg-muted/30 border border-border">
                      <ul className="text-sm text-muted-foreground space-y-2">
                        <li>• <strong className="text-foreground">Date:</strong> {formatTransactionDate(transaction.date, 'en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                        {transaction.datetime && (
                          <span className="ml-1 text-xs">
                            at {new Date(transaction.datetime).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })}
                          </span>
                        )}
                        </li>
                        <li>• <strong className="text-foreground">Deduction Status:</strong> Not yet analyzed</li>
                        <li>• <strong className="text-foreground">Review:</strong> Record the business purpose and discuss uncertain treatment with your tax preparer.</li>
                      </ul>
                    </div>
                  </div>
                  <div className="text-center py-4">
                    <p className="text-sm text-muted-foreground mb-3">No AI analysis available</p>
                    <Button
                      onClick={handleAnalyzeTransaction}
                      disabled={isAnalyzing || analysisUnavailable}
                      className="bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white"
                    >
                      {isAnalyzing ? (
                        <>
                          <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <Bot className="w-4 h-4 mr-2" />
                          {analysisUnavailable ? 'AI unavailable' : 'Analyze Transaction'}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            {/* Add Context Card */}
            <Card className="p-4 sm:p-5 bg-card border border-border rounded-xl shadow-sm">
              <h3 className="text-lg font-semibold text-foreground mb-3">Add Context</h3>
              <Textarea
                placeholder="Tell us more about this purchase..."
                value={additionalContext}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                  const next = e.target.value;
                  setAdditionalContext(next);
                  debouncedSave({ notes: next });
                }}
                className="min-h-[100px] rounded-lg border-border bg-background text-foreground placeholder:text-muted-foreground"
              />
              {additionalContext !== (transaction.notes || '') && (
                <p className="mt-2 text-sm text-green-600 dark:text-green-400">Notes modified - click Save Changes to save</p>
              )}
            </Card>

            {/* Receipt Upload Card */}
            <Card className="p-4 sm:p-5 bg-card border border-border rounded-xl shadow-sm">
              <h3 className="text-lg font-semibold text-foreground mb-3">Receipt</h3>

              {transaction.receipt_url ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3 p-4 rounded-lg bg-green-500/10 dark:bg-green-600/20 border border-green-600/30 dark:border-green-500/30">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center bg-green-600/20 dark:bg-green-500/20">
                      <FileText className="w-5 h-5 text-green-700 dark:text-green-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{transaction.receipt_filename}</p>
                      <p className="text-sm text-muted-foreground">Receipt attached to this transaction</p>
                    </div>
                    <div className="flex gap-2">
                      <ReceiptPreview key={transaction.receipt_url} url={transaction.receipt_url} filename={transaction.receipt_filename} />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleReceiptDelete}
                        className="border-red-600/50 text-red-700 dark:text-red-300 hover:bg-red-600/10"
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ) : showCamera ? (
                // Camera view
                <div className="space-y-4">
                  <div className="relative bg-black rounded-lg overflow-hidden">
                    <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-64 object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="bg-white/20 backdrop-blur-sm rounded-full p-4">
                        <div className="w-32 h-32 border-2 border-white border-dashed rounded-lg flex items-center justify-center">
                          <span className="text-white text-sm">Receipt Area</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      onClick={takePhoto}
                      className="flex-1 bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white"
                    >
                      <Camera className="w-4 h-4 mr-2" />
                      Take Photo
                    </Button>
                    <Button
                      onClick={stopCamera}
                      variant="outline"
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                  </div>
                  <canvas ref={canvasRef} className="hidden" />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="border-2 border-dashed border-border rounded-xl p-6 text-center bg-muted/20 dark:bg-muted/10">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-3 bg-muted">
                      <Upload className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <h4 className="text-base font-medium text-foreground mb-2">Add Receipt</h4>
                    <p className="text-sm text-muted-foreground mb-4">
                      Attach a receipt to support this transaction
                    </p>
                    <div className="flex gap-2 justify-center">
                      <Button onClick={startCamera} variant="outline" size="sm" className="flex-1 max-w-28">
                        <Camera className="w-4 h-4 mr-1" />
                        Photo
                      </Button>
                      <input type="file" id="receipt-upload" accept="image/*,.pdf" onChange={handleReceiptFileSelect} className="hidden" />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => document.getElementById('receipt-upload')?.click()}
                        className="flex-1 max-w-28"
                      >
                        <Upload className="w-4 h-4 mr-1" />
                        Upload
                      </Button>
                    </div>
                    {receiptFile && (
                      <div className="mt-4 p-3 rounded-lg bg-green-500/10 dark:bg-green-600/20 border border-green-600/30">
                        <div className="flex flex-wrap items-center gap-2">
                          <FileText className="w-4 h-4 text-green-700 dark:text-green-300 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{receiptFile.name}</p>
                            <p className="text-xs text-muted-foreground">{(receiptFile.size / 1024 / 1024).toFixed(2)} MB</p>
                          </div>
                          <Button
                            onClick={handleReceiptUpload}
                            disabled={isUploadingReceipt}
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white shrink-0"
                          >
                            {isUploadingReceipt ? (
                              <div className="flex items-center gap-1">
                                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                <span className="text-xs">Uploading...</span>
                              </div>
                            ) : (
                              'Upload'
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-3">JPG, PNG, GIF, PDF (max 10MB)</p>
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Right Column - Status & Tax Info */}
          <div className="space-y-4">
            {/* Status Card */}
            <Card className="p-4 sm:p-5 bg-card border border-border rounded-xl shadow-sm">
              <h3 className="font-semibold text-foreground mb-3">Status</h3>

              <div className="space-y-3 mb-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Classification</span>
                  <Badge className={`border-0 rounded-full ${classification === null
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                      : classification === 'business'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
                    }`}>
                    {classification === null
                      ? 'Needs Review'
                      : classification === 'business'
                        ? 'Marked business'
                        : 'Personal'
                    }
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground">A business classification records your choice. Eligibility, business use and deduction limits require separate review.</p>

                {isSaving && (
                  <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                    <div className="w-3 h-3 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                    <span>Saving changes...</span>
                  </div>
                )}
              </div>

              {classification === null && (
                <div className="mb-2 p-3 rounded-lg bg-green-500/10 dark:bg-green-600/20 border border-green-600/30 dark:border-green-500/30">
                  <p className="text-sm text-foreground text-center">
                    Please select whether this is a business or personal expense
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <button
                  onClick={() => handleClassificationChange('business')}
                  disabled={isSaving}
                  aria-label="Mark as business expense"
                  aria-describedby="business-expense-description"
                  className={`w-full p-3 rounded-lg border-2 transition-all duration-200 ${classification === 'business'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-600/50 dark:text-emerald-200'
                      : 'bg-muted/50 border-border text-foreground hover:bg-muted dark:bg-muted/30 dark:border-border dark:hover:bg-muted/50'
                    } ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${classification === 'business' ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-muted dark:bg-muted/80'
                      }`}>
                      {classification === 'business' ? (
                        <CheckCircle className="w-4 h-4 text-white" />
                      ) : (
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="text-left">
                      <p className="font-medium text-foreground">Business Expense</p>
                      <p className="text-sm text-muted-foreground" id="business-expense-description">
                        Record business use; tax limits still apply
                      </p>
                    </div>
                    {classification === 'business' && classification !== (transaction.is_deductible === null
                      ? null
                      : transaction.is_deductible
                        ? 'business'
                        : 'personal') && (
                        <div className="ml-auto">
                          <span className="text-xs bg-green-500/20 text-green-700 dark:text-green-300 px-2 py-1 rounded-full">
                            Modified
                          </span>
                        </div>
                      )}
                  </div>
                </button>

                <button
                  onClick={() => handleClassificationChange('personal')}
                  disabled={isSaving}
                  aria-label="Mark as personal expense - not tax deductible"
                  aria-describedby="personal-expense-description"
                  className={`w-full p-3 rounded-lg border-2 transition-all duration-200 ${classification === 'personal'
                      ? 'bg-red-50 border-red-300 text-red-800 dark:bg-red-900/30 dark:border-red-600/50 dark:text-red-200'
                      : 'bg-muted/50 border-border text-foreground hover:bg-muted dark:bg-muted/30 dark:border-border dark:hover:bg-muted/50'
                    } ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${classification === 'personal' ? 'bg-red-600 dark:bg-red-500' : 'bg-muted dark:bg-muted/80'
                      }`}>
                      {classification === 'personal' ? (
                        <XCircle className="w-4 h-4 text-white" />
                      ) : (
                        <User className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="text-left">
                      <p className="font-medium text-foreground">Personal Expense</p>
                      <p className="text-sm text-muted-foreground" id="personal-expense-description">
                        Not deductible
                      </p>
                    </div>
                    {classification === 'personal' && classification !== (transaction.is_deductible === null
                      ? null
                      : transaction.is_deductible
                        ? 'business'
                        : 'personal') && (
                        <div className="ml-auto">
                          <span className="text-xs bg-green-500/20 text-green-700 dark:text-green-300 px-2 py-1 rounded-full">
                            Modified
                          </span>
                        </div>
                      )}
                  </div>
                </button>
              </div>
            </Card>

            {/* Preparer review and authoritative tax planning */}
            <Card className="p-4 sm:p-5 bg-card border border-border rounded-xl shadow-sm">
              <h3 className="font-semibold text-foreground mb-3">Review with your preparer</h3>
              <p className="text-sm text-muted-foreground">
                Keep the receipt and business-purpose notes for your own tax preparer. WriteOff does not provide a CPA review service or a promised response time.
              </p>
            </Card>

            <Card className="p-4 sm:p-5 bg-card border border-border rounded-xl shadow-sm">
              <h3 className="font-semibold text-foreground mb-3">Federal tax planning</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Tax impact depends on your full-year income and supported tax facts. Review the shared annual estimate in Tax Preview; this record does not establish a tax rate or savings amount.
              </p>
              <Button variant="outline" className="w-full" onClick={() => router.push(protectedScreenUrl('tax-preview'))}>
                Open Tax Preview
              </Button>
            </Card>

            {/* Transaction Context Card */}
            <Card className="p-4 sm:p-5 bg-card border border-border rounded-xl shadow-sm">
              <h3 className="font-semibold text-foreground mb-3">Transaction Context</h3>
              <div className="space-y-4">
                <div>
                  <label htmlFor="business-purpose" className="block text-sm font-medium text-foreground mb-2">
                    Business Purpose
                  </label>
                  <Textarea
                    id="business-purpose"
                    placeholder="Why was this expense necessary for your business?"
                    value={businessPurpose}
                    onChange={(e) => {
                      const next = e.target.value;
                      setBusinessPurpose(next);
                      const updates = { business_purpose: next };
                      debouncedSave(updates);
                    }}
                    className="min-h-[80px] rounded-lg border-border bg-background text-foreground placeholder:text-muted-foreground"
                    maxLength={500}
                  />
                </div>

                <div>
                  <label htmlFor="client-project" className="block text-sm font-medium text-foreground mb-2">
                    Client/Project
                  </label>
                  <input
                    id="client-project"
                    type="text"
                    placeholder="Associated client or project name"
                    value={clientProject}
                    onChange={(e) => {
                      const next = e.target.value;
                      setClientProject(next);
                      const updates = { client_project: next };
                      debouncedSave(updates);
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
                    maxLength={100}
                  />
                </div>

                <div>
                  <label htmlFor="documentation-status" className="block text-sm font-medium text-foreground mb-2">
                    Documentation Status
                  </label>
                  <select
                    id="documentation-status"
                    value={documentationStatus || 'missing'}
                    onChange={(e) => {
                      const next = e.target.value as 'complete' | 'partial' | 'missing';
                      setDocumentationStatus(next);
                      const updates = { documentation_status: next };
                      debouncedSave(updates);
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:ring-2 focus:ring-green-500/50 focus:border-green-500"
                  >
                    <option value="missing">Missing</option>
                    <option value="partial">Partial</option>
                    <option value="complete">Complete</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="meeting-notes" className="block text-sm font-medium text-foreground mb-2">
                    Meeting Notes
                  </label>
                  <Textarea
                    id="meeting-notes"
                    placeholder="Notes about business meetings or discussions"
                    value={meetingNotes}
                    onChange={(e) => {
                      const next = e.target.value;
                      setMeetingNotes(next);
                      const updates = { meeting_notes: next };
                      debouncedSave(updates);
                    }}
                    className="min-h-[80px] rounded-lg border-border bg-background text-foreground placeholder:text-muted-foreground"
                    maxLength={500}
                  />
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6">
          <div className="flex flex-wrap justify-center items-center gap-4">
            <Button
              onClick={handleBackNavigation}
              variant="outline"
              className="h-12 px-8 rounded-lg border-border bg-card text-foreground hover:bg-muted"
            >
              Back to Transactions
            </Button>

            {classification === null && (
              <div className="flex items-center justify-center gap-2 rounded-lg p-3 bg-amber-500/10 dark:bg-amber-600/20 border border-amber-600/30 dark:border-amber-500/30 text-amber-800 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-sm font-medium">Please select whether this is a business or personal expense</span>
              </div>
            )}

            {classification && hasUnsavedChanges && (
              <Button
                onClick={handleSaveChanges}
                disabled={isSaving}
                className="h-12 px-8 rounded-lg bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {isSaving ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Saving...</span>
                  </div>
                ) : (
                  'Save Changes'
                )}
              </Button>
            )}

            {classification && !hasUnsavedChanges && (
              <div className="flex items-center justify-center gap-2 rounded-lg p-3 bg-green-500/10 dark:bg-green-600/20 border border-green-600/30 dark:border-green-500/30 text-green-700 dark:text-green-300">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span className="text-sm font-medium">All changes saved</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Unsaved Changes Confirmation Dialog */}
      <ConfirmationDialog
        open={showUnsavedDialog}
        onOpenChange={setShowUnsavedDialog}
        title="Unsaved Changes"
        description="You have unsaved changes. Are you sure you want to leave? Your changes will be lost."
        confirmLabel="Leave"
        cancelLabel="Stay"
        variant="destructive"
        onConfirm={() => {
          setShowUnsavedDialog(false);
          performBackNavigation();
        }}
        onCancel={() => setShowUnsavedDialog(false)}
      />

    </div>
  );
};
