"use client";

import { formatRecordedTransactionAmount } from '@/lib/transactions/amount-display';
import { formatTransactionDate } from '@/lib/transactions/calendar-date';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import * as DetailTabs from '@radix-ui/react-tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToasts } from '@/components/ui/toast';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ReceiptPreview } from '@/components/receipt-preview';
import { EvidenceImportDialog } from '@/components/evidence-import-dialog';
import { AiTaxAnalysisDialog, AiTaxExplanation } from '@/components/ai-tax-explanation';
import { ExplanationCard } from '@/components/ai/explanation-card';
import { normalizeExplanation } from '@/lib/ai/explanation';
import { PurposeConfirmChip } from '@/components/review/purpose-confirm-chip';
import { BulkConfirmOffer, bulkOutcomeMessage } from '@/components/review/bulk-confirm-offer';
import { AnalysisStatusNotice } from '@/components/analysis-status-notice';
import { analysisRecordState } from '@/lib/ai/analysis-state';
import type { AiReviewSuggestion } from '@/lib/transactions/ai-review-contract';
import { isSupersededRecord } from '@/lib/transactions/record-scope';
import type { Transaction as StoredTransaction } from '@/lib/firebase/transactions';
import { bulkOfferFor, canOfferPurposeConfirmation, confirmPurposeUpdates, firstOpenQuestion, proposedBusinessPurpose, rejectProposalUpdates,
  type AiExplanation, type BulkConfirmRequest } from '@/lib/transactions/review-proposals';
import { auth } from '@/lib/firebase/client';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { useAiAvailability } from '@/lib/hooks/use-ai-availability';
import { consolidateCategory } from '@/lib/utils';
import { getTransactionId } from '@/lib/utils/transaction-id';
import { protectedScreenUrl } from '@/lib/navigation/protected-screens';
import { APP_NAVIGATION_EVENT } from '@/lib/navigation/navigation-guard';
import { useUpdateTransaction } from '@/lib/firebase/mutations';
import { attachCaptureVideo, createMediaCapture } from '@/lib/browser/media-capture';
// Using API route instead of direct database access
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  CheckCircle,
  Bot,
  Upload,
  Trash2,
  Camera
} from 'lucide-react';

interface TransactionDetailScreenProps {
  initialSection?: 'summary' | 'details';
  transaction: {
    id: string;
    merchant_name: string;
    amount: number;
    iso_currency_code?: string;
    unofficial_currency_code?: string;
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
    superseded_by?: string | null; // Server-only: this bank record duplicates an earlier reviewed one
    pending?: boolean | null;
    review_status?: string;
    // Durable analysis pipeline stamps (lib/ai/analysis-jobs.ts).
    analysisStatus?: StoredTransaction['analysisStatus'];
    analysis_status?: StoredTransaction['analysis_status'];
    analysisErrorCode?: StoredTransaction['analysisErrorCode'];
    analysisJobId?: StoredTransaction['analysisJobId'];
    analysisRefreshReason?: 'profile_changed' | 'transaction_changed' | null;
    ai_suggestion?: AiReviewSuggestion | null;
    ai_missing_fields?: string[];
    ai_customized_reason?: string | null;
    ai_explanation?: AiExplanation | null;
    
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
  /** The owner's loaded transactions; used only to count similar unreviewed charges for the bulk offer. */
  transactions?: StoredTransaction[];
  onBack: () => void;
  onSave: (updatedTransaction: any) => void;
}

export const TransactionDetailScreen: React.FC<TransactionDetailScreenProps> = ({
  transaction,
  transactions,
  onBack,
  onSave,
  initialSection = 'summary'
}) => {
  // Router hook (top-level hook call)
  const router = useRouter();

  // State for unsaved changes confirmation dialog
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const pendingDestination = useRef<string | null>(null);

  const performBackNavigation = () => {
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = null;
    pendingContextUpdates.current = {};
    if (pendingDestination.current) router.push(pendingDestination.current);
    else onBack();
  };

  const handleBackNavigation = () => {
    pendingDestination.current = null;
    if (hasUnsavedChanges) {
      setShowUnsavedDialog(true);
    } else {
      performBackNavigation();
    }
  };
  const navigateFromTransaction = (destination: string) => {
    pendingDestination.current = destination;
    if (hasUnsavedChanges) setShowUnsavedDialog(true);
    else performBackNavigation();
  };
  // A saved business category is not a saved decision to include a deduction.
  const getInitialClassification = (record = transaction): 'business' | 'personal' | null => {
    if (typeof record.is_deductible !== 'boolean') {
      return null; // No default for needs review items - user must choose
    }
    return record.is_deductible ? 'business' : 'personal';
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
  const pendingContextUpdates = useRef<Record<string, string>>({});
  const contextSaveTail = useRef<Promise<unknown>>(Promise.resolve());
  const pendingContextSaves = useRef(0);
  const previousSavedTransaction = useRef(transaction);
  const localContextDrafts = useRef<Record<string, string>>({});
  const localClassificationDraft = useRef<'business' | 'personal' | null>(null);

  // AI Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [detailSection, setDetailSection] = useState<string>(initialSection);
  const changeDetailSection = useCallback((section: string) => {
    if (section !== 'receipt') {
      // Cancel permission requests as well as an already visible camera preview.
      cameraCapture.current.stop();
      setCameraStream(null);
      setShowCamera(false);
    }
    setDetailSection(section);
  }, []);

  // Get current user for optimistic updates
  const currentUser = auth.currentUser;
  const userId = currentUser?.uid;

  // Manual analysis is explicit; persisted automatic results arrive through the parent subscription.
  const aiAvailability = useAiAvailability(userId);
  const isAnalyzingRef = useRef(false);
  const [analysisUnavailable, setAnalysisUnavailable] = useState(false);
  const analysisContext = `${userId}:${getTransactionId(transaction)}`;
  const activeAnalysisContext = useRef(analysisContext); activeAnalysisContext.current = analysisContext;
  const analysisRequest = useRef(0);

  useEffect(() => {
    const requests = analysisRequest;
    setAnalysisError(null);
    setAnalysisUnavailable(false);
    setIsAnalyzing(false);
    isAnalyzingRef.current = false;
    return () => { ++requests.current; };
  }, [analysisContext]);

  useEffect(() => {
    // The route selects a tab without interrupting an analysis of this record.
    changeDetailSection(initialSection);
  }, [analysisContext, initialSection, changeDetailSection]);

  const checkAiAvailability = async () => {
    if (isAnalyzingRef.current) return;
    if (await aiAvailability.refresh() && activeAnalysisContext.current === analysisContext) setAnalysisUnavailable(false);
  };
  const analysisBlocked = analysisUnavailable || aiAvailability.status !== 'configured';
  // What the durable pipeline last did with this record, explained when no suggestion exists.
  const pipeline = analysisRecordState(transaction);
  const analysisRunning = transaction.analysisStatus === 'running' || transaction.analysis_status === 'running';
  const analysisQueued = !!transaction.analysisJobId && (transaction.analysisStatus === 'pending' || transaction.analysis_status === 'pending');
  const backgroundAnalysis = analysisRunning || analysisQueued;
  const profileRefresh = backgroundAnalysis && transaction.analysisRefreshReason === 'profile_changed';
  const factsRefresh = backgroundAnalysis && transaction.analysisRefreshReason === 'transaction_changed';
  const refreshSavedTransaction = useRef(onSave); refreshSavedTransaction.current = onSave;

  // The parent receives Firestore snapshots. A pending-only fallback also works when its
  // subscription has fallen back to the REST API; viewing never starts a provider call.
  useEffect(() => {
    if (!userId || !backgroundAnalysis) return;
    let canceled = false;
    let pending = false;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      if (pending || typeof document !== 'undefined' && document.hidden) return;
      pending = true;
      try {
        const response = await makeAuthenticatedRequest(`/api/transactions/${encodeURIComponent(getTransactionId(transaction))}`, { cache: 'no-store', signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (response.ok && payload?.transaction && !canceled && auth.currentUser?.uid === userId && activeAnalysisContext.current === analysisContext) {
          refreshSavedTransaction.current(payload.transaction);
        }
      } catch { /* The persisted state and manual retry remain available. */ }
      finally { pending = false; }
    }, 5000);
    return () => { canceled = true; controller.abort(); clearInterval(timer); };
    // Only identity/status changes restart the fallback; current callbacks live in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisContext, userId, backgroundAnalysis]);

  // Use React Query mutation with optimistic updates for instant UI feedback
  const updateTransactionMutation = useUpdateTransaction();
  const { showSuccess, showError } = useToasts();

  // Refresh saved fields without replacing edits when a background save or analysis arrives.
  useEffect(() => {
    const previous = previousSavedTransaction.current;
    const changedRecord = getTransactionId(previous) !== getTransactionId(transaction);
    const syncDraft = <T,>(draft: T, saved: T, next: T, locallyEdited = false) => changedRecord || !locallyEdited && draft === saved ? next : draft;
    setClassification(draft => syncDraft(draft, getInitialClassification(previous), getInitialClassification(), localClassificationDraft.current !== null));
    setAdditionalContext(draft => syncDraft(draft, previous.notes || '', transaction.notes || '', 'notes' in localContextDrafts.current));
    setBusinessPurpose(draft => syncDraft(draft, previous.business_purpose || '', transaction.business_purpose || '', 'business_purpose' in localContextDrafts.current));
    setClientProject(draft => syncDraft(draft, previous.client_project || '', transaction.client_project || '', 'client_project' in localContextDrafts.current));
    setDocumentationStatus(draft => syncDraft(draft, previous.documentation_status || 'missing', transaction.documentation_status || 'missing', 'documentation_status' in localContextDrafts.current));
    setMeetingNotes(draft => syncDraft(draft, previous.meeting_notes || '', transaction.meeting_notes || '', 'meeting_notes' in localContextDrafts.current));
    if (changedRecord) {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
      pendingContextUpdates.current = {};
      localContextDrafts.current = {};
      localClassificationDraft.current = null;
      setReceiptFile(null);
    }
    previousSavedTransaction.current = transaction;
  }, [transaction]);

  // Check if currently saving
  const isSaving = updateTransactionMutation.isPending;

  // Keep older debounced writes ahead of the explicit pre-analysis save.
  const saveContext = useCallback((updates: Parameters<typeof updateTransactionMutation.mutateAsync>[0]['updates']) => {
    pendingContextSaves.current++;
    const save = contextSaveTail.current.catch(() => undefined).then(() => {
      if (!userId || auth.currentUser?.uid !== userId) throw new Error('Sign in again before saving context.');
      return updateTransactionMutation.mutateAsync({ transactionId: getTransactionId(transaction), userId, updates });
    }).then(saved => {
      if (activeAnalysisContext.current === analysisContext) {
        for (const [field, value] of Object.entries(updates)) {
          if (localContextDrafts.current[field] === value) delete localContextDrafts.current[field];
        }
      }
      return saved;
    }).finally(() => { pendingContextSaves.current--; });
    contextSaveTail.current = save;
    return save;
  }, [userId, transaction, updateTransactionMutation, analysisContext]);

  // Debounced save function
  const debouncedSave = useCallback((updates: Record<string, string>) => {
    pendingContextUpdates.current = { ...pendingContextUpdates.current, ...updates };
    localContextDrafts.current = { ...localContextDrafts.current, ...updates };
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(async () => {
      debounceTimeoutRef.current = null;
      if (!userId) return;
      const pendingUpdates = pendingContextUpdates.current;
      pendingContextUpdates.current = {};
      try {
        const saved = await saveContext(pendingUpdates);
        if (activeAnalysisContext.current === analysisContext) onSave({ ...transaction, ...saved });
      } catch (error) {
        showError('Context not saved', 'Your edits are still here. Use Save Changes to try again.');
      }
    }, 500);
  }, [userId, saveContext, showError, analysisContext, onSave, transaction]);

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
    localClassificationDraft.current = newClassification === getInitialClassification() ? null : newClassification;
    setClassification(newClassification);
  };

  // Handle manual save of all changes
  const handleSaveChanges = async () => {
    if (!userId) {
      showError('Authentication Error', 'Please sign in to save changes');
      return;
    }

    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = null;
    pendingContextUpdates.current = {};
    const classificationChanged = classification !== getInitialClassification() && classification !== null;
    const updates = {
      notes: additionalContext,
      business_purpose: businessPurpose,
      client_project: clientProject,
      documentation_status: documentationStatus,
      meeting_notes: meetingNotes,
      ...(classificationChanged ? {
        is_deductible: classification === 'business',
        ...(classification === 'business' ? { expense_type: 'business' as const } : {}),
        user_classification_reason: classification === 'business'
          ? (additionalContext || 'Business deduction included by user after reviewing eligibility')
          : 'Excluded from deductions by user',
      } : {}),
    };

    try {
      // Wait for older autosaves so a late response cannot overwrite the latest draft.
      const savedTransaction = await saveContext(updates);
      if (localClassificationDraft.current === classification) localClassificationDraft.current = null;

      showSuccess('Changes Saved', 'Transaction updated successfully');

      // Call onSave callback for parent component to update local state
      const updatedTransaction = {
        ...transaction,
        ...updates,
        ...savedTransaction,
      };

      await onSave(updatedTransaction);

    } catch (error) {
      console.error('Error updating transaction:', error);
      showError('Update Failed', 'Failed to save changes. Please try again.');
    }
  };

  // Purpose saves supply facts; only an explicit tax decision stamps review state.
  const [proposalSaving, setProposalSaving] = useState(false);
  const [bulkOffer, setBulkOffer] = useState<BulkConfirmRequest | null>(null);
  useEffect(() => { setBulkOffer(null); }, [analysisContext]);
  const proposal = proposedBusinessPurpose(transaction);
  const openQuestion = firstOpenQuestion(transaction);
  const offerPurpose = !isAnalyzing && !backgroundAnalysis && canOfferPurposeConfirmation(transaction);
  const handleProposalDecision = async (updates: Record<string, unknown>, title: string, detail: string) => {
    if (proposalSaving) return;
    if (!userId) { showError('Authentication Error', 'Please sign in to save changes'); return; }
    setProposalSaving(true);
    try {
      const saved = await saveContext(updates as Parameters<typeof saveContext>[0]);
      if (activeAnalysisContext.current !== analysisContext) return;
      if (typeof updates.business_purpose === 'string') setBusinessPurpose(updates.business_purpose);
      if (typeof updates.is_deductible === 'boolean') { setClassification(updates.is_deductible ? 'business' : 'personal'); localClassificationDraft.current = null; }
      const decided = { ...transaction, ...updates, ...saved } as unknown as StoredTransaction;
      setBulkOffer(typeof updates.is_deductible === 'boolean' && transactions ? bulkOfferFor(decided, transactions) : null);
      showSuccess(title, detail);
      await onSave(decided);
    } catch {
      if (activeAnalysisContext.current === analysisContext) showError('Decision not saved', 'Your decision could not be saved. Please try again.');
    } finally {
      if (activeAnalysisContext.current === analysisContext) setProposalSaving(false);
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

  const attachEvidenceReceipt = async (file: File) => {
    if (!userId || auth.currentUser?.uid !== userId) throw new Error('Sign in again before attaching a receipt.');
    const capturedContext = analysisContext;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('transactionId', getTransactionId(transaction));
    const response = await makeAuthenticatedRequest('/api/upload-receipt', { method: 'POST', body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not upload this receipt.');
    if (!/^\/api\/receipts\/[a-zA-Z0-9_-]+$/.test(result.receiptUrl || '')) throw new Error('The receipt could not be verified. Please retry.');
    if (activeAnalysisContext.current !== capturedContext || auth.currentUser?.uid !== userId) throw new Error('Your session changed. Open the transaction again.');
    const saved = await saveContext({ receipt_url: result.receiptUrl, receipt_filename: result.filename || file.name });
    if (activeAnalysisContext.current === capturedContext && auth.currentUser?.uid === userId) {
      await onSave({ ...transaction, ...saved });
      setReceiptFile(null);
      showSuccess('Receipt attached', 'Your receipt is saved with this transaction.');
    }
  };
  const confirmCalendarPurpose = async (purpose: string) => {
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = null;
    // Flush other drafts before the explicit calendar choice; an older purpose must not win later.
    const updates = { ...pendingContextUpdates.current, business_purpose: purpose };
    pendingContextUpdates.current = {};
    localContextDrafts.current = { ...localContextDrafts.current, business_purpose: purpose };
    setBusinessPurpose(purpose);
    const capturedContext = analysisContext;
    const saved = await saveContext(updates);
    if (activeAnalysisContext.current === capturedContext && auth.currentUser?.uid === userId) {
      await onSave({ ...transaction, ...saved });
      showSuccess('Purpose saved', 'AI will review the updated details. Your classification is unchanged.');
    }
  };

  // Camera, direct-file and email receipts share the same authenticated upload/save path.
  const handleReceiptUpload = async () => {
    if (!receiptFile || !userId) return;

    setIsUploadingReceipt(true);

    try {
      await attachEvidenceReceipt(receiptFile);

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
    if (isAnalyzingRef.current || analysisBlocked) return;
    if (!userId || !currentUser) {
      showError('Authentication Error', 'Please log in to analyze transactions');
      return;
    }

    isAnalyzingRef.current = true;
    const request = ++analysisRequest.current;
    const isCurrent = () => analysisRequest.current === request && activeAnalysisContext.current === analysisContext && auth.currentUser?.uid === userId;
    setIsAnalyzing(true);
    setAnalysisError(null);
    let unavailable = false;

    try {
      const transactionId = getTransactionId(transaction);
      const trimmedAdditionalContext = (additionalContext || '').trim();
      const trimmedBusinessPurpose = (businessPurpose || '').trim();
      const trimmedClientProject = (clientProject || '').trim();
      const trimmedMeetingNotes = (meetingNotes || '').trim();

      const hadPendingContext = debounceTimeoutRef.current !== null || pendingContextSaves.current > 0;
      if (debounceTimeoutRef.current !== null) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
      pendingContextUpdates.current = {};
      const contextFields: [string, string, string][] = [
        ['notes', trimmedAdditionalContext, (transaction.notes || '').trim()],
        ['business_purpose', trimmedBusinessPurpose, (transaction.business_purpose || '').trim()],
        ['client_project', trimmedClientProject, (transaction.client_project || '').trim()],
        ['documentation_status', documentationStatus, transaction.documentation_status || 'missing'],
        ['meeting_notes', trimmedMeetingNotes, (transaction.meeting_notes || '').trim()],
      ];
      const updates = Object.fromEntries(contextFields.filter(([, value, saved]) => hadPendingContext || value !== saved).map(([key, value]) => [key, value]));
      if (Object.keys(updates).length > 0) {
        try {
          const saved = await saveContext(updates);
          if (isCurrent() && saved?.analysisRefreshReason === 'transaction_changed' && (saved.analysisStatus === 'pending' || saved.analysis_status === 'pending')) {
            onSave({ ...transaction, ...saved });
            return; // The saved revision starts durable background work; do not race it with another provider call.
          }
        }
        catch { throw new Error('Your latest context could not be saved, so AI analysis was not started. Save your changes and try again.'); }
      }
      if (!isCurrent()) return;
      // The server analyzes canonical saved fields, including the context saved above.
      const token = await currentUser.getIdToken();
      if (!isCurrent()) return;

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
      if (!isCurrent()) return;

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
          ai_suggestion: result.ai_suggestion ?? null,
          // Replace the old question/facts with the explanation actually saved by this run.
          // A missing or invalid payload clears the stale card instead of retaining it.
          ai_explanation: normalizeExplanation(result.explanation),
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
        changeDetailSection('summary');
      } else {
        throw new Error(result.error || 'Analysis failed');
      }

    } catch (error) {
      if (!isCurrent()) return;
      const errorMessage = error instanceof Error ? error.message : 'AI analysis could not complete. Continue reviewing manually.';
      setAnalysisError(errorMessage);
      setAnalysisUnavailable(unavailable);
      showError(unavailable ? 'AI unavailable' : 'Analysis incomplete', errorMessage);
    } finally {
      if (isCurrent()) {
        isAnalyzingRef.current = false;
        setIsAnalyzing(false);
      }
    }
  };

  // Check if there are unsaved changes
  const hasUnsavedChanges =
    classification !== getInitialClassification() ||
    additionalContext !== (transaction.notes || '') ||
    businessPurpose !== (transaction.business_purpose || '') ||
    clientProject !== (transaction.client_project || '') ||
    documentationStatus !== (transaction.documentation_status || 'missing') ||
    meetingNotes !== (transaction.meeting_notes || '') ||
    receiptFile !== null;

  // Primary navigation remains visible while editing; keep the same draft guard there.
  useEffect(() => {
    const beforeNavigation = (event: Event) => {
      const href = (event as CustomEvent<{ href?: unknown }>).detail?.href;
      if (!hasUnsavedChanges || typeof href !== 'string' || !/^\/protected(?:[/?]|$)/.test(href)) return;
      event.preventDefault();
      pendingDestination.current = href;
      setShowUnsavedDialog(true);
    };
    window.addEventListener(APP_NAVIGATION_EVENT, beforeNavigation);
    return () => window.removeEventListener(APP_NAVIGATION_EVENT, beforeNavigation);
  }, [hasUnsavedChanges]);

  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 py-2 sm:px-5">
          <Button onClick={handleBackNavigation} variant="ghost" size="icon" aria-label="Back to transactions" className="h-11 w-11 shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="line-clamp-2 break-words text-base font-semibold leading-snug"><span className="sr-only">Transaction details: </span>{transaction.merchant_name || 'Transaction'}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{formatTransactionDate(transaction.date, 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })}{transaction.amount < 0 ? ' · Money in' : ' · Money out'}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-semibold tabular-nums">{formatRecordedTransactionAmount(transaction)}</p>
            <span className="text-xs text-muted-foreground" role="status">{isSaving ? 'Saving…' : hasUnsavedChanges ? 'Unsaved changes' : 'Saved'}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-3 px-3 py-3 sm:px-5">
        {isSupersededRecord(transaction) && <p role="note" className="rounded-xl border border-border bg-muted p-3 text-sm text-muted-foreground">This bank record duplicates an earlier one you already reviewed; it is excluded from totals.</p>}
        <DetailTabs.Root value={detailSection} onValueChange={changeDetailSection} className="space-y-3">
          <DetailTabs.List aria-label="Transaction sections" className="grid grid-cols-3 gap-1 rounded-xl bg-muted/70 p-1">
            {[{ value: 'summary', label: 'Summary' }, { value: 'details', label: 'Details' }, { value: 'receipt', label: 'Receipt' }].map(tab =>
              <DetailTabs.Trigger key={tab.value} value={tab.value} className="min-h-11 rounded-lg px-2 text-sm font-medium text-muted-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{tab.label}{tab.value === 'receipt' && (receiptFile || transaction.receipt_url) && <span className="ml-1 text-primary" aria-label={receiptFile ? 'selected, not uploaded' : 'attached'}>•</span>}</DetailTabs.Trigger>
            )}
          </DetailTabs.List>
          <DetailTabs.Content value="summary" className="space-y-3 focus-visible:outline-none">
            <Card className="overflow-hidden rounded-xl shadow-none motion-safe:hover:translate-y-0">
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Bot className="h-4 w-4 text-primary" />AI review</h3>
              <Button onClick={handleAnalyzeTransaction} disabled={isAnalyzing || analysisRunning || analysisBlocked} variant="ghost" size="sm" className="h-11 shrink-0 px-2 text-primary">
                {isAnalyzing || analysisRunning ? 'Analyzing…' : aiAvailability.status === 'checking' ? 'Checking AI…' : analysisBlocked ? 'AI unavailable' : 'Run AI Analysis'}
              </Button>
            </div>
            {(aiAvailability.status !== 'configured' || analysisUnavailable) && !analysisError && <div className="rounded-lg bg-muted p-3 text-sm" role="status">
              <p>{aiAvailability.message}</p>
              {aiAvailability.status === 'unavailable' && <p className="mt-1 text-xs">You can still edit notes, attach receipts and record your classification manually.</p>}
            </div>}
            {analysisError && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-800 dark:text-red-200" role="alert">
              <p className="font-medium">{analysisUnavailable ? 'AI unavailable' : 'Analysis incomplete'}</p>
              <p className="mt-1">{analysisError}</p>
              <p className="mt-2 text-xs">No new AI assessment was saved.{analysisUnavailable ? ' Try again when AI is available.' : ''}</p>
            </div>}
            {(analysisUnavailable || aiAvailability.status === 'unavailable') && <Button variant="outline" size="sm" className="h-11" onClick={checkAiAvailability} disabled={isAnalyzing || aiAvailability.status === 'checking'}>Check AI availability</Button>}

            {isAnalyzing || backgroundAnalysis ? <div className="space-y-3 py-2" role="status"><p className="text-sm text-muted-foreground">{profileRefresh ? 'Updating AI review using your new profile. Confirmed categories stay saved.' : factsRefresh ? 'Details saved. AI is updating your review automatically.' : analysisQueued ? 'Queued for automatic analysis. Results refresh here.' : 'Analyzing transaction…'}</p><div className="h-4 animate-pulse rounded bg-muted" /><div className="h-4 w-3/4 animate-pulse rounded bg-muted" /></div>
              : transaction.ai_explanation ? <div className="space-y-2"><ExplanationCard explanation={normalizeExplanation(transaction.ai_explanation)} compact onAnswer={() => changeDetailSection('details')} />{transaction.ai_suggestion && <AiTaxAnalysisDialog key={transaction.ai_suggestion.id} suggestion={transaction.ai_suggestion} />}</div>
              : transaction.ai_suggestion ? <AiTaxExplanation key={transaction.ai_suggestion.id} suggestion={transaction.ai_suggestion} compact onAddContext={() => changeDetailSection('details')} />
              : <div className="space-y-2 text-sm text-muted-foreground">
                {pipeline.outcome ? <AnalysisStatusNotice compact outcome={pipeline.outcome} accountIds={transaction.account_id ? [transaction.account_id] : []} disabled={isAnalyzing} className="text-foreground" />
                  : pipeline.state === 'queued' ? <p role="status">Queued for automatic AI analysis. A first import can take a while; run it now or review this transaction yourself.</p>
                  : <p>{transaction.deductionStatus || transaction.ai ? 'Run analysis again for a current category, tax explanation and sources.' : 'No AI suggestion yet. Add a business purpose, then run analysis.'}</p>}
                {(transaction.ai || transaction.ai_analysis || transaction.deductible_reason || transaction.reasoning) && <details className="group rounded-lg border border-border">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 font-medium [&::-webkit-details-marker]:hidden">Earlier analysis<ChevronDown className="h-4 w-4 group-open:rotate-180" /></summary>
                  <div className="space-y-2 border-t border-border p-3"><p>{transaction.reasoning || transaction.ai?.key_analysis_factors?.reasoning_summary || transaction.ai?.reasoning || transaction.ai_analysis || transaction.deductible_reason || 'No saved explanation.'}</p><p className="text-xs">Earlier guidance has not been verified against the current facts. Run analysis again before relying on it.</p></div>
                </details>}
              </div>}
            {offerPurpose && <PurposeConfirmChip key={`${analysisContext}:${proposal ?? ''}`} proposal={proposal} question={openQuestion?.kind === 'business_purpose' ? openQuestion.question : null}
              busy={proposalSaving} disabled={isSaving || isUploadingReceipt}
              onConfirm={purpose => handleProposalDecision(confirmPurposeUpdates(purpose, proposal), 'Purpose saved', 'Your answer is saved for AI review. Your tax decision is unchanged.')}
              onReject={() => handleProposalDecision(rejectProposalUpdates(), 'Marked not business', 'No deduction is recorded for this transaction.')} />}
            {bulkOffer && <BulkConfirmOffer key={`${bulkOffer.merchantKey}:${bulkOffer.decision}`} offer={bulkOffer} disabled={isSaving || proposalSaving}
              onApplied={(outcome, offer) => showSuccess('Applied to similar charges', bulkOutcomeMessage(offer, outcome))} onDismiss={() => setBulkOffer(null)} />}
            {!backgroundAnalysis && transaction.ai_suggestion && <Button className="h-11 w-full" onClick={() => navigateFromTransaction(protectedScreenUrl(`review-transactions?transactionId=${encodeURIComponent(getTransactionId(transaction))}`))}>Confirm or change category<ArrowRight className="h-4 w-4" /></Button>}
          </div>
            </Card>
          <details className="group rounded-xl border border-border bg-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><CheckCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 text-sm font-medium">Tax treatment<span className="mt-0.5 block text-xs font-normal text-muted-foreground">{transaction.is_deductible === true ? 'Deduction recorded' : transaction.is_deductible === false ? 'No deduction recorded' : 'Tax review needed'}</span></span><ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" /></summary>
            <div className="space-y-3 border-t border-border p-4">
              <p className="text-sm text-muted-foreground">Confirm business use and tax eligibility before including a deduction. Category confirmation is separate.</p>
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={() => handleClassificationChange('business')} disabled={isSaving} aria-label="Mark as business expense" aria-pressed={classification === 'business'} variant={classification === 'business' ? 'default' : 'outline'} className="h-auto min-h-11 whitespace-normal px-2 py-2">Business deduction</Button>
                <Button onClick={() => handleClassificationChange('personal')} disabled={isSaving} aria-label="Exclude from deductions" aria-pressed={classification === 'personal'} variant={classification === 'personal' ? 'default' : 'outline'} className="h-auto min-h-11 whitespace-normal px-2 py-2">No deduction</Button>
              </div>
              <p className="text-xs text-muted-foreground">Unsure? Leave unresolved for your preparer.</p>
              <Button variant="ghost" onClick={() => navigateFromTransaction(protectedScreenUrl('tax-preview'))} className="h-11 w-full justify-between px-0">Open Tax Preview<ArrowRight className="h-4 w-4" /></Button>
            </div>
          </details>
          </DetailTabs.Content>
          <DetailTabs.Content value="details" className="rounded-xl border border-border bg-card focus-visible:outline-none">
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 text-xs"><span className="text-muted-foreground">Recorded category</span><Badge variant="outline" className="max-w-full whitespace-normal rounded-md font-normal">{consolidateCategory(transaction.category).displayName}</Badge></div>
              <p className="text-xs text-muted-foreground">Add context below. Changes save automatically.</p>

              {transaction.ai_suggestion?.questions?.length ? <details className="group rounded-lg bg-muted/60">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden"><span>{transaction.ai_suggestion.questions.length} questions from AI</span><ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 group-open:rotate-180" /></summary>
                <ul className="list-disc space-y-2 px-4 pb-3 pl-7 text-sm">{transaction.ai_suggestion.questions.map(question => <li key={question}>{question}</li>)}</ul>
              </details> : null}
              <div><label htmlFor="business-purpose" className="mb-1 block text-sm font-medium">Business Purpose</label><Textarea id="business-purpose" placeholder="Why was this expense necessary for your business?" value={businessPurpose} onChange={e => { const next = e.target.value; setBusinessPurpose(next); debouncedSave({ business_purpose: next }); }} className="min-h-20 rounded-lg bg-background" maxLength={500} /></div>
              <EvidenceImportDialog key={`calendar-${analysisContext}`} kind="calendar" transactionId={getTransactionId(transaction)} transactionDate={transaction.date} merchant={transaction.merchant_name} onAttachReceipt={attachEvidenceReceipt} onConfirmPurpose={confirmCalendarPurpose} />
              <Button onClick={handleAnalyzeTransaction} disabled={isAnalyzing || analysisBlocked} className="min-h-11 w-full">{isAnalyzing ? 'Analyzing…' : 'Update AI review'}<ArrowRight className="h-4 w-4" /></Button>
              {analysisError && <p role="alert" className="text-sm text-destructive">{analysisError}</p>}
              {analysisBlocked && !analysisError && <p role="status" className="text-xs text-muted-foreground">{aiAvailability.status === 'checking' ? 'Checking AI availability…' : 'AI is unavailable. Your details still save.'}</p>}
              <details className="group border-t border-border">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">More details & notes<ChevronDown aria-hidden="true" className="h-4 w-4 group-open:rotate-180" /></summary>
                <div className="space-y-3 pb-2">
              <div><label htmlFor="client-project" className="mb-1 block text-sm font-medium">Client/Project</label><input id="client-project" type="text" placeholder="Associated client or project name" value={clientProject} onChange={e => { const next = e.target.value; setClientProject(next); debouncedSave({ client_project: next }); }} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm" maxLength={100} /></div>
              <div><label htmlFor="transaction-notes" className="mb-1 block text-sm font-medium">Notes</label><Textarea id="transaction-notes" placeholder="Tell us more about this purchase..." value={additionalContext} onChange={e => { const next = e.target.value; setAdditionalContext(next); debouncedSave({ notes: next }); }} className="min-h-20 rounded-lg bg-background" /></div>
              <div><label htmlFor="documentation-status" className="mb-1 block text-sm font-medium">Documentation Status</label><select id="documentation-status" value={documentationStatus || 'missing'} onChange={e => { const next = e.target.value as 'complete' | 'partial' | 'missing'; setDocumentationStatus(next); debouncedSave({ documentation_status: next }); }} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"><option value="missing">Missing</option><option value="partial">Partial</option><option value="complete">Complete</option></select></div>
              <div><label htmlFor="meeting-notes" className="mb-1 block text-sm font-medium">Meeting Notes</label><Textarea id="meeting-notes" placeholder="Notes about business meetings or discussions" value={meetingNotes} onChange={e => { const next = e.target.value; setMeetingNotes(next); debouncedSave({ meeting_notes: next }); }} className="min-h-20 rounded-lg bg-background" maxLength={500} /></div>
              <div className="space-y-1 rounded-lg bg-muted p-3 text-xs text-muted-foreground"><p className="font-medium text-foreground">Original transaction details</p><p className="break-words">{transaction.merchant_name || 'Transaction'}</p>{transaction.description && <p className="break-words">{transaction.description}</p>}{transaction.datetime && <p>{new Date(transaction.datetime).toLocaleString()}</p>}</div>
                </div>
              </details>

            </div>
          </DetailTabs.Content>
          <DetailTabs.Content value="receipt" className="rounded-xl border border-border bg-card focus-visible:outline-none">
            <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">Receipt</h2><span className="text-xs text-muted-foreground">{transaction.receipt_url ? 'Attached' : 'No receipt yet'}</span></div>
            <div className="space-y-3 p-4">
              {transaction.receipt_url ? <div className="space-y-2">
                <p className="break-words text-sm">{transaction.receipt_filename || 'Receipt attached'}</p>
                <div className="flex flex-wrap items-center gap-2"><ReceiptPreview key={transaction.receipt_url} url={transaction.receipt_url} filename={transaction.receipt_filename} /><Button variant="outline" size="sm" onClick={handleReceiptDelete} className="h-11 text-destructive"><Trash2 className="h-4 w-4" />Delete</Button></div>
              </div> : showCamera ? <div className="space-y-3">
                <video ref={videoRef} autoPlay muted playsInline className="max-h-64 w-full rounded-lg bg-black object-cover" />
                <div className="flex gap-2"><Button onClick={takePhoto} className="h-11 flex-1"><Camera className="h-4 w-4" />Take Photo</Button><Button onClick={stopCamera} variant="outline" className="h-11 flex-1">Cancel</Button></div>
                <canvas ref={canvasRef} className="hidden" />
              </div> : <>
                <div className="flex gap-2"><Button onClick={startCamera} variant="outline" className="h-11 flex-1"><Camera className="h-4 w-4" />Photo</Button><input type="file" id="receipt-upload" accept="image/*,.pdf" onChange={handleReceiptFileSelect} className="hidden" /><Button variant="outline" onClick={() => document.getElementById('receipt-upload')?.click()} className="h-11 flex-1"><Upload className="h-4 w-4" />Choose file</Button></div>
                <p className="text-xs text-muted-foreground">JPG, PNG, GIF or PDF · up to 10 MB</p>
                {receiptFile && <div className="space-y-2 rounded-lg bg-muted p-3"><p className="break-words text-sm">{receiptFile.name}</p><Button onClick={handleReceiptUpload} disabled={isUploadingReceipt} className="h-11 w-full">{isUploadingReceipt ? 'Uploading…' : 'Upload receipt'}</Button></div>}
              </>}
              <EvidenceImportDialog key={`email-${analysisContext}`} kind="email" transactionId={getTransactionId(transaction)} transactionDate={transaction.date} merchant={transaction.merchant_name} hasReceipt={!!transaction.receipt_url} onAttachReceipt={attachEvidenceReceipt} onConfirmPurpose={confirmCalendarPurpose} />
            </div>
          </DetailTabs.Content>
        </DetailTabs.Root>
      </div>

      {hasUnsavedChanges && <div className="sticky bottom-0 z-20 border-t border-border bg-background/95 px-3 py-2 backdrop-blur" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{receiptFile ? 'Upload your selected receipt to attach it.' : isSaving ? 'Saving changes…' : 'Review and save your changes.'}</span>
          <Button onClick={receiptFile ? handleReceiptUpload : handleSaveChanges} disabled={isSaving || isUploadingReceipt} className="h-11 shrink-0">{isUploadingReceipt ? 'Uploading…' : isSaving ? 'Saving...' : receiptFile ? 'Upload receipt' : 'Save Changes'}</Button>
        </div>
      </div>}

      <ConfirmationDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog} title="Unsaved Changes" description="You have unsaved changes. Are you sure you want to leave? Your changes will be lost." confirmLabel="Leave" cancelLabel="Stay" variant="destructive" onConfirm={() => { setShowUnsavedDialog(false); performBackNavigation(); }} onCancel={() => setShowUnsavedDialog(false)} />
    </div>
  );
};
