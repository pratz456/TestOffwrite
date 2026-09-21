"use client";

import { useState } from 'react';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/ui/dialog';
import { validateReceiptPreviewPath } from '@/lib/receipts/preview-path';

export function ReceiptPreview({ url, filename }: { url: string; filename?: string }) {
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [imageAttempt, setImageAttempt] = useState(0);
  const receiptPath = validateReceiptPreviewPath(url);

  return (
    <Dialog onOpenChange={(open) => { if (open) { setImageState('loading'); setImageAttempt(value => value + 1); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="border-green-600/50 text-green-700 dark:text-green-300 hover:bg-green-600/10">
          <Eye className="w-4 h-4 mr-1" />
          View
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receipt preview</DialogTitle>
          <DialogDescription className="break-all">{filename || 'Attached receipt'}</DialogDescription>
        </DialogHeader>
        {!receiptPath && <p role="alert" className="text-sm text-destructive">This receipt link is unavailable. Attach the receipt again to restore its preview.</p>}
        {receiptPath && imageState === 'loading' && <p role="status" className="text-sm text-muted-foreground">Loading receipt…</p>}
        {receiptPath && imageState === 'error' && (
          <p role="alert" className="text-sm text-destructive">The receipt could not be displayed. Open the original to retry or view another file format.</p>
        )}
        {/* The private receipt API requires the browser session cookie. A native
            image keeps that request in the browser instead of an image proxy. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {receiptPath && <img
          key={imageAttempt}
          src={receiptPath}
          alt={filename ? `Receipt: ${filename}` : 'Attached receipt'}
          className={imageState === 'error' ? 'hidden' : 'max-h-[65vh] w-full object-contain rounded-md'}
          referrerPolicy="no-referrer"
          onLoad={() => setImageState('ready')}
          onError={() => setImageState('error')}
        />}
        {receiptPath && <a href={receiptPath} className="text-sm text-primary underline underline-offset-4">Open original receipt</a>}
      </DialogContent>
    </Dialog>
  );
}
