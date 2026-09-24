"use client";

import React from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { FAQSection } from '@/components/faq-section';

export default function HelpPage() {


  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Help & Support</h1>
            <p className="mt-1 text-sm text-muted-foreground">Answers to common questions about your account and tax records.</p>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link href="/protected" aria-label="Back to dashboard">Back</Link>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
        <div className="space-y-4">
          <FAQSection compact />
        </div>
      </div>
    </div>
  );
}
