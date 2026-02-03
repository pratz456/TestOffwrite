"use client";

import React from 'react';
import { useSubscription } from '@/lib/hooks/use-subscription';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, Lock, Loader2 } from 'lucide-react';

interface PremiumFeatureGateProps {
  /** Content to show when user has access */
  children: React.ReactNode;
  /** Optional custom fallback content when user doesn't have access */
  fallback?: React.ReactNode;
  /** Optional custom loading content */
  loadingFallback?: React.ReactNode;
  /** Feature name to display in the upgrade prompt */
  featureName?: string;
  /** Optional description for the upgrade prompt */
  featureDescription?: string;
  /** If true, show a compact inline version instead of a card */
  inline?: boolean;
}

/**
 * Wrapper component that gates premium features behind subscription
 * Shows an upgrade prompt when user doesn't have an active subscription
 */
export function PremiumFeatureGate({
  children,
  fallback,
  loadingFallback,
  featureName = 'this feature',
  featureDescription,
  inline = false,
}: PremiumFeatureGateProps) {
  const { hasAccess, isLoading } = useSubscription();
  const router = useRouter();

  // Show loading state
  if (isLoading) {
    if (loadingFallback) {
      return <>{loadingFallback}</>;
    }
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // User has access - show the content
  if (hasAccess) {
    return <>{children}</>;
  }

  // User doesn't have access - show fallback or default upgrade prompt
  if (fallback) {
    return <>{fallback}</>;
  }

  // Default upgrade prompt
  if (inline) {
    return (
      <div className="flex items-center gap-2 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
        <Lock className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0" />
        <span className="text-sm text-purple-700 dark:text-purple-300">
          Subscribe to access {featureName}
        </span>
        <Button
          onClick={() => router.push('/protected/subscriptions')}
          size="sm"
          className="ml-auto bg-purple-600 hover:bg-purple-700 text-white"
        >
          Subscribe
        </Button>
      </div>
    );
  }

  return (
    <Card className="p-6 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-200 dark:border-purple-800">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-purple-100 dark:bg-purple-800/50 rounded-xl flex-shrink-0">
          <Sparkles className="w-6 h-6 text-purple-600 dark:text-purple-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
            Unlock {featureName}
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {featureDescription || `Subscribe to access ${featureName} and other premium features.`}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => router.push('/protected/subscriptions')}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Subscribe Now
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push('/protected/subscriptions')}
              className="border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-900/30"
            >
              View Plans
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * Higher-order component version of PremiumFeatureGate
 * Wraps a component and only renders it when user has subscription
 */
export function withPremiumGate<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  gateProps?: Omit<PremiumFeatureGateProps, 'children'>
) {
  return function PremiumGatedComponent(props: P) {
    return (
      <PremiumFeatureGate {...gateProps}>
        <WrappedComponent {...props} />
      </PremiumFeatureGate>
    );
  };
}
