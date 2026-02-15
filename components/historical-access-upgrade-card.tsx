"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
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

  // --- Loading state ---
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Hide card when user has active subscription (not cancelled)
  if (accessStatus?.hasAccess && accessStatus.isPaid && !accessStatus.cancelAtPeriodEnd) {
    return null;
  }

  // --- Cancelled subscription (still has access until period end) ---
  if (accessStatus?.hasAccess && accessStatus.isPaid && accessStatus.cancelAtPeriodEnd) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-warning/10 flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4 text-warning" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-medium text-foreground">Subscription ending</p>
                <Badge variant="warning" className="text-[10px] px-1.5 py-0">Cancelling</Badge>
              </div>
              {accessStatus.currentPeriodEnd && (
                <p className="text-xs text-muted-foreground">
                  Access until{' '}
                  <span className="font-medium text-foreground">
                    {new Date(accessStatus.currentPeriodEnd).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </p>
              )}
            </div>
          </div>
          <Button
            onClick={handleReactivate}
            disabled={checkoutLoading}
            variant="outline"
            size="sm"
            className="shrink-0 text-xs gap-1.5"
          >
            {checkoutLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Re-enabling...
              </>
            ) : (
              'Re-enable Subscription'
            )}
          </Button>
        </div>
        {accessStatus.currentPeriodEnd && (
          <div className="mt-3">
            <TrialCountdown trialEnd={new Date(accessStatus.currentPeriodEnd)} isTrial={false} />
          </div>
        )}
      </div>
    );
  }

  // --- Trial active ---
  if (accessStatus?.hasAccess && accessStatus.isTrial) {
    const daysRemaining = accessStatus.trialEnd
      ? Math.ceil((new Date(accessStatus.trialEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : 0;

    return (
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center">
          {/* Left: Trial status */}
          <div className="flex items-center gap-3 p-4 sm:p-5 md:border-r border-border/50 bg-muted/30">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-medium text-foreground">Free Trial Active</p>
                <Badge variant="default" className="text-[10px] px-1.5 py-0">Trial</Badge>
              </div>
              {accessStatus.trialEnd && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{daysRemaining}</span> days remaining
                </p>
              )}
            </div>
          </div>

          {/* Right: Pricing + CTA */}
          <div className="flex flex-col sm:flex-row flex-1 items-stretch sm:items-center justify-between gap-4 p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
              <div className="w-full sm:w-auto text-center sm:text-left">
                <Tabs
                  value={billingInterval}
                  onValueChange={(v) => setBillingInterval(v as 'monthly' | 'yearly')}
                  className="w-full sm:w-auto"
                >
                  <TabsList className="h-8 w-full sm:w-auto inline-flex bg-muted/50 p-0.5 rounded-md">
                    <TabsTrigger
                      value="monthly"
                      className="text-xs px-4 flex-1 sm:flex-none rounded-[5px] min-h-[36px] sm:min-h-0"
                    >
                      Monthly
                    </TabsTrigger>
                    <TabsTrigger
                      value="yearly"
                      className="text-xs px-4 flex-1 sm:flex-none rounded-[5px] min-h-[36px] sm:min-h-0"
                    >
                      Yearly
                      <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 hidden sm:inline">
                        -{yearlySavingsPercent}%
                      </Badge>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="flex items-baseline justify-center sm:justify-start gap-1 mt-2.5">
                  <span className="text-xl font-semibold text-foreground tabular-nums">
                    ${billingInterval === 'monthly' ? monthlyPrice.toFixed(2) : yearlyPrice.toFixed(2)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    /{billingInterval === 'monthly' ? 'mo' : 'yr'}
                  </span>
                </div>
                {billingInterval === 'yearly' && yearlySavingsPercent > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Save {yearlySavingsPercent}% vs monthly
                  </p>
                )}
              </div>
            </div>

            <Button
              onClick={handleUpgrade}
              disabled={checkoutLoading}
              size="sm"
              className="w-full sm:w-auto shrink-0 h-9 px-5 text-xs font-medium"
            >
              {checkoutLoading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Loading...
                </>
              ) : (
                'Subscribe Now'
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // --- No access (upgrade prompt) ---
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Unlock WriteOff Premium</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Full access to reports, exports, and extended history.
          </p>
        </div>
      </div>

      {/* Billing toggle */}
      <Tabs
        value={billingInterval}
        onValueChange={(v) => setBillingInterval(v as 'monthly' | 'yearly')}
        className="mb-4"
      >
        <TabsList className="h-8 w-full grid grid-cols-2 bg-muted/50 p-0.5 rounded-md">
          <TabsTrigger value="monthly" className="text-xs rounded-[5px]">Monthly</TabsTrigger>
          <TabsTrigger value="yearly" className="text-xs rounded-[5px]">
            Yearly
            {yearlySavings > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">
                Save {yearlySavingsPercent}%
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Price */}
      <div className="text-center mb-4">
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-2xl font-semibold text-foreground tabular-nums">
            ${billingInterval === 'monthly' ? monthlyPrice.toFixed(2) : yearlyPrice.toFixed(2)}
          </span>
          <span className="text-xs text-muted-foreground">
            /{billingInterval === 'monthly' ? 'month' : 'year'}
          </span>
        </div>
        {billingInterval === 'yearly' && yearlySavings > 0 && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Save ${yearlySavings.toFixed(2)}/year vs monthly
          </p>
        )}
      </div>

      {/* Features */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <TrendingUp className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>Export Schedule C reports as PDF or CSV</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>Up to 1 year of transaction history</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>Cancel anytime &mdash; no commitment</span>
        </div>
      </div>

      <Button
        onClick={handleUpgrade}
        disabled={checkoutLoading}
        className="w-full text-xs"
        size="sm"
      >
        {checkoutLoading ? (
          <>
            <Loader2 className="mr-1.5 w-3.5 h-3.5 animate-spin" />
            Redirecting...
          </>
        ) : (
          'Subscribe Now'
        )}
      </Button>

      <p className="text-[10px] text-center text-muted-foreground mt-2">
        Instant activation. Cancel anytime.
      </p>
    </div>
  );
}
