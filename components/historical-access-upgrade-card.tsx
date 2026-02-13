"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/firebase/auth-context';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { useRouter } from 'next/navigation';
import { Sparkles, Calendar, TrendingUp, Loader2 } from 'lucide-react';
import { TrialCountdown } from '@/components/trial-countdown';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface HistoricalAccessStatus {
  hasAccess: boolean;
  isTrial: boolean;
  isPaid: boolean;
  trialStart?: Date;
  trialEnd?: Date;
  subscriptionEnd?: Date;
  daysRemaining?: number;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date;
}

export function HistoricalAccessUpgradeCard() {
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [accessStatus, setAccessStatus] = useState<HistoricalAccessStatus | null>(null);
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly');

  useEffect(() => {
    if (!user?.id) return;

    const fetchAccessStatus = async () => {
      try {
        const response = await makeAuthenticatedRequest('/api/subscriptions/check-access');
        if (response.ok) {
          const data = await response.json();
          const accessData = data.data;
          // Map subscription details to access status
          setAccessStatus({
            ...accessData,
            cancelAtPeriodEnd: data.data.subscription?.cancelAtPeriodEnd || false,
            currentPeriodEnd: data.data.subscription?.currentPeriodEnd 
              ? new Date(data.data.subscription.currentPeriodEnd) 
              : undefined,
          });
        }
      } catch (error) {
        console.error('Error fetching access status:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAccessStatus();

    // Refresh every minute to update countdown in real-time
    const interval = setInterval(fetchAccessStatus, 60000);
    return () => clearInterval(interval);
  }, [user?.id]);

  const handleUpgrade = async () => {
    if (!user?.id) return;

    setCheckoutLoading(true);
    try {
      const response = await makeAuthenticatedRequest('/api/stripe/create-checkout', {
        method: 'POST',
        body: JSON.stringify({ interval: billingInterval }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.url) {
          window.location.href = data.url;
        } else {
          console.error('No checkout URL in response:', data);
          alert('Failed to get checkout URL. Please try again.');
        }
      } else {
        // Try to get error message from response
        // Note: Response body can only be read once, so we need to clone it or read as text first
        let errorMessage = 'Failed to start checkout. Please try again.';
        const responseText = await response.text();
        
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error || errorData.details || errorData.message || errorMessage;
          console.error('Checkout error response:', {
            status: response.status,
            statusText: response.statusText,
            error: errorData
          });
        } catch (jsonError) {
          // If JSON parsing fails, use the text response
          console.error('Checkout error (non-JSON response):', {
            status: response.status,
            statusText: response.statusText,
            body: responseText || '(empty response)'
          });
          errorMessage = responseText || `Server returned ${response.status} ${response.statusText}`;
        }
        alert(errorMessage);
      }
    } catch (error) {
      console.error('Error creating checkout:', error);
      alert('Failed to start checkout. Please check the console for details and try again.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleReactivate = async () => {
    if (!user?.id) return;

    setCheckoutLoading(true);
    try {
      const response = await makeAuthenticatedRequest('/api/stripe/reactivate-subscription', {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Refresh access status to update UI
          const statusResponse = await makeAuthenticatedRequest('/api/subscriptions/check-access');
          if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            const accessData = statusData.data;
            setAccessStatus({
              ...accessData,
              cancelAtPeriodEnd: statusData.data.subscription?.cancelAtPeriodEnd || false,
              currentPeriodEnd: statusData.data.subscription?.currentPeriodEnd 
                ? new Date(statusData.data.subscription.currentPeriodEnd) 
                : undefined,
            });
          }
          alert('Subscription reactivated successfully! Your subscription will continue after the current billing period.');
        } else {
          alert(data.message || 'Failed to reactivate subscription. Please try again.');
        }
      } else {
        let errorMessage = 'Failed to reactivate subscription. Please try again.';
        const responseText = await response.text();
        
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.error || errorData.details || errorData.message || errorMessage;
        } catch (jsonError) {
          errorMessage = responseText || `Server returned ${response.status} ${response.statusText}`;
        }
        alert(errorMessage);
      }
    } catch (error) {
      console.error('Error reactivating subscription:', error);
      alert('Failed to reactivate subscription. Please check the console for details and try again.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  // Calculate savings for yearly plan
  const monthlyPrice = 14.99;
  const yearlyPrice = 150;
  const yearlySavings = (monthlyPrice * 12) - yearlyPrice;
  const yearlySavingsPercent = Math.round((yearlySavings / (monthlyPrice * 12)) * 100);

  if (loading) {
    return (
      <Card className="border-primary/40 dark:border-primary/20 bg-gradient-to-br from-primary/20 via-primary/15 to-primary/25 dark:from-primary/5 dark:to-primary/10 shadow-md">
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Hide card completely when user has active subscription (not cancelled)
  if (accessStatus?.hasAccess && accessStatus.isPaid && !accessStatus.cancelAtPeriodEnd) {
    return null; // Don't render card for active subscriptions
  }

  // Show re-enable card when subscription is cancelled but still has access
  if (accessStatus?.hasAccess && accessStatus.isPaid && accessStatus.cancelAtPeriodEnd) {
    return (
      <Card className="border-yellow-400/40 dark:border-yellow-500/20 bg-gradient-to-br from-yellow-50/50 via-yellow-50/30 to-yellow-100/50 dark:from-yellow-950/20 dark:via-yellow-950/10 dark:to-yellow-900/20 shadow-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
              <CardTitle className="text-lg">Subscription Scheduled to Cancel</CardTitle>
            </div>
            <Badge variant="outline" className="border-yellow-500 text-yellow-700 dark:text-yellow-400">
              Cancelling
            </Badge>
          </div>
          <CardDescription>
            Your subscription is scheduled to cancel, but you'll continue to have access until the end of your billing period.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {accessStatus.currentPeriodEnd && (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">
                Access until: <span className="font-semibold text-foreground">
                  {new Date(accessStatus.currentPeriodEnd).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </span>
              </div>
              <TrialCountdown
                trialEnd={new Date(accessStatus.currentPeriodEnd)}
                isTrial={false}
              />
            </div>
          )}
          <Button
            onClick={handleReactivate}
            disabled={checkoutLoading}
            className="w-full"
            size="lg"
            variant="default"
          >
            {checkoutLoading ? (
              <>
                <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                Re-enabling...
              </>
            ) : (
              <>
                Re-enable Subscription
                <Sparkles className="ml-2 w-4 h-4" />
              </>
            )}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Re-enable your subscription to continue access after the current billing period ends.
          </p>
        </CardContent>
      </Card>
    );
  }

  // If user is in trial, show compact combined card
  if (accessStatus?.hasAccess && accessStatus.isTrial) {
    const daysRemaining = accessStatus.trialEnd
      ? Math.ceil((new Date(accessStatus.trialEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : 0;
    return (
      <Card className="max-w-5xl overflow-hidden border border-border/80 dark:border-border/50 bg-card shadow-md rounded-xl">
        <CardContent className="p-0">
          <div className="flex flex-col md:flex-row md:items-stretch">
            {/* Left: Trial status block - stacks first on mobile */}
            <div className="flex items-center gap-3 sm:gap-4 p-4 sm:p-5 md:p-6 md:border-r border-border/60 bg-muted/20 dark:bg-muted/15 min-h-[72px] sm:min-h-0">
              <div className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl bg-green-700/20 dark:bg-green-600/15">
                <Sparkles className="h-5 w-5 text-green-700 dark:text-green-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                  <h3 className="font-semibold text-base md:text-lg text-foreground">Free Trial Active</h3>
                  <Badge className="bg-green-700/90 dark:bg-green-600 text-white border-0 text-xs font-medium">Trial</Badge>
                </div>
                {accessStatus.trialEnd && (
                  <p className="text-sm md:text-base text-muted-foreground mt-0.5">
                    <span className="font-semibold text-foreground">{daysRemaining}</span> days remaining
                  </p>
                )}
              </div>
            </div>

            {/* Right: Pricing + CTA - stacks on mobile with clear spacing */}
            <div className="flex flex-col sm:flex-row flex-1 items-stretch sm:items-center justify-between gap-4 p-4 sm:p-5 md:p-6 md:gap-6">
              <div className="flex flex-col sm:flex-row items-center sm:items-center gap-4 md:gap-6 w-full sm:w-auto">
                <div className="w-full sm:w-auto text-center sm:text-left">
                  <Tabs value={billingInterval} onValueChange={(value) => setBillingInterval(value as 'monthly' | 'yearly')} className="w-full sm:w-auto">
                    <TabsList className="h-9 md:h-10 w-full sm:w-auto inline-flex bg-muted/40 dark:bg-muted/25 p-0.5 rounded-lg">
                      <TabsTrigger value="monthly" className="text-xs md:text-sm px-4 md:px-5 flex-1 sm:flex-none rounded-md min-h-[44px] sm:min-h-0">
                        Monthly
                      </TabsTrigger>
                      <TabsTrigger value="yearly" className="text-xs md:text-sm px-4 md:px-5 flex-1 sm:flex-none rounded-md min-h-[44px] sm:min-h-0 data-[data-active=true]:bg-green-700 data-[data-active=true]:text-white data-[data-active=true]:shadow-sm">
                        Yearly
                        <Badge variant="secondary" className="ml-1.5 text-[10px] md:text-xs px-1.5 hidden sm:inline bg-green-600/20 text-green-800 dark:text-green-200">-{yearlySavingsPercent}%</Badge>
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <div className="flex items-baseline justify-center sm:justify-start gap-1.5 mt-3">
                    <span className="text-2xl md:text-3xl font-bold text-foreground">${billingInterval === 'monthly' ? monthlyPrice.toFixed(2) : yearlyPrice.toFixed(2)}</span>
                    <span className="text-sm text-muted-foreground">/{billingInterval === 'monthly' ? 'mo' : 'yr'}</span>
                  </div>
                  {billingInterval === 'yearly' && yearlySavingsPercent > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">Save {yearlySavingsPercent}% vs monthly</p>
                  )}
                </div>
              </div>

              <Button
                onClick={handleUpgrade}
                disabled={checkoutLoading}
                size="sm"
                className="w-full sm:w-auto h-11 sm:h-10 md:h-11 px-5 md:px-6 rounded-lg bg-green-700 hover:bg-green-800 dark:bg-green-800 dark:hover:bg-green-700 text-white font-medium shadow-sm hover:shadow transition-all no-tap-highlight min-h-[44px] sm:min-h-0"
              >
                {checkoutLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    Subscribe Now
                    <Sparkles className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show upgrade card for users without access
  return (
    <Card className="border-primary/40 dark:border-primary/20 bg-gradient-to-br from-primary/20 via-primary/15 to-primary/25 dark:from-primary/5 dark:to-primary/10 shadow-md">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <CardTitle className="text-lg">Unlock WriteOff Premium</CardTitle>
        </div>
        <CardDescription>
          Get full access to all premium features including report exports and extended transaction history.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Billing Interval Selector */}
        <div className="flex justify-center">
          <div className="w-full">
            <Tabs value={billingInterval} onValueChange={(value) => setBillingInterval(value as 'monthly' | 'yearly')} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="monthly" className="text-sm">
                  Monthly
                </TabsTrigger>
                <TabsTrigger value="yearly" className="text-sm">
                  Yearly
                  {yearlySavings > 0 && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      Save {yearlySavingsPercent}%
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* Pricing Display */}
        <div className="text-center py-4">
          <div className="flex items-baseline justify-center gap-2">
            <span className="text-4xl font-bold text-foreground">
              ${billingInterval === 'monthly' ? monthlyPrice.toFixed(2) : yearlyPrice.toFixed(2)}
            </span>
            <span className="text-muted-foreground">
              /{billingInterval === 'monthly' ? 'month' : 'year'}
            </span>
          </div>
          {billingInterval === 'yearly' && yearlySavings > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              Save ${yearlySavings.toFixed(2)} per year vs monthly
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span>Export Schedule C reports as PDF or CSV</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="w-4 h-4 text-primary" />
            <span>Access up to 1 year of transaction history</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-primary" />
            <span>Cancel anytime - no commitment</span>
          </div>
        </div>

        <Button
          onClick={handleUpgrade}
          disabled={checkoutLoading}
          className="w-full"
          size="lg"
        >
          {checkoutLoading ? (
            <>
              <Loader2 className="mr-2 w-4 h-4 animate-spin" />
              Redirecting to checkout...
            </>
          ) : (
            <>
              Subscribe Now
              <Sparkles className="ml-2 w-4 h-4" />
            </>
          )}
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          Instant activation after payment. Cancel anytime.
        </p>
      </CardContent>
    </Card>
  );
}

