"use client";

import React from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import { useRouter } from 'next/navigation';
import { HistoricalAccessUpgradeCard } from '@/components/historical-access-upgrade-card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, FileText, Clock, Shield, Zap, Check } from 'lucide-react';

export default function SubscriptionsPage() {
  const { user } = useAuth();
  const router = useRouter();

  if (!user) {
    return (
      <div className="p-6 bg-background min-h-screen flex items-center justify-center">
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
      title: 'Instant Access',
      description: 'Start using premium features immediately',
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card/80 backdrop-blur-sm border-b border-border sticky top-0 z-50">
        <div className="flex items-center p-4 max-w-5xl mx-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Hero Section */}
        <div className="text-center mb-8 sm:mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <Zap className="w-4 h-4" />
            Premium Features
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            Unlock the Full Power of <span className="text-primary">WriteOff</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Get comprehensive tax tracking with extended history, professional reports, and more.
          </p>
        </div>

        {/* Subscription Status & Pricing Card - Above Features */}
        <div className="max-w-xl mx-auto mb-10 sm:mb-14">
          <HistoricalAccessUpgradeCard />
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-10 sm:mb-14">
          {features.map((feature, index) => (
            <div
              key={index}
              className="group p-4 sm:p-6 rounded-2xl bg-card border border-border hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300"
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3 sm:mb-4 group-hover:bg-primary/20 transition-colors">
                <feature.icon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-1 text-sm sm:text-base">{feature.title}</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>

        {/* What's Included */}
        <div className="mb-10 sm:mb-14">
          <h2 className="text-xl sm:text-2xl font-bold text-foreground text-center mb-6">
            Everything You Get with Premium
          </h2>
          <div className="grid sm:grid-cols-2 gap-3 sm:gap-4 max-w-2xl mx-auto">
            {[
              'Export Schedule C reports as PDF',
              'Export transaction data as CSV',
              'Access up to 24 months (depending on your bank)',
              'Automatic transaction syncing',
              'Priority support',
              'Cancel anytime, no questions asked',
            ].map((item, index) => (
              <div key={index} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
                <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-green-500" />
                </div>
                <span className="text-sm text-foreground">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Trust Badge */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Secure payment powered by Stripe. Your payment information is never stored on our servers.
          </p>
        </div>
      </div>
    </div>
  );
}

