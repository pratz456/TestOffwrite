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

  // If user is in trial, show both status and upgrade options
  if (accessStatus?.hasAccess && accessStatus.isTrial) {
    return (
      <div className="space-y-4">
        {/* Trial Status Card */}
        <Card className="border-primary/40 dark:border-primary/20 bg-gradient-to-br from-primary/20 via-primary/15 to-primary/25 dark:from-primary/5 dark:to-primary/10 shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <CardTitle className="text-lg">Free Trial Active</CardTitle>
              </div>
              <Badge variant="default" className="bg-primary">
                Trial
              </Badge>
            </div>
            <CardDescription>
              You have access to up to 1 year of transaction history during your trial
            </CardDescription>
          </CardHeader>
          <CardContent>
            {accessStatus.trialEnd && (
              <TrialCountdown
                trialEnd={new Date(accessStatus.trialEnd)}
                isTrial={true}
              />
            )}
          </CardContent>
        </Card>

        {/* Upgrade Options Card */}
        <Card className="border-primary/40 dark:border-primary/20 bg-gradient-to-br from-primary/20 via-primary/15 to-primary/25 dark:from-primary/5 dark:to-primary/10 shadow-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <CardTitle className="text-lg">Upgrade to Keep Access</CardTitle>
            </div>
            <CardDescription>
              Subscribe now to continue 1-year access after your trial ends
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
                <span>Access up to 1 year of transaction history</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Sparkles className="w-4 h-4 text-primary" />
                <span>Immediate access - subscription starts right away</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-primary" />
                <span>Automatic renewal - cancel anytime</span>
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
              Your subscription will be activated immediately after payment. Cancel anytime.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show upgrade card for users without access
  return (
    <Card className="border-primary/40 dark:border-primary/20 bg-gradient-to-br from-primary/20 via-primary/15 to-primary/25 dark:from-primary/5 dark:to-primary/10 shadow-md">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <CardTitle className="text-lg">Get Up to 1 Year of Historical Transactions</CardTitle>
        </div>
        <CardDescription>
          Currently you see about 3 months of data. Upgrade to access up to 12 months of transaction history.
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
            <span>Access up to 1 year of transaction history</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="w-4 h-4 text-primary" />
            <span>Immediate access - subscription starts right away</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-primary" />
            <span>Automatic renewal - cancel anytime</span>
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
          Your subscription will be activated immediately after payment. Cancel anytime.
        </p>
      </CardContent>
    </Card>
  );
}

