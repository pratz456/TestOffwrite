"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { useToasts } from '@/components/ui/toast';
import { Wrench, CheckCircle, AlertTriangle } from 'lucide-react';

interface FixAnalysisButtonProps {
  onAnalysisFixed?: () => void;
}

export const FixAnalysisButton: React.FC<FixAnalysisButtonProps> = ({ onAnalysisFixed }) => {
  const [isFixing, setIsFixing] = useState(false);
  const { showSuccess, showError } = useToasts();

  const handleFixAnalysis = async () => {
    if (isFixing) return;
    
    setIsFixing(true);
    
    try {
      console.log('🔧 [Fix Analysis] Starting analysis fix...');
      
      const response = await makeAuthenticatedRequest('/api/fix-transaction-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to fix analysis');
      }

      console.log('✅ [Fix Analysis] Fix completed:', result);
      
      // Show success message with details
      const { summary } = result;
      let message = `Analysis fix completed! `;
      
      if (summary.fixed > 0) {
        message += `${summary.fixed} transactions were fixed and will be re-analyzed. `;
      }
      
      if (summary.already_ok > 0) {
        message += `${summary.already_ok} transactions already had proper analysis. `;
      }
      
      if (summary.pending_initial > 0) {
        message += `${summary.pending_initial} transactions need initial analysis.`;
      }
      
      showSuccess('Analysis Fix Complete', message);
      
      // Call the callback to refresh data
      if (onAnalysisFixed) {
        onAnalysisFixed();
      }
      
    } catch (error) {
      console.error('❌ [Fix Analysis] Error fixing analysis:', error);
      showError('Fix Failed', `Failed to fix analysis: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsFixing(false);
    }
  };

  return (
    <Button
      onClick={handleFixAnalysis}
      disabled={isFixing}
      variant="outline"
      className="flex items-center gap-2 text-sm"
    >
      {isFixing ? (
        <>
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span>Fixing Analysis...</span>
        </>
      ) : (
        <>
          <Wrench className="w-4 h-4" />
          <span>Fix Analysis Display</span>
        </>
      )}
    </Button>
  );
};

// Alternative version with more detailed feedback
export const FixAnalysisButtonDetailed: React.FC<FixAnalysisButtonProps> = ({ onAnalysisFixed }) => {
  const [isFixing, setIsFixing] = useState(false);
  const [fixResult, setFixResult] = useState<any>(null);
  const { showSuccess, showError } = useToasts();

  const handleFixAnalysis = async () => {
    if (isFixing) return;
    
    setIsFixing(true);
    setFixResult(null);
    
    try {
      console.log('🔧 [Fix Analysis] Starting analysis fix...');
      
      const response = await makeAuthenticatedRequest('/api/fix-transaction-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to fix analysis');
      }

      console.log('✅ [Fix Analysis] Fix completed:', result);
      setFixResult(result);
      
      // Show success message
      showSuccess('Analysis Fix Complete', result.message);
      
      // Call the callback to refresh data
      if (onAnalysisFixed) {
        onAnalysisFixed();
      }
      
    } catch (error) {
      console.error('❌ [Fix Analysis] Error fixing analysis:', error);
      showError('Fix Failed', `Failed to fix analysis: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsFixing(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button
        onClick={handleFixAnalysis}
        disabled={isFixing}
        variant="outline"
        className="flex items-center gap-2 text-sm"
      >
        {isFixing ? (
          <>
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <span>Fixing Analysis...</span>
          </>
        ) : (
          <>
            <Wrench className="w-4 h-4" />
            <span>Fix Analysis Display</span>
          </>
        )}
      </Button>
      
      {fixResult && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-blue-600" />
            <span className="font-medium text-blue-900">Fix Results</span>
          </div>
          <div className="space-y-1 text-blue-800">
            <div>• Total checked: {fixResult.summary.total_checked}</div>
            <div>• Fixed: {fixResult.summary.fixed}</div>
            <div>• Already OK: {fixResult.summary.already_ok}</div>
            <div>• Needs initial analysis: {fixResult.summary.pending_initial}</div>
            {fixResult.summary.errors > 0 && (
              <div className="text-red-600">• Errors: {fixResult.summary.errors}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
