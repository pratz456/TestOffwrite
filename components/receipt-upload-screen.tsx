"use client";

import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Upload, FileText, Camera, CheckCircle, AlertCircle } from 'lucide-react';
import { auth } from '@/lib/firebase/client';
import type { ReceiptMatchCandidate } from '@/lib/ocr/receipt-processor';

interface ReceiptUploadScreenProps {
  user: {
    id: string;
    email?: string;
    user_metadata?: {
      name?: string;
    };
  };
  onBack: () => void;
  onUploadComplete: (receiptData: any) => void;
}

export const ReceiptUploadScreen: React.FC<ReceiptUploadScreenProps> = ({ 
  user, 
  onBack, 
  onUploadComplete 
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [extractedData, setExtractedData] = useState<null | {
    merchant: string;
    amount: number; // positive only (sign decided at commit time)
    date: string;
    category: string;
    confidence: number;
    items: any[];
    matchCandidates: ReceiptMatchCandidate[];
    suggestedReceiptType: 'expense' | 'income';
    suggestedReceiptConfidence: number;
  }>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const AUTO_ATTACH_CONFIDENCE_THRESHOLD = 0.8;

  const [receiptType, setReceiptType] = useState<'expense' | 'income'>('expense');
  const [attachmentChoice, setAttachmentChoice] = useState<'attach' | 'create'>('create');
  const [selectedCandidateTransId, setSelectedCandidateTransId] = useState<string | null>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setExtractedData(null);
      setReceiptType('expense');
      setAttachmentChoice('create');
      setSelectedCandidateTransId(null);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file);
      setExtractedData(null);
      setReceiptType('expense');
      setAttachmentChoice('create');
      setSelectedCandidateTransId(null);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const [error, setError] = useState<string | null>(null);

  const processReceipt = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setError(null);
    
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Please sign in to upload receipts');
      }
      const idToken = await currentUser.getIdToken();

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('mode', 'ocr');

      const response = await fetch('/api/receipts/process', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${idToken}` },
        body: formData,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || 'Failed to process receipt');
      }

      const result = await response.json();
      const ocr = result.ocrResult || {};
      const matchCandidates = (result.matchCandidates || []) as ReceiptMatchCandidate[];
      const suggestedReceiptType = (result.suggestedReceiptType || 'expense') as 'expense' | 'income';
      const suggestedReceiptConfidence = Number(result.suggestedReceiptConfidence ?? 0.5);

      const topCandidate = matchCandidates[0] || null;
      const shouldAttach =
        Boolean(topCandidate) && topCandidate.confidence >= AUTO_ATTACH_CONFIDENCE_THRESHOLD;

      setReceiptType(suggestedReceiptType);
      setAttachmentChoice(shouldAttach ? 'attach' : 'create');
      setSelectedCandidateTransId(shouldAttach && topCandidate ? topCandidate.trans_id : null);

      setExtractedData({
        merchant: ocr.merchant || 'Unknown Merchant',
        amount: Number(ocr.amount || 0),
        date: ocr.date || new Date().toISOString().split('T')[0],
        category: ocr.category || 'other',
        confidence: Number(ocr.confidence || 0),
        items: ocr.items || [],
        matchCandidates,
        suggestedReceiptType,
        suggestedReceiptConfidence
      });
    } catch (err) {
      console.error('Error processing receipt:', err);
      setError(err instanceof Error ? err.message : 'Failed to process receipt. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmData = async () => {
    if (!selectedFile || !extractedData) return;
    setIsSaving(true);
    setError(null);

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Please sign in to save receipts');
      }

      const idToken = await currentUser.getIdToken();

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('mode', 'commit');
      formData.append('receiptType', receiptType);

      if (attachmentChoice === 'attach' && selectedCandidateTransId) {
        formData.append('attachTransactionId', selectedCandidateTransId);
      }

      const response = await fetch('/api/receipts/process', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${idToken}` },
        body: formData,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || 'Failed to save receipt');
      }

      const result = await response.json();
      const savedTx = result.transaction;
      // createTransactionServer may not echo receipt fields in its immediate return.
      // Ensure the parent UI gets them right away.
      const merged = {
        ...savedTx,
        receipt_url: savedTx?.receipt_url ?? result.receiptUrl,
        receipt_filename: savedTx?.receipt_filename ?? selectedFile.name
      };

      onUploadComplete(merged);
      onBack();
    } catch (err) {
      console.error('Error saving receipt:', err);
      setError(err instanceof Error ? err.message : 'Failed to save receipt. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <div className="bg-white border-b border-blue-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Upload Receipt</h1>
              <p className="text-sm text-slate-600">Scan and automatically extract expense data</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Upload Section */}
          <Card className="p-8 bg-white border-0 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900 mb-6">Upload Receipt</h3>
            
            {!selectedFile ? (
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-lg text-slate-700 mb-2">Drop your receipt here</p>
                <p className="text-sm text-slate-500 mb-4">or click to browse files</p>
                <Button variant="outline" className="gap-2">
                  <FileText className="w-4 h-4" />
                  Choose File
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <FileText className="w-8 h-8 text-blue-600" />
                    <div>
                      <p className="font-medium text-slate-900">{selectedFile.name}</p>
                      <p className="text-sm text-slate-600">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                </div>

                {selectedFile.type.startsWith('image/') && (
                  <div className="rounded-lg overflow-hidden">
                    <img
                      src={URL.createObjectURL(selectedFile)}
                      alt="Receipt preview"
                      className="w-full h-64 object-cover"
                    />
                  </div>
                )}

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button
                    onClick={processReceipt}
                    disabled={isUploading}
                    className="flex-1 gap-2 bg-blue-600 hover:bg-blue-700"
                  >
                    {isUploading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Camera className="w-4 h-4" />
                        Process Receipt
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => {
                      setSelectedFile(null);
                      setExtractedData(null);
                      setReceiptType('expense');
                      setAttachmentChoice('create');
                      setSelectedCandidateTransId(null);
                    }}
                    variant="outline"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Extracted Data Section */}
          <Card className="p-8 bg-white border-0 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900 mb-6">Extracted Data</h3>
            
            {!extractedData ? (
              <div className="text-center py-12">
                <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-slate-500">Upload and process a receipt to see extracted data</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="w-5 h-5" />
                    <span className="font-medium">Data extracted successfully!</span>
                  </div>
                  {typeof extractedData.confidence === 'number' && (
                    <span className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded-full">
                      {Math.round(extractedData.confidence * 100)}% confidence
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Merchant <span className="text-red-600 ml-0.5">*</span></label>
                    <p className="text-slate-900 font-medium">{extractedData.merchant}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-slate-700">Amount <span className="text-red-600 ml-0.5">*</span></label>
                      <p className="text-slate-900 font-medium">${extractedData.amount}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-slate-700">Date <span className="text-red-600 ml-0.5">*</span></label>
                      <p className="text-slate-900 font-medium">{extractedData.date}</p>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700">Category <span className="text-red-600 ml-0.5">*</span></label>
                    <p className="text-slate-900 font-medium">{extractedData.category}</p>
                  </div>

                  <div className="space-y-3 pt-4 border-t border-slate-100">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-slate-700">Receipt type</div>
                        <div className="text-xs text-slate-500">Used only when creating a new transaction.</div>
                      </div>
                      <select
                        value={receiptType}
                        onChange={(e) => setReceiptType(e.target.value as 'expense' | 'income')}
                        className="h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                      </select>
                    </div>

                    {extractedData.matchCandidates.length > 0 ? (
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-slate-700">Save receipt to</div>
                        <div className="text-xs text-slate-500">If attached, we only update the receipt photo (no amount/category changes).</div>

                        <div className="flex gap-3 items-center">
                          <select
                            value={attachmentChoice}
                            onChange={(e) => {
                              const next = e.target.value as 'attach' | 'create';
                              setAttachmentChoice(next);
                              if (next === 'attach') {
                                const fallback = extractedData.matchCandidates[0]?.trans_id ?? null;
                                setSelectedCandidateTransId(selectedCandidateTransId || fallback);
                              }
                            }}
                            className="h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white"
                          >
                            <option value="attach">Existing transaction</option>
                            <option value="create">New transaction</option>
                          </select>

                          {attachmentChoice === 'attach' && (
                            <select
                              value={selectedCandidateTransId || ''}
                              onChange={(e) => setSelectedCandidateTransId(e.target.value)}
                              className="flex-1 h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white"
                            >
                              {extractedData.matchCandidates.slice(0, 3).map((c) => (
                                <option key={c.trans_id} value={c.trans_id}>
                                  {c.hasReceipt ? 'Has receipt • ' : ''}
                                  {c.merchant_name} • ${Math.abs(c.amount).toFixed(2)} •{' '}
                                  {new Date(c.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} •{' '}
                                  {Math.round(c.confidence * 100)}%
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-600">
                        No strong matches found, we will create a new transaction.
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-2 block">Items <span className="text-red-600 ml-0.5">*</span></label>
                    <div className="space-y-2">
                      {extractedData.items.map((item: any, index: number) => (
                        <div key={index} className="flex justify-between items-center py-2 px-3 bg-slate-50 rounded">
                          <span className="text-sm text-slate-700">{item.description}</span>
                          <span className="text-sm font-medium text-slate-900">${item.amount}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4 border-t border-gray-200">
                  <Button 
                    onClick={handleConfirmData}
                    disabled={isSaving}
                    className="flex-1 gap-2 bg-gradient-to-r from-emerald-400 to-green-500 dark:from-emerald-500 dark:to-green-600 hover:from-emerald-500 hover:to-green-600 dark:hover:from-emerald-400 dark:hover:to-green-500 text-white font-medium shadow-md shadow-green-500/20 dark:shadow-green-500/30 transition-all duration-200"
                  >
                    <CheckCircle className="w-4 h-4" />
                    {isSaving ? 'Saving...' : 'Confirm & Save'}
                  </Button>
                  <Button 
                    onClick={() => setExtractedData(null)}
                    variant="outline"
                    className="gap-2"
                  >
                    <AlertCircle className="w-4 h-4" />
                    Edit Manually
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
