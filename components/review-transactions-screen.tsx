"use client";

import React, { useState, useEffect } from 'react';
import { useState as useReactState, useRef } from 'react';

// Modal for Ask a CPA (matches Transaction Details page)
const AskCpaModal: React.FC<{
  open: boolean;
  onClose: () => void;
  transaction: Transaction;
  userEmail?: string;
}> = ({ open, onClose, transaction, userEmail }) => {
  const [question, setQuestion] = useReactState('');
  const [isSubmitting, setIsSubmitting] = useReactState(false);
  const [success, setSuccess] = useReactState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!question.trim()) return;
    setIsSubmitting(true);
    try {
      // Simulate API call (replace with real endpoint if needed)
      await fetch('/api/cpa-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: transaction.trans_id || transaction.id,
          merchantName: transaction.merchant_name,
          amount: transaction.amount,
          date: transaction.date,
          category: transaction.category,
          question: question.trim(),
          userEmail,
        }),
      });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setQuestion('');
        onClose();
      }, 1800);
    } catch (e) {
      alert('Failed to submit your question. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30 p-4">
      <div className="bg-card rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 md:p-6">
          {/* Modal Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <HelpCircle className="w-6 h-6 md:w-7 md:h-7 text-primary" />
              <div>
                <h2 className="text-lg md:text-xl font-semibold text-foreground">Ask a CPA</h2>
                <p className="text-xs md:text-sm text-muted-foreground">Get expert tax advice on this transaction</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 md:w-8 md:h-8 bg-muted rounded-full flex items-center justify-center hover:bg-muted/80 transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0"
              aria-label="Close"
            >
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>

          {/* Transaction Context */}
          <div className="bg-muted border border-border rounded-lg p-4 mb-6">
            <h3 className="font-medium text-foreground mb-2 text-sm md:text-base">Transaction Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 text-sm">
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
                <span className="ml-1 text-foreground font-medium">{transaction.date ? new Date(transaction.date).toLocaleDateString('en-US') : '-'}</span>
              </div>
              <div>
                <span className="font-semibold text-foreground">Category:</span>
                <span className="ml-1 text-foreground font-medium break-words">{transaction.category || '-'}</span>
              </div>
            </div>
          </div>

          {/* Question Form */}
          <div className="space-y-4">
            <div>
              <label htmlFor="cpa-question" className="block font-medium text-foreground mb-1 text-sm md:text-base">Your Question</label>
              <textarea
                id="cpa-question"
                ref={textareaRef}
                placeholder="Ask about deductibility, documentation requirements, or any other tax-related questions about this transaction..."
                value={question}
                onChange={e => setQuestion(e.target.value)}
                className="w-full min-h-[120px] rounded-lg border border-border bg-card p-3 text-sm md:text-base min-h-[100px]"
                maxLength={1000}
                disabled={isSubmitting || success}
              />
              <div className="text-xs text-muted-foreground mt-1 flex justify-between">
                <span>Be specific about your business use case and any concerns you have</span>
                <span>{question.length}/1000</span>
              </div>
            </div>
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
                <div className="text-xs text-foreground">
                  <div className="font-semibold mb-1">What to expect</div>
                  <ul className="list-disc pl-5">
                    <li>Our CPA team will review your question within 24 hours</li>
                    <li>You'll receive a detailed response via email</li>
                    <li>The response will include specific guidance for your situation</li>
                    <li>Follow-up questions are welcome</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <Button
              onClick={onClose}
              variant="outline"
              className="flex-1 min-h-[44px] rounded-lg"
              disabled={isSubmitting || success}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!question.trim() || isSubmitting || success}
              className="flex-1 min-h-[44px] rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold"
            >
              {success ? 'Sent!' : isSubmitting ? 'Sending...' : 'Send Question'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CheckCircle, XCircle, AlertTriangle, HelpCircle, Info, ChevronRight, Tag, SkipForward } from 'lucide-react';
import { updateProgress, setTotalPages } from '@/lib/firebase/progress';

interface Transaction {
  id: string;
  trans_id: string;
  merchant_name: string;
  amount: number;
  category: string;
  date: string;
  type?: 'expense' | 'income';
  is_deductible?: boolean | null;
  deductible_reason?: string;
  deduction_score?: number;
  ai_analysis?: string; // Original AI analysis text - never overwritten
  user_classification_reason?: string; // User's reason for classification
  description?: string;
  notes?: string;

  // AI analysis data
  ai?: {
    status_label?: string | null;
    score_pct?: number | null;
    reasoning?: string | null;
    irs?: { publication?: string | null; section?: string | null } | null;
    required_docs?: string[];
    category_hint?: string | null;
    risk_flags?: string[];
    model?: string;
    last_analyzed_at?: number | null;
  } | null;

  // Analysis status
  analyzed?: boolean;
  analysisStatus?: 'pending' | 'running' | 'completed' | 'failed';
}

interface ReviewTransactionsScreenProps {
  user: { id: string; email?: string; user_metadata?: { name?: string } };
  onBack: () => void;
  transactions: Transaction[];
  onTransactionUpdate: (updatedTransaction: Transaction) => void;
  onTransactionClick?: (transaction: Transaction) => void;
}

export const ReviewTransactionsScreen: React.FC<ReviewTransactionsScreenProps> = ({
  user,
  onBack,
  transactions,
  onTransactionUpdate,
  onTransactionClick
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const [touchOffset, setTouchOffset] = useState(0);
  // Analysis status variables removed - analysis is handled by account usage page
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [originalTotal, setOriginalTotal] = useState(0);
  const [askCpaOpen, setAskCpaOpen] = useState(false);

  // Local state to track classified transactions for immediate UI feedback
  const [classifiedTransactionIds, setClassifiedTransactionIds] = useState<Set<string>>(new Set());

  // Needs review = transactions that need either AI analysis or manual review
  const needsReviewTransactions = transactions.filter(t => {
    // Immediately exclude transactions that have just been classified (optimistic UI update)
    const transId = (t as any).trans_id || t.id;
    if (classifiedTransactionIds.has(transId)) {
      console.log('🚫 [Optimistic] Excluding classified transaction:', transId);
      return false;
    }
    
    // Use the same logic as dashboard for consistency: is_deductible === null
    // This ensures the counts match between dashboard and review screen
    const needsReview = t.is_deductible === null;
    
    if (needsReview) {
      console.log('✅ [Filter] Transaction needs review:', transId, t.merchant_name);
    }
    
    return needsReview;
  });

  // Debug logging
  console.log('🔍 [Review Screen] Total transactions:', transactions.length);
  console.log('🔍 [Review Screen] Transactions needing review:', needsReviewTransactions.length);
  console.log('🔍 [Review Screen] Classified transaction IDs:', Array.from(classifiedTransactionIds));
  console.log('🔍 [Review Screen] Sample transaction:', transactions[0]);
  console.log('🔍 [Review Screen] Sample needs review:', needsReviewTransactions[0]);

  const currentTransaction = needsReviewTransactions[currentIndex];

  // No auto-analysis needed - analysis is triggered from account usage page
  // Review screen just displays the results

  // Set original total when component first loads
  useEffect(() => {
    if (needsReviewTransactions.length > 0 && originalTotal === 0) {
      setOriginalTotal(needsReviewTransactions.length);
      console.log('📊 [Progress] Set original total to:', needsReviewTransactions.length);
    }
  }, [needsReviewTransactions.length, originalTotal]);

  // Set total pages for progress tracking when component mounts
  useEffect(() => {
    if (needsReviewTransactions.length > 0 && user.id) {
      setTotalPages(user.id, needsReviewTransactions.length).catch(console.error);
    }
  }, [needsReviewTransactions.length, user.id]);

  // Handle transaction array changes and adjust currentIndex
  useEffect(() => {
    // If currentIndex is out of bounds after array changes, reset to 0
    if (needsReviewTransactions.length > 0 && currentIndex >= needsReviewTransactions.length) {
      console.log('🔄 [Index Reset] Array length changed, resetting index from', currentIndex, 'to 0');
      setCurrentIndex(0);
    }
  }, [needsReviewTransactions.length, currentIndex]);

  // Auto-analysis functions removed - analysis is handled by account usage page

  const handleSwipe = (direction: 'left' | 'right') => {
    if (!currentTransaction || isProcessing) return;

    setSwipeDirection(direction);
    const isDeductible = direction === 'right';
    handleClassification(currentTransaction, isDeductible);
  };

  const handleSkip = async () => {
    if (!currentTransaction || isProcessing) return;
    
    setIsProcessing(true);
    console.log('⏭️ [Skip] Skipping transaction:', currentTransaction.id);

    try {
      // Try to update the transaction in the database
      const updateData = {
        user_classification_reason: 'Skipped by user - keeping AI analysis'
      };

      const transactionId = (currentTransaction as any).trans_id || currentTransaction.id;
      
      try {
        const { makeAuthenticatedRequest } = await import('@/lib/firebase/api-client');
        const response = await makeAuthenticatedRequest(`/api/transactions/${transactionId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updateData),
        });

        if (response.ok) {
          console.log('✅ [Skip] Transaction updated in database');
          
          // Immediately add transaction to classified set for instant UI feedback
          const transId = (currentTransaction as any).trans_id || currentTransaction.id;
          setClassifiedTransactionIds(prev => {
            const newSet = new Set([...prev, transId]);
            console.log('✅ [Optimistic Update] Added skipped transaction to classified set:', transId, 'New set:', Array.from(newSet));
            return newSet;
          });
        } else {
          console.warn('⚠️ [Skip] Failed to update database, but continuing with skip');
        }
      } catch (dbError) {
        console.warn('⚠️ [Skip] Database update failed, but continuing with skip:', dbError);
      }

      // Always move to next transaction regardless of database update success
      if (currentIndex < needsReviewTransactions.length - 1) {
        setCurrentIndex(currentIndex + 1);
        console.log('✅ [Skip] Moved to next transaction');
      } else {
        console.log('✅ [Skip] Reached end of transactions');
      }
      
      // Update progress - pass the current transaction with skip status
      if (onTransactionUpdate && currentTransaction) {
        const updatedTransaction = {
          ...currentTransaction,
          user_classification_reason: 'Skipped by user - keeping AI analysis'
        };
        onTransactionUpdate(updatedTransaction);
      }
      
    } catch (error) {
      console.error('❌ [Skip] Error in skip process:', error);
      // Still try to move to next transaction even if there's an error
      if (currentIndex < needsReviewTransactions.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    setTouchStart({ x: touch.clientX, y: touch.clientY });
    setTouchOffset(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStart) return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = Math.abs(touch.clientY - touchStart.y);

    // Only track horizontal swipes
    if (deltaY < 50) {
      setTouchOffset(deltaX);
    }
  };

  const handleTouchEnd = () => {
    if (!touchStart || !currentTransaction) {
      setTouchStart(null);
      setTouchOffset(0);
      return;
    }

    const threshold = 100; // Minimum distance for a swipe

    if (Math.abs(touchOffset) > threshold) {
      if (touchOffset < 0) {
        handleSwipe('left'); // Swipe left = Personal
      } else {
        handleSwipe('right'); // Swipe right = Deductible
      }
    }

    setTouchStart(null);
    setTouchOffset(0);
  };

  const handleClassification = async (transaction: Transaction, isDeductible: boolean) => {
    if (isProcessing) return;
    setIsProcessing(true);

    console.log('🎯 [UI RERENDER] Starting classification for transaction:', transaction.trans_id || transaction.id, 'isDeductible:', isDeductible);
    console.log('🎯 [UI RERENDER] Full transaction object:', transaction);

    try {
      const updateData = {
        is_deductible: isDeductible,
        user_classification_reason: isDeductible
          ? 'Classified as business expense by user'
          : 'Classified as personal expense by user',
        deduction_score: isDeductible ? 1.0 : 0.0
      };

      console.log('📝 [UI RERENDER] Calling API to update transaction with:', updateData);
      console.log('📝 [UI RERENDER] Using transaction ID:', transaction.trans_id || transaction.id, 'trans_id:', transaction.trans_id);

      // Use trans_id if available, otherwise fall back to id
      const transactionId = (transaction as any).trans_id || transaction.id;
      console.log('📝 [UI RERENDER] Final transaction ID for API:', transactionId);

      // Use the authenticated request helper
      const { makeAuthenticatedRequest } = await import('@/lib/firebase/api-client');
      const response = await makeAuthenticatedRequest(`/api/transactions/${transactionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        console.error('❌ [UI RERENDER] API update failed:', {
          status: response.status,
          statusText: response.statusText,
          result: result,
          response: response,
          transactionId: transactionId,
          updateData: updateData
        });

        // Show detailed user-friendly error message
        let errorMessage = `Failed to update transaction: ${result.error || 'Unknown error'}`;
        if (response.status === 401) {
          errorMessage = 'Authentication failed. Please sign in again.';
        } else if (response.status === 403) {
          errorMessage = 'Permission denied. You may not have access to update this transaction.';
        } else if (response.status === 404) {
          errorMessage = 'Transaction not found. It may have been deleted or moved.';
        } else if (response.status >= 500) {
          errorMessage = 'Server error. Please try again later or contact support if the problem persists.';
        }
        
        alert(errorMessage);
        return;
      }

      console.log('✅ [UI RERENDER] API update successful:', result.transaction);

      // Immediately add transaction to classified set for instant UI feedback
      const transId = (transaction as any).trans_id || transaction.id;
      setClassifiedTransactionIds(prev => {
        const newSet = new Set([...prev, transId]);
        console.log('✅ [Optimistic Update] Added transaction to classified set:', transId, 'New set:', Array.from(newSet));
        return newSet;
      });

      // Update progress tracking
      try {
        await updateProgress(user.id, transaction.trans_id || transaction.id, isDeductible ? 'deductible' : 'personal');
        console.log('✅ [Progress] Progress updated for transaction:', transaction.trans_id || transaction.id);
      } catch (progressError) {
        console.error('❌ [Progress] Failed to update progress:', progressError);
        // Don't fail the transaction update if progress update fails
      }

      // Update the transaction in the parent state
      const updated: Transaction = {
        ...transaction,
        is_deductible: isDeductible,
        user_classification_reason: updateData.user_classification_reason,
        deduction_score: updateData.deduction_score
      };

      console.log('🔄 [Classification] Updating parent state with:', updated.trans_id || updated.id, updated.is_deductible);
      onTransactionUpdate(updated);

      // Show success message
      const message = isDeductible ? 'Marked as business expense' : 'Marked as personal expense';
      setSuccessMessage(message);
      setShowSuccessMessage(true);

      // Hide success message after 1.5 seconds
      setTimeout(() => {
        setShowSuccessMessage(false);
      }, 1500);

      // Clear swipe direction immediately for better UX
      setSwipeDirection(null);

      // Increment the currentIndex to show progress
      // This ensures the progress bar increases and shows "2 of 19", "3 of 18", etc.
      const newIndex = currentIndex < needsReviewTransactions.length - 1 ? currentIndex + 1 : 0;
      console.log('📊 [Progress] Updating index:', {
        currentIndex,
        newIndex,
        arrayLength: needsReviewTransactions.length,
        originalTotal,
        progress: `${newIndex + 1} of ${originalTotal}`
      });

      if (currentIndex < needsReviewTransactions.length - 1) {
        setCurrentIndex(prev => prev + 1);
      } else {
        // If this was the last transaction, reset to 0
        // The empty state will be shown on next render
        setCurrentIndex(0);
      }

    } catch (e: any) {
      console.error('❌ [UI RERENDER] Unexpected update error:', {
        error: e,
        message: e.message,
        stack: e.stack,
        transactionId: transactionId,
        updateData: updateData
      });

      // Show detailed user-friendly error message
      let errorMessage = `Unexpected error updating transaction: ${e.message || 'Unknown error'}`;
      if (e.name === 'TypeError' && e.message.includes('fetch')) {
        errorMessage = 'Network error. Please check your internet connection and try again.';
      } else if (e.message && e.message.includes('auth')) {
        errorMessage = 'Authentication error. Please sign in again.';
      } else if (e.message && e.message.includes('permission')) {
        errorMessage = 'Permission error. You may not have access to update this transaction.';
      }
      
      alert(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatCategory = (category: string): string => {
    if (!category) return 'Uncategorized';
    return category
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' & ');
  };

  if (needsReviewTransactions.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          {/* Main Card */}
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-xl border border-white/20 p-8 text-center">
            {/* Main Icon */}
            <div className="mb-6">
              {transactions.length === 0 ? (
                <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center mx-auto shadow-lg">
                  <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              ) : (
                <div className="relative">
                  <div className="w-20 h-20 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-lg">
                    <CheckCircle className="w-10 h-10 text-white" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                  </div>
                </div>
              )}
            </div>

            {/* Content */}
            <h2 className="text-2xl font-bold text-gray-900 mb-3">
              {transactions.length === 0 ? 'Ready to Get Started!' : 'All Caught Up!'}
            </h2>
            
            <p className="text-gray-600 mb-8 leading-relaxed">
              {transactions.length === 0
                ? 'Connect your bank account to start analyzing transactions and maximizing your tax deductions.'
                : `Great job! You've reviewed all transactions. You have ${transactions.length} total transactions in your account.`
              }
            </p>

            {/* Action Buttons */}
            <div className="space-y-4">
              {transactions.length === 0 ? (
                <>
                  <Button
                    onClick={() => window.location.href = '/protected?screen=plaid'}
                    className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold py-3 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Connect Bank Account
                  </Button>
                  <Button
                    onClick={onBack}
                    variant="outline"
                    className="w-full border-2 border-gray-200 hover:border-gray-300 text-gray-700 font-medium py-3 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Dashboard
                  </Button>
                </>
              ) : (
                <Button
                  onClick={onBack}
                  className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-semibold py-3 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Dashboard
                </Button>
              )}
            </div>

            {/* Additional Info */}
            {transactions.length > 0 && (
              <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
                <div className="flex items-center justify-center gap-2 text-blue-700">
                  <Info className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    New transactions will appear here for review
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Decorative Elements */}
          <div className="absolute top-10 left-10 w-20 h-20 bg-blue-200/30 rounded-full blur-xl"></div>
          <div className="absolute bottom-10 right-10 w-32 h-32 bg-indigo-200/30 rounded-full blur-xl"></div>
        </div>
      </div>
    );
  }

  if (currentIndex >= needsReviewTransactions.length) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-green-50 to-teal-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          {/* Main Card */}
          <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-xl border border-white/20 p-8 text-center">
            {/* Success Icon */}
            <div className="relative mb-6">
              <div className="w-20 h-20 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-lg">
                <CheckCircle className="w-10 h-10 text-white" />
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
              </div>
            </div>

            {/* Content */}
            <h2 className="text-2xl font-bold text-gray-900 mb-3">Review Complete!</h2>
            
            <p className="text-gray-600 mb-8 leading-relaxed">
              Excellent work! You've successfully reviewed all transactions that needed attention. 
              Your tax deductions are now properly categorized and ready for filing.
            </p>

            {/* Action Button */}
            <Button
              onClick={onBack}
              className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-semibold py-3 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Button>

            {/* Success Stats */}
            <div className="mt-6 p-4 bg-emerald-50 rounded-xl border border-emerald-100">
              <div className="flex items-center justify-center gap-2 text-emerald-700">
                <CheckCircle className="w-4 h-4" />
                <span className="text-sm font-medium">
                  All transactions reviewed and categorized
                </span>
              </div>
            </div>
          </div>

          {/* Decorative Elements */}
          <div className="absolute top-10 left-10 w-20 h-20 bg-emerald-200/30 rounded-full blur-xl"></div>
          <div className="absolute bottom-10 right-10 w-32 h-32 bg-green-200/30 rounded-full blur-xl"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4">
        {/* Sticky Header */}
        <div className="sticky top-0 bg-gray-50 z-10 py-4">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>

            <div className="text-center">
              <h1 className="text-lg font-semibold text-gray-900">Review Transactions</h1>
              <div className="flex flex-col items-center gap-1">
                <p className="text-xs text-slate-500">
                  {currentIndex + 1} of {originalTotal || needsReviewTransactions.length}
                </p>
                <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{
                      width: `${originalTotal > 0 ? ((currentIndex + 1) / originalTotal) * 100 : 0}%`
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="w-9 h-9" /> {/* Spacer for alignment */}
          </div>

          <div className="border-b border-slate-200 mb-4" />

          <p className="text-center text-xs text-slate-600">
            Swipe right to deduct • Swipe left for personal • Use Skip to keep AI analysis
          </p>

          {/* Success Message */}
          {showSuccessMessage && (
            <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg mx-4 animate-in slide-in-from-top-2 duration-300">
              <div className="flex items-center justify-center gap-3 text-emerald-700">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <span className="font-medium text-sm">{successMessage}</span>
              </div>
            </div>
          )}
        </div>

        {/* Main Card */}
        <div className="pb-6">
          <div
            className={`rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-300 ${swipeDirection === 'right' ? 'transform translate-x-8 opacity-80 bg-green-50' :
                swipeDirection === 'left' ? 'transform -translate-x-8 opacity-80 bg-red-50' :
                  isProcessing ? 'scale-[0.98]' : ''
              }`}
            style={{
              transform: `translateX(${Math.max(-150, Math.min(150, touchOffset))}px)`,
              opacity: Math.abs(touchOffset) > 50 ? 0.8 : 1
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className="p-5 sm:p-6">
              {/* Title Row */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold text-gray-900 truncate">
                    {currentTransaction.merchant_name}
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    {new Date(currentTransaction.date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric'
                    })}
                  </p>
                </div>
                <div className="text-xl font-semibold text-gray-900">
                  ${Math.abs(currentTransaction.amount).toFixed(2)}
                </div>
              </div>

              {/* View Details Button */}
              <button
                onClick={() => onTransactionClick?.({ ...currentTransaction, _source: 'review-transactions' })}
                className="w-full flex items-center justify-between p-3 border bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                aria-label="View transaction details"
              >
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-medium text-slate-700">View Details</span>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>

              {/* Category Pill */}
              <div className="mb-4">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-100 rounded-full text-xs font-medium">
                  <Tag className="w-3 h-3" />
                  {formatCategory(currentTransaction.category)}
                </div>
              </div>

              {/* Description Section */}
              <div className="mb-4">
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-2">
                  DESCRIPTION
                </div>
                <p className="text-sm text-slate-800">
                  {currentTransaction.description || currentTransaction.deductible_reason || 'No additional details available'}
                </p>
              </div>

              {/* AI Analysis Section */}
              <div className="mb-6">
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide mb-2">
                  AI ANALYSIS
                </div>
                {currentTransaction.ai?.reasoning ? (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-800">
                      {currentTransaction.ai.status_label === 'Likely Deductible' 
                        ? `This ${currentTransaction.merchant_name} transaction appears to be a business expense that may qualify for tax deduction.`
                        : currentTransaction.ai.status_label === 'Not Deductible'
                        ? `This ${currentTransaction.merchant_name} transaction appears to be a personal expense and is not tax deductible.`
                        : `This ${currentTransaction.merchant_name} transaction requires further review to determine tax deductibility.`
                      }
                    </p>
                    {currentTransaction.ai.status_label && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-500">Status:</span>
                        <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                          {currentTransaction.ai.status_label}
                        </span>
                      </div>
                    )}
                    {typeof currentTransaction.ai.score_pct === 'number' && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-500">Confidence:</span>
                        <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">
                          {currentTransaction.ai.score_pct}%
                        </span>
                      </div>
                    )}

                    {/* Key Analysis Factors */}
                    <div>
                      <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                        KEY ANALYSIS FACTORS
                      </h4>
                      <ul className="text-xs text-slate-600 space-y-1">
                        <li>• <strong>Date:</strong> {new Date(currentTransaction.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}</li>
                        <li>• <strong>Deduction Status:</strong> {currentTransaction.ai?.status_label || 'Not Analyzed'}</li>
                        <li>• <strong>Reasoning:</strong> {currentTransaction.ai?.reasoning || 'Professional analysis pending'}</li>
                        {(currentTransaction.ai?.irs?.publication || currentTransaction.ai?.irs?.section) && (
                          <li>• <strong>IRS Reference:</strong> {currentTransaction.ai?.irs?.publication ? `Publication ${currentTransaction.ai.irs.publication}` : ''}{currentTransaction.ai?.irs?.publication && currentTransaction.ai?.irs?.section ? ', ' : ''}{currentTransaction.ai?.irs?.section ? `Section ${currentTransaction.ai.irs.section}` : ''}</li>
                        )}
                      </ul>
                    </div>
                  </div>
                ) : currentTransaction.ai_analysis ? (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-800">
                      {currentTransaction.ai_analysis}
                    </p>

                    {/* Key Analysis Factors */}
                    <div>
                      <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                        KEY ANALYSIS FACTORS
                      </h4>
                      <ul className="text-xs text-slate-600 space-y-1">
                        <li>• <strong>Date:</strong> {new Date(currentTransaction.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}</li>
                        <li>• <strong>Deduction Status:</strong> {currentTransaction.ai?.status_label || 'Not Analyzed'}</li>
                        <li>• <strong>Reasoning:</strong> {currentTransaction.ai?.reasoning || 'Professional analysis pending'}</li>
                        {(currentTransaction.ai?.irs?.publication || currentTransaction.ai?.irs?.section) && (
                          <li>• <strong>IRS Reference:</strong> {currentTransaction.ai?.irs?.publication ? `Publication ${currentTransaction.ai.irs.publication}` : ''}{currentTransaction.ai?.irs?.publication && currentTransaction.ai?.irs?.section ? ', ' : ''}{currentTransaction.ai?.irs?.section ? `Section ${currentTransaction.ai.irs.section}` : ''}</li>
                        )}
                      </ul>
                    </div>
                  </div>
                ) : currentTransaction.deductible_reason ? (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-800">
                      {currentTransaction.deductible_reason}
                    </p>

                    {/* Key Analysis Factors */}
                    <div>
                      <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                        KEY ANALYSIS FACTORS
                      </h4>
                      <ul className="text-xs text-slate-600 space-y-1">
                        <li>• <strong>Date:</strong> {new Date(currentTransaction.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}</li>
                        <li>• <strong>Deduction Status:</strong> {currentTransaction.ai?.status_label || 'Not Analyzed'}</li>
                        <li>• <strong>Reasoning:</strong> {currentTransaction.ai?.reasoning || 'Professional analysis pending'}</li>
                        {(currentTransaction.ai?.irs?.publication || currentTransaction.ai?.irs?.section) && (
                          <li>• <strong>IRS Reference:</strong> {currentTransaction.ai?.irs?.publication ? `Publication ${currentTransaction.ai.irs.publication}` : ''}{currentTransaction.ai?.irs?.publication && currentTransaction.ai?.irs?.section ? ', ' : ''}{currentTransaction.ai?.irs?.section ? `Section ${currentTransaction.ai.irs.section}` : ''}</li>
                        )}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-800">
                      {`${formatCategory(currentTransaction.category)} at ${currentTransaction.merchant_name} are commonly deductible for freelancer/creator businesses. Keep detailed records of services provided and business purpose.`}
                    </p>

                    {/* Key Analysis Factors */}
                    <div>
                      <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                        KEY ANALYSIS FACTORS
                      </h4>
                      <ul className="text-xs text-slate-600 space-y-1">
                        <li>• <strong>Date:</strong> {new Date(currentTransaction.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}</li>
                        <li>• <strong>Deduction Status:</strong> {currentTransaction.ai?.status_label || 'Not Analyzed'}</li>
                        <li>• <strong>Reasoning:</strong> {currentTransaction.ai?.reasoning || 'Professional analysis pending'}</li>
                        {(currentTransaction.ai?.irs?.publication || currentTransaction.ai?.irs?.section) && (
                          <li>• <strong>IRS Reference:</strong> {currentTransaction.ai?.irs?.publication ? `Publication ${currentTransaction.ai.irs.publication}` : ''}{currentTransaction.ai?.irs?.publication && currentTransaction.ai?.irs?.section ? ', ' : ''}{currentTransaction.ai?.irs?.section ? `Section ${currentTransaction.ai.irs.section}` : ''}</li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Rail */}
            <div className="border-t border-slate-200 p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => handleSwipe('left')}
                  disabled={isProcessing}
                  className="flex items-center gap-2 text-rose-600 hover:text-rose-700 transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 rounded-lg p-2 min-h-[40px] disabled:opacity-50"
                  aria-label="Mark as personal expense"
                >
                  <XCircle className="w-5 h-5" />
                  <span className="font-medium">Personal</span>
                </button>

                {/* Skip Button */}
                <button
                  onClick={handleSkip}
                  disabled={isProcessing}
                  className="flex items-center gap-2 text-gray-600 hover:text-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 rounded-lg p-2 min-h-[40px] disabled:opacity-50"
                  aria-label="Skip transaction"
                >
                  <SkipForward className="w-5 h-5" />
                  <span className="font-medium">Skip</span>
                </button>

                {/* Ask a CPA Button */}
                <div className="flex flex-col items-center mx-2" style={{ minWidth: 0 }}>
                  <Button
                    variant="outline"
                    className="flex items-center gap-2 px-5 py-2 text-purple-700 border border-purple-300 bg-white hover:bg-purple-50 hover:border-purple-400 focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 rounded-lg shadow-sm font-semibold transition-colors"
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={() => setAskCpaOpen(true)}
                  >
                    <HelpCircle className="w-5 h-5 mr-1 text-purple-500" />
                    Ask a CPA
                  </Button>
                </div>

                <button
                  onClick={() => handleSwipe('right')}
                  disabled={isProcessing}
                  className="flex items-center gap-2 text-green-600 hover:text-green-700 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 rounded-lg p-2 min-h-[40px] disabled:opacity-50"
                  aria-label="Mark as deductible expense"
                >
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">Deductible</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Ask a CPA Modal */}
      <AskCpaModal open={askCpaOpen} onClose={() => setAskCpaOpen(false)} transaction={currentTransaction} userEmail={user?.email} />
    </div>
  );
};
