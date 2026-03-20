"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToasts } from '@/components/ui/toast';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { auth } from '@/lib/firebase/client';
import { formatCategory, consolidateCategory } from '@/lib/utils';
import { getTransactionId } from '@/lib/utils/transaction-id';
import { calculateEffectiveTaxRate, getUserTaxRate } from '@/lib/tax-rules/federal-brackets';
import { useUpdateTransaction } from '@/lib/firebase/mutations';
// Using API route instead of direct database access
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Bot,
  AlertTriangle,
  DollarSign,
  Calendar,
  Tag,
  MessageSquare,
  Building2,
  User,
  Upload,
  FileText,
  Eye,
  Trash2,
  Camera,
  HelpCircle,
  Send,
  X
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
    if (transaction.is_deductible === null) {
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showCpaModal, setShowCpaModal] = useState(false);
  const [cpaQuestion, setCpaQuestion] = useState('');
  const [isSubmittingCpaQuestion, setIsSubmittingCpaQuestion] = useState(false);

  // Debounced save for context fields
  const [pendingUpdates, setPendingUpdates] = useState<Record<string, any>>({});
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // AI Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Get current user for optimistic updates
  const currentUser = auth.currentUser;
  const userId = currentUser?.uid;

  // Track whether analysis is running (safe to read inside setTimeout callbacks).
  const isAnalyzingRef = useRef(false);
  const reanalysisTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const handleAnalyzeTransactionRef = useRef<null | (() => Promise<void>)>(null);

  useEffect(() => {
    isAnalyzingRef.current = isAnalyzing;
  }, [isAnalyzing]);

  const scheduleReanalysis = useCallback(() => {
    if (!userId || !currentUser) return;
    if (isAnalyzingRef.current) return;
    if (reanalysisTimeoutRef.current) {
      clearTimeout(reanalysisTimeoutRef.current);
    }

    // Debounce so multiple context saves batch into one re-run.
    reanalysisTimeoutRef.current = setTimeout(async () => {
      if (isAnalyzingRef.current) return;
      try {
        await handleAnalyzeTransactionRef.current?.();
      } catch (e) {
        // handleAnalyzeTransaction has its own error handling, but keep this safe anyway.
        console.error('Error running scheduled reanalysis:', e);
      }
    }, 700);
  }, [userId, currentUser]);

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
        // After context fields are saved, re-run AI for this specific transaction.
        scheduleReanalysis();
      } catch (error) {
        console.error('Error saving context field:', error);
      }
    }, 500);
  }, [userId, transaction.trans_id, transaction.id, updateTransactionMutation, scheduleReanalysis]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (reanalysisTimeoutRef.current) {
        clearTimeout(reanalysisTimeoutRef.current);
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

    const notesChanged = (additionalContext || '') !== (transaction.notes || '');

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

      // If the user added/edited their notes context, re-run AI to improve the recommendation.
      if (notesChanged) {
        scheduleReanalysis();
      }
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Use back camera on mobile
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      setCameraStream(stream);
      setShowCamera(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      showError('Camera Access Denied', 'Please allow camera access to take photos');
    }
  };

  // Stop camera
  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setShowCamera(false);
  };

  // Take photo
  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

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

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

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
        receipt_url: undefined,
        receipt_filename: undefined
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

  // Handle CPA question submission
  const handleCpaQuestionSubmit = async () => {
    if (!cpaQuestion.trim() || !userId || !currentUser) {
      showError('Invalid Input', 'Please enter a question');
      return;
    }

    setIsSubmittingCpaQuestion(true);

    try {
      // Get the current user's ID token for authentication
      const token = await currentUser.getIdToken();

      const response = await fetch('/api/cpa-question', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId,
          transactionId: getTransactionId(transaction),
          merchantName: transaction.merchant_name,
          amount: transaction.amount,
          date: transaction.date,
          category: transaction.category,
          question: cpaQuestion.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit question');
      }

      showSuccess('Question Submitted', 'Your question has been sent to our CPA team. You will receive a response within 24 hours.');
      setCpaQuestion('');
      setShowCpaModal(false);

    } catch (error) {
      console.error('Error submitting CPA question:', error);
      showError('Submission Failed', 'Failed to submit your question. Please try again.');
    } finally {
      setIsSubmittingCpaQuestion(false);
    }
  };

  // Handle AI Analysis
  const handleAnalyzeTransaction = async () => {
    if (!userId || !currentUser) {
      showError('Authentication Error', 'Please log in to analyze transactions');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      // Get the current user's ID token for authentication
      const token = await currentUser.getIdToken();

      const transactionId = getTransactionId(transaction);
      console.log(`🔍 [Frontend] Sending re-run analysis request:`, {
        transactionId,
        hasTransId: !!transaction.trans_id,
        hasId: !!transaction.id,
        transIdValue: transaction.trans_id,
        idValue: transaction.id,
        merchant_name: transaction.merchant_name,
        amount: transaction.amount,
        fullTransaction: transaction
      });

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
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to analyze transaction');
      }

      const result = await response.json();

      if (result.success) {
        showSuccess('Analysis Complete', 'Transaction has been analyzed successfully');

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
      console.error('Error analyzing transaction:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to analyze transaction';
      setAnalysisError(errorMessage);
      showError('Analysis Failed', errorMessage);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Keep a ref to the latest callback so scheduleReanalysis() always calls the most recent version.
  useEffect(() => {
    handleAnalyzeTransactionRef.current = handleAnalyzeTransaction;
  }, [handleAnalyzeTransaction]);

  // Check if there are unsaved changes
  const hasUnsavedChanges =
    classification !== (transaction.is_deductible === null
      ? null
      : transaction.is_deductible
        ? 'business'
        : 'personal') ||
    additionalContext !== (transaction.notes || '') ||
    receiptFile !== null;

  // Simplified logic - no partial deductions
  const deductiblePercent = 100; // All deductible transactions are 100% deductible
  const estimatedTaxRatePercent = Math.round(getUserTaxRate() * 100);
  // Tax savings amount = deductible amount × tax rate
  const deductibleSavingsAmount = classification === 'business'
    ? Math.abs(transaction.amount) * (estimatedTaxRatePercent / 100)
    : 0;

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
                      {new Date(transaction.date).toLocaleDateString('en-US', {
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
                    {classification === 'business' ? `${deductiblePercent}% deductible` : '0% deductible'}
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
                  disabled={isAnalyzing}
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
                      Re-run Analysis
                    </>
                  )}
                </Button>
              </div>

              {analysisError && (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 dark:bg-red-900/20 border border-red-300 dark:border-red-700">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-sm font-medium">Analysis Error</span>
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
                        <li>• <strong>Date:</strong> {new Date(transaction.date).toLocaleDateString('en-US', {
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
                        <li>• <strong>Reasoning:</strong> {transaction.reasoning || transaction.ai?.key_analysis_factors?.reasoning_summary || transaction.ai?.reasoning || transaction.deductible_reason || 'Professional analysis pending'}</li>
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
                    {transaction.ai_analysis || transaction.deductible_reason || 'This transaction hasn\'t been analyzed yet. Tap "Analyze" to get a deduction assessment based on your profile and business.'}
                  </p>
                  <div className="space-y-3">
                    <h4 className="font-semibold text-foreground">Key Analysis Factors</h4>
                    <div className="p-4 rounded-lg bg-muted/50 dark:bg-muted/30 border border-border">
                      <ul className="text-sm text-muted-foreground space-y-2">
                        <li>• <strong className="text-foreground">Date:</strong> {new Date(transaction.date).toLocaleDateString('en-US', {
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
                        <li>• <strong className="text-foreground">Reasoning:</strong> Tap &quot;Analyze&quot; to check if this is deductible for your business.</li>
                      </ul>
                    </div>
                  </div>
                  <div className="text-center py-4">
                    <p className="text-sm text-muted-foreground mb-3">No AI analysis available</p>
                    <Button
                      onClick={handleAnalyzeTransaction}
                      disabled={isAnalyzing}
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
                          Analyze Transaction
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(transaction.receipt_url, '_blank')}
                        className="border-green-600/50 text-green-700 dark:text-green-300 hover:bg-green-600/10"
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        View
                      </Button>
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
                        ? 'Deductible'
                        : 'Personal'
                    }
                  </Badge>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Deductible %</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {classification === 'business' ? `${deductiblePercent}%` : classification === 'personal' ? '0%' : '-'}
                  </span>
                </div>

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
                  aria-label="Mark as business expense - tax deductible"
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
                        Tax deductible
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

            {/* Ask a CPA Card */}
            <Card className="p-4 sm:p-5 bg-card border border-border rounded-xl shadow-sm">
              <h3 className="font-semibold text-foreground mb-3">Need Help?</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Get expert tax advice on this transaction from our CPA team.
              </p>
              <Button
                onClick={() => setShowCpaModal(true)}
                variant="outline"
                className="w-full h-10 rounded-lg border-purple-500/50 bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-500/20 dark:hover:bg-purple-500/20"
              >
                <HelpCircle className="w-4 h-4 mr-2" />
                Ask a CPA
              </Button>
            </Card>

            {/* Tax Information Card */}
            <Card className="p-4 sm:p-5 bg-card border border-border rounded-xl shadow-sm">
              <h3 className="font-semibold text-foreground mb-3">Tax Information</h3>
              <div className="space-y-3">
                <div className="rounded-lg p-3 bg-emerald-500/10 dark:bg-emerald-600/20 border border-emerald-600/30 dark:border-emerald-500/30">
                  <div className="text-sm text-muted-foreground mb-1">Estimated Tax Rate</div>
                  <div className="font-medium text-emerald-700 dark:text-emerald-300">{estimatedTaxRatePercent}%</div>
                </div>
                <div className="rounded-lg p-3 bg-blue-500/10 dark:bg-blue-600/20 border border-blue-600/30 dark:border-blue-500/30">
                  <div className="text-sm text-muted-foreground mb-1">Estimated Tax Savings</div>
                  <div className="font-medium text-blue-700 dark:text-blue-300">
                    {classification === null ? '-' : `$${deductibleSavingsAmount.toFixed(2)} ${classification === 'business' ? `(${estimatedTaxRatePercent}% of $${Math.abs(transaction.amount).toFixed(2)})` : '(0%)'}`}
                  </div>
                </div>

                {classification && (
                  <div className="rounded-lg p-3 bg-muted/50 dark:bg-muted/30 border border-border">
                    <div className="text-sm text-muted-foreground mb-1">Last Updated</div>
                    <div className="font-medium text-foreground">
                      {isSaving ? 'Saving...' : 'Just now'}
                    </div>
                  </div>
                )}
              </div>
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

      {/* CPA Question Modal */}
      {showCpaModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center bg-purple-500/20 dark:bg-purple-600/30">
                    <HelpCircle className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">Ask a CPA</h2>
                    <p className="text-sm text-muted-foreground">Get expert tax advice on this transaction</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowCpaModal(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center bg-muted hover:bg-muted/80 transition-colors text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="rounded-lg p-4 mb-6 bg-muted/50 dark:bg-muted/30 border border-border">
                <h3 className="font-medium text-foreground mb-2">Transaction Details</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-semibold text-foreground">Merchant:</span>
                    <span className="ml-1 text-foreground font-medium">{transaction.merchant_name || '-'}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Amount:</span>
                    <span className="ml-1 text-foreground font-medium">${typeof transaction.amount === 'number' ? Math.abs(transaction.amount).toFixed(2) : '-'}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Date:</span>
                    <span className="ml-1 text-foreground font-medium">
                      {transaction.date ? new Date(transaction.date).toLocaleDateString('en-US') : '-'}
                      {transaction.datetime
                        ? (() => {
                            const dt = transaction.datetime;
                            return dt ? (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                              </span>
                            ) : null;
                          })()
                        : null}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Category:</span>
                    <span className="ml-1 text-foreground font-medium break-words max-w-[180px] inline-block align-top">{consolidateCategory(transaction.category).displayName || '-'}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="cpa-question" className="block text-sm font-medium text-foreground mb-2">
                    Your Question
                  </label>
                  <Textarea
                    id="cpa-question"
                    placeholder="Ask about deductibility, documentation requirements, or any other tax-related questions about this transaction..."
                    value={cpaQuestion}
                    onChange={(e) => setCpaQuestion(e.target.value)}
                    className="min-h-[120px] rounded-lg border-border bg-background text-foreground placeholder:text-muted-foreground"
                    maxLength={1000}
                  />
                  <div className="flex justify-between items-center mt-1">
                    <p className="text-xs text-muted-foreground">
                      Be specific about your business use case and any concerns you have
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {cpaQuestion.length}/1000
                    </span>
                  </div>
                </div>

                <div className="rounded-lg p-4 bg-blue-500/10 dark:bg-blue-600/20 border border-blue-600/30 dark:border-blue-500/30">
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 bg-blue-600 dark:bg-blue-500">
                      <span className="text-white text-xs font-bold">i</span>
                    </div>
                    <div>
                      <h4 className="font-medium text-blue-900 dark:text-blue-200 mb-1">What to expect</h4>
                      <ul className="text-sm text-blue-800 dark:text-blue-200/90 space-y-1">
                        <li>• Our CPA team will review your question within 24 hours</li>
                        <li>• You'll receive a detailed response via email</li>
                        <li>• The response will include specific guidance for your situation</li>
                        <li>• Follow-up questions are welcome</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <Button
                  onClick={() => setShowCpaModal(false)}
                  variant="outline"
                  className="flex-1 h-12 rounded-lg border-border bg-card text-foreground hover:bg-muted"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCpaQuestionSubmit}
                  disabled={!cpaQuestion.trim() || isSubmittingCpaQuestion}
                  className="flex-1 h-12 rounded-lg bg-purple-600 hover:bg-purple-700 dark:bg-purple-700 dark:hover:bg-purple-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmittingCpaQuestion ? (
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Submitting...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Send className="w-4 h-4" />
                      <span>Send Question</span>
                    </div>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
