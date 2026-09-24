"use client";

import React from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import { useRouter } from 'next/navigation';
import { HistoricalAccessUpgradeCard } from '@/components/historical-access-upgrade-card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, FileText, Clock, Shield, Zap } from 'lucide-react';
import { openLocalPreviewBilling } from '@/lib/subscriptions/local-preview-billing';

export default function SubscriptionsPage() {
  const { user } = useAuth();
  const router = useRouter();

  if (!user) {
    return (
      <div className="p-4 bg-background min-h-full flex items-start justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">Please sign in</h1>
          <p className="text-muted-foreground">You need to be signed in to view subscriptions.</p>
        </div>
      </div>
    );
  }

  const features = [
    {
      icon: FileText,
      title: 'Export Reports',
      description: 'Download Schedule C as PDF or CSV',
    },
    {
      icon: Clock,
      title: '24 Months History',
      description: 'Up to 24 months (depending on your bank)',
    },
    {
      icon: Shield,
      title: 'Cancel Anytime',
      description: 'No long-term commitment required',
    },
    {
      icon: Zap,
      title: 'Access After Payment',
      description: 'Premium starts when payment is confirmed. Bank payments can take 4–5 business days.',
    },
  ];

  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="Go back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Billing & plans</h1>
            <p className="text-sm text-muted-foreground">Your plan, reports and payment settings.</p>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl items-start gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[1.1fr_1fr]">
        <section aria-label="Your subscription" className="min-w-0 space-y-3">
          <HistoricalAccessUpgradeCard />
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <Button variant="outline" className="w-full whitespace-normal" onClick={() => { if (!openLocalPreviewBilling('/protected/settings?tab=payment')) router.push('/protected/settings?tab=payment'); }}>Manage billing and payment methods</Button>
            <p className="text-xs leading-5 text-muted-foreground">Billing and your saved records remain accessible when a plan ends.</p>
          </div>
        </section>

        <section aria-labelledby="premium-includes" className="min-w-0 rounded-xl border border-border bg-card p-4">
          <h2 id="premium-includes" className="text-base font-semibold">Included with Premium</h2>
          <div className="mt-2 divide-y divide-border">
            {features.map((feature) => (
              <div key={feature.title} className="flex gap-3 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <feature.icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{feature.title}</h3>
                  <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="border-t border-border pt-3 text-sm text-muted-foreground">Automatic transaction syncing and priority support are included.</p>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">Payments are handled by Stripe. Reports support your tax preparation; they are not a filed return.</p>
        </section>
      </div>
    </div>
  );
}
