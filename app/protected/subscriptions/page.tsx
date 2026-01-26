"use client";

import React from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import { useRouter } from 'next/navigation';
import { HistoricalAccessUpgradeCard } from '@/components/historical-access-upgrade-card';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Sparkles } from 'lucide-react';

export default function SubscriptionsPage() {
  const { user } = useAuth();
  const router = useRouter();

  if (!user) {
    return (
      <div className="p-6 bg-gray-50 min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Please sign in</h1>
          <p className="text-gray-600">You need to be signed in to view subscriptions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-50 shadow-sm">
        <div className="flex items-center justify-between p-6 max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Subscriptions</h1>
              <p className="text-sm text-muted-foreground">Upgrade to access more historical transactions</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="space-y-6">
          {/* Info Card */}
          <Card className="border-primary/40 dark:border-primary/20 bg-gradient-to-br from-primary/20 via-primary/15 to-primary/25 dark:from-primary/5 dark:to-primary/10 shadow-md">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <CardTitle>Historical Transactions Access</CardTitle>
              </div>
              <CardDescription>
                Choose a plan to unlock up to 1 year of transaction history for comprehensive tax tracking.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>• Standard accounts have access to 3 months of transaction history</p>
                <p>• Upgrade to access up to 1 year of historical transactions</p>
                <p>• New users get a 1-month free trial automatically when connecting their bank</p>
                <p>• Subscribe now to activate paid subscription immediately - cancel anytime</p>
              </div>
            </CardContent>
          </Card>

          {/* Upgrade Card */}
          <HistoricalAccessUpgradeCard />
        </div>
      </div>
    </div>
  );
}

