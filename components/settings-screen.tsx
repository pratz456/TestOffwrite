"use client";

import React, { useState, useEffect, useRef, useCallback, useId, useContext, createContext } from 'react';
import { Button } from '@/components/ui/button';
import { Input as BaseInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  User,
  Briefcase,
  DollarSign,
  FileText,
  Loader2,
  CheckCircle,
  AlertCircle,
  Shield,
  MapPin
} from '@/lib/icons';
import { getUserProfile, upsertUserProfile } from '@/lib/firebase/profiles';
import { hasAnalysisProfileChange } from '@/functions-analysis/src/profile-fields';
import { useSubscription } from '@/lib/hooks/use-subscription';
import { useRouter, useSearchParams } from 'next/navigation';
import { APP_NAVIGATION_EVENT } from '@/lib/navigation/navigation-guard';
import { useBeforeUnload } from '@/lib/hooks/use-before-unload';
import { CreditCard, Calendar, Sparkles, ExternalLink, XCircle, AlertTriangle, Home, Car, Receipt, Info, Building2, Landmark, Download, Trash2, Link2, ChevronDown, X } from 'lucide-react';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { TrialCountdown } from '@/components/trial-countdown';
import { DocumentImageConsentSettings } from '@/components/document-image-consent-settings';
import { toast } from 'sonner';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Badge } from '@/components/ui/badge';
import { canUseSubscriptionFeature } from '@/lib/subscriptions/client-status';
import { openLocalPreviewBilling } from '@/lib/subscriptions/local-preview-billing';
import { homeOfficeReviewReasons, SIMPLIFIED_MAX_SQFT, SIMPLIFIED_RATE_PER_SQFT, type HomeOfficeSettings } from '@/lib/reports/calc8829';
import { DE_MINIMIS_SAFE_HARBOR_LIMIT } from '@/lib/reports/calc4562';
import { SUPPORTED_TAX_YEARS } from '@/lib/tax-rules/federal-year-rules';

// Payment Settings Tab Component
export const PaymentSettingsTab: React.FC<{ beforeNavigate: (action: () => void) => void }> = ({ beforeNavigate }) => {
  const { status: accessStatus, isLoading: planLoading, error: planError, refetch } = useSubscription();
  const [syncLoading, setLoading] = useState(false);
  const loading = planLoading || syncLoading;
  const plan = accessStatus?.entitlements.plan === 'basic' || accessStatus?.entitlements.plan === 'premium'
    ? accessStatus.entitlements.plan : accessStatus?.subscription?.plan;
  const planName = plan === 'basic' ? 'Basic' : plan === 'premium' ? 'Premium' : 'Subscription';
  const historyIncluded = canUseSubscriptionFeature(accessStatus, 'extended_history');
  const reportsIncluded = canUseSubscriptionFeature(accessStatus, 'reports');
  const exportsIncluded = canUseSubscriptionFeature(accessStatus, 'exports');
  const inactiveStatus = accessStatus?.subscription?.status;
  const inactiveLabel = inactiveStatus && !['active', 'trialing'].includes(inactiveStatus)
    ? inactiveStatus.replaceAll('_', ' ') : 'Inactive';
  const [cancelLoading, setCancelLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const billingAction = useRef(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    variant: 'default' | 'destructive';
    onConfirm: () => void;
  }>({ open: false, title: '', description: '', confirmLabel: 'Confirm', variant: 'default', onConfirm: () => {} });

  const handleManageBilling = async () => {
    if (billingAction.current) return;
    if (openLocalPreviewBilling()) return;
    billingAction.current = true;
    setPortalLoading(true);
    try {
      const response = await makeAuthenticatedRequest('/api/stripe/create-portal-session', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.url !== 'string') throw new Error('Unable to open billing');
      const destination = new URL(data.url);
      if (destination.protocol !== 'https:' || destination.hostname !== 'billing.stripe.com') throw new Error('Invalid billing destination');
      beforeNavigate(() => window.location.assign(destination.href));
    } catch {
      toast.error('Billing could not be opened. Please try again.');
    } finally {
      billingAction.current = false;
      setPortalLoading(false);
    }
  };

  const doCancelSubscription = async () => {
    if (billingAction.current) return;
    if (openLocalPreviewBilling()) return;
    billingAction.current = true;
    setCancelLoading(true);
    try {
      const response = await makeAuthenticatedRequest('/api/stripe/cancel-subscription', {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        toast.success('Subscription cancelled. Access continues until end of billing period.');
        await refetch();
      } else {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.error || 'Failed to cancel subscription.');
      }
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      toast.error('Failed to cancel subscription.');
    } finally {
      billingAction.current = false;
      setCancelLoading(false);
    }
  };

  const handleCancelSubscription = () => {
    if (openLocalPreviewBilling()) return;
    setConfirmDialog({
      open: true,
      title: 'Cancel Subscription',
      description: 'Are you sure you want to cancel your subscription? You will lose access to up to 24 months of historical transactions (depending on your bank) after the current period ends.',
      confirmLabel: 'Cancel Subscription',
      variant: 'destructive',
      onConfirm: doCancelSubscription,
    });
  };

  if (loading) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Your plan</h3>
        </div>

        {planError && (
          <div role="alert" className="rounded-lg border p-4 space-y-2">
            <p className="text-sm">Your plan could not be verified. You can still open billing below.</p>
            <Button size="sm" className="min-h-11" variant="outline" onClick={() => void refetch()}>Retry plan check</Button>
          </div>
        )}
        {accessStatus?.hasAccess || accessStatus?.subscription ? (
          <div className="space-y-4">
            {/* Trial Countdown Timer */}
            {accessStatus.isTrial && accessStatus.trialEnd && (
              <TrialCountdown
                trialEnd={new Date(accessStatus.trialEnd)}
                isTrial={true}
              />
            )}

            {/* Subscription Status Card */}
            <div className="p-4 bg-accent/5 border border-accent/20 rounded-lg space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-foreground text-sm">{accessStatus.isTrial ? 'WriteOff trial' : `WriteOff ${planName}`}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={accessStatus.isTrial ? 'default' : 'default'}>
                      {accessStatus.isTrial ? 'Trial Active' : accessStatus.hasAccess ? 'Active' : inactiveLabel}
                    </Badge>
                    {accessStatus.subscription?.cancelAtPeriodEnd && (
                      <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">
                        Cancelling at period end
                      </Badge>
                    )}
                  </div>
                </div>
                {accessStatus.hasAccess && !accessStatus.isTrial && accessStatus.daysRemaining !== undefined && (
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">{accessStatus.cancelAtPeriodEnd ? 'Access ends in' : 'Renews in'}</p>
                    <p className="text-lg font-semibold text-foreground">
                      {accessStatus.daysRemaining} day{accessStatus.daysRemaining !== 1 ? 's' : ''}
                    </p>
                  </div>
                )}
              </div>

              {/* Plan Details */}
              {accessStatus.subscription && (
                <div className="space-y-2 pt-2 border-t border-accent/20">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Plan</span>
                    <span className="font-medium text-foreground">
                      {planName} · {accessStatus.subscription.planInterval === 'year' ? 'Yearly' : 'Monthly'}
                      {accessStatus.subscription.planAmount != null && (
                        <span className="ml-2">
                          {accessStatus.subscription.planCurrency?.toLowerCase() === 'usd' ? '$' : `${accessStatus.subscription.planCurrency?.toUpperCase() || ''} `}{accessStatus.subscription.planAmount.toFixed(2)}/{accessStatus.subscription.planInterval === 'year' ? 'year' : 'month'}
                        </span>
                      )}
                    </span>
                  </div>
                  {accessStatus.subscription.currentPeriodStart && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Current Period</span>
                      <span className="text-foreground">
                        {new Date(accessStatus.subscription.currentPeriodStart).toLocaleDateString()} - {accessStatus.subscription.currentPeriodEnd ? new Date(accessStatus.subscription.currentPeriodEnd).toLocaleDateString() : 'N/A'}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {plan === 'basic' ? <p className="text-sm text-muted-foreground">{historyIncluded ? 'Extended bank history is included.' : 'Extended bank history is not active.'} Reports and exports require Premium.</p>
                : reportsIncluded && exportsIncluded && historyIncluded ? <p className="text-sm text-muted-foreground">Reports, exports and extended bank history are included.</p> : null}

              {accessStatus.subscriptionEnd && !accessStatus.isTrial && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  <span>
                    {accessStatus.hasAccess ? accessStatus.cancelAtPeriodEnd ? 'Access ends' : 'Next billing'
                      : new Date(accessStatus.subscriptionEnd).getTime() <= Date.now() ? 'Period ended' : 'Period ends'}: {new Date(accessStatus.subscriptionEnd).toLocaleDateString()}
                  </span>
                </div>
              )}

              {accessStatus.hasAccess && accessStatus.subscription?.cancelAtPeriodEnd && (
                <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-yellow-800 dark:text-yellow-200">
                      <p className="font-medium mb-1">Subscription Cancelled</p>
                      <p>Your subscription will end on {accessStatus.subscription.currentPeriodEnd ? new Date(accessStatus.subscription.currentPeriodEnd).toLocaleDateString() : 'the end of the current period'}. You will continue to have access until then.</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handleManageBilling}
                  className="min-h-11 flex-1 whitespace-normal"
                  size="sm"
                >
                  Manage Subscription
                  <ExternalLink className="ml-2 w-4 h-4" />
                </Button>

                {accessStatus.subscription && accessStatus.subscription.status !== 'canceled' && !accessStatus.subscription.cancelAtPeriodEnd && (
                  <Button
                    onClick={handleCancelSubscription}
                    disabled={cancelLoading}
                    variant="destructive"
                    size="sm"
                    className="min-h-11 flex-1 whitespace-normal"
                  >
                    {cancelLoading ? (
                      <>
                        <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                        Cancelling...
                      </>
                    ) : (
                      <>
                        <XCircle className="mr-2 w-4 h-4" />
                        Cancel Subscription
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : planError ? null : (
          <div className="p-4 bg-muted/30 border border-border rounded-lg space-y-4">
            <p className="text-sm text-muted-foreground">
              {planError ? 'Your plan status is currently unavailable.' : "You don't have an active subscription."} Upgrade to access up to 24 months (depending on your bank).
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => {
                  if (openLocalPreviewBilling('/protected/subscriptions')) return;
                  beforeNavigate(() => window.location.assign('/protected/subscriptions'));
                }}
                variant="outline"
                size="sm"
                className="min-h-11 flex-1 whitespace-normal"
              >
                View Upgrade Options
                <ExternalLink className="ml-2 w-4 h-4" />
              </Button>
              <Button
                onClick={() => {
                  if (openLocalPreviewBilling()) return;
                  setConfirmDialog({
                    open: true,
                    title: 'Sync Subscription',
                    description: 'This will check Stripe for your subscription and sync it to your account. Continue?',
                    confirmLabel: 'Sync',
                    variant: 'default',
                    onConfirm: async () => {
                      setLoading(true);
                      try {
                        const response = await makeAuthenticatedRequest('/api/subscriptions/fix-access', {
                          method: 'POST',
                        });
                        if (response.ok) {
                          const data = await response.json();
                          toast.success('Subscription synced successfully!');
                          beforeNavigate(() => window.location.reload());
                        } else {
                          const errorData = await response.json().catch(() => ({}));
                          toast.error(errorData.error || 'No subscription found in Stripe.');
                        }
                      } catch (error) {
                        console.error('Error fixing access:', error);
                        toast.error('Failed to sync subscription.');
                      } finally {
                        setLoading(false);
                      }
                    },
                  });
                }}
                disabled={loading}
                variant="secondary"
                size="sm"
                className="min-h-11 flex-1 whitespace-normal"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 w-4 h-4" />
                    Sync Subscription
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              If you just paid, click "Sync Subscription" to update your account
            </p>
          </div>
        )}
      </div>

      {/* Payment Methods */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Payment Methods</h3>
        </div>
        <div className="p-4 bg-muted/30 border border-border rounded-lg">
          <p className="text-sm text-muted-foreground mb-3">
            Payment methods, billing address and invoices.
          </p>
          <Button
            onClick={handleManageBilling}
            disabled={portalLoading || cancelLoading}
            variant="outline"
            size="sm"
            className="min-h-11 w-full"
          >
            {portalLoading ? 'Opening billing…' : 'Open Billing Portal'}
            <ExternalLink className="ml-2 w-4 h-4" />
          </Button>
          {!accessStatus?.hasAccess && (
            <p className="text-xs text-muted-foreground mt-2">
              Billing remains available after a plan expires.
            </p>
          )}
        </div>
      </div>

      <ConfirmationDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmLabel={confirmDialog.confirmLabel}
        variant={confirmDialog.variant}
        onConfirm={() => {
          setConfirmDialog(prev => ({ ...prev, open: false }));
          confirmDialog.onConfirm();
        }}
      />
    </div>
  );
};

// A shared field label also names nested currency inputs and native pickers.
const SettingsFieldContext = createContext<{ id: string; hintId?: string } | null>(null);
const Input = (props: React.ComponentProps<typeof BaseInput>) => {
  const field = useContext(SettingsFieldContext);
  return <BaseInput id={field?.id} aria-describedby={field?.hintId} {...props} className={`${props.className || ''} md:h-11 md:text-base`} />;
};
const SimpleSelectWrapper = ({ value, onValueChange, placeholder, options }: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) => {
  const field = useContext(SettingsFieldContext);
  return (
    <select id={field?.id} aria-describedby={field?.hintId} value={value} onChange={(event) => onValueChange(event.target.value)}
      className="h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <option value="">{placeholder}</option>
      {value && !options.some(option => option.value === value) && <option value={value}>{value} (saved)</option>}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
};
const SettingsField = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => {
  const id = useId();
  return (
    <SettingsFieldContext.Provider value={{ id, hintId: hint ? `${id}-hint` : undefined }}>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</Label>
        {children}
        {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </SettingsFieldContext.Provider>
  );
};

// Keep the overview scannable; fields stay mounted while a section is closed.
const SettingsSection = ({ title, summary, icon: Icon, children, defaultOpen = false }: {
  title: string; summary: string; icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean;
}) => (
  <details className="group min-w-0 self-start rounded-xl border border-border bg-card md:open:col-span-2" open={defaultOpen || undefined}>
    <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{summary}</span>
      </span>
      <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
    </summary>
    <div className="space-y-4 border-t border-border px-4 py-4">{children}</div>
  </details>
);

type HomeOfficeFacts = Partial<HomeOfficeSettings>;
const YES_NO_OPTIONS = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }];
const HOME_OFFICE_METHOD_OPTIONS = [
  { value: 'simplified', label: 'Simplified: $5 per sq ft, up to 300 sq ft' },
  { value: 'actual', label: 'Actual expenses (Form 8829) - preparer review' },
];
const EXCLUSIVE_USE_EXCEPTION_OPTIONS = [
  { value: 'none', label: 'No exception - the area is also used personally' },
  { value: 'daycare', label: 'Licensed daycare facility (needs review)' },
  { value: 'inventory_storage', label: 'Inventory or product-sample storage (needs review)' },
];
const QUALIFYING_USE_OPTIONS = [
  { value: 'principal_place_of_business', label: 'Principal place of business (including admin work with no other fixed location)' },
  { value: 'meet_clients', label: 'Where I meet patients, clients or customers in person' },
  { value: 'separate_structure', label: 'Separate structure not attached to my home' },
  { value: 'none', label: 'None of these' },
];
const HOUSING_TYPE_OPTIONS = [{ value: 'rented', label: 'Rented' }, { value: 'owned', label: 'Owned' }];
const MONTHS_USED_OPTIONS = Array.from({ length: 13 }, (_, months) => ({ value: String(months), label: months === 12 ? '12 (all year)' : months === 0 ? '0 (no qualified use)' : String(months) }));
const homeOfficeFactsStarted = (facts: HomeOfficeFacts) =>
  Boolean(facts.method || facts.regularUse || facts.exclusiveUse || facts.qualifyingUse || facts.housingType || (facts.monthsUsed ?? null) !== null || facts.officeSqFt || facts.totalHomeSqFt);
const homeOfficeSummary = (facts: HomeOfficeFacts | null, reasons: string[]) => {
  if (!facts || !homeOfficeFactsStarted(facts)) return 'Eligibility facts, square footage & method';
  const method = facts.method === 'simplified' ? 'Simplified' : facts.method === 'actual' ? 'Actual expenses (review)' : 'No method chosen';
  const area = facts.officeSqFt ? ` · ${facts.officeSqFt} sq ft` : '';
  return `${method}${area} · ${reasons.length ? `${reasons.length} question${reasons.length === 1 ? '' : 's'} left` : 'facts complete'}`;
};

/**
 * Publication 587 / Rev. Proc. 2013-13 facts stored in settings/homeOffice. Each question keeps
 * "Not answered" separate from "No": an unanswered fact leaves the estimate in review, while a
 * "No" is an eligibility result ($0). Square footage and method are mirrored to the legacy
 * profile fields so AI analysis context and older readers stay consistent.
 */
export const HomeOfficeFactsSection = ({ userId, onLegacyChange }: {
  userId: string;
  onLegacyChange: (changes: { home_office_sqft?: number; total_home_sqft?: number; home_office_method?: string }) => void;
}) => {
  const [facts, setFacts] = useState<HomeOfficeFacts | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<HomeOfficeFacts>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const owner = useRef(userId);
  owner.current = userId;

  useEffect(() => {
    let current = true;
    setLoadState('loading'); setFacts(null); pending.current = {};
    (async () => {
      try {
        const response = await makeAuthenticatedRequest('/api/settings/home-office');
        const result = await response.json().catch(() => ({}));
        if (!current) return;
        if (!response.ok) throw new Error('load failed');
        setFacts((result.data as HomeOfficeFacts | null) ?? {});
        setLoadState('ready');
      } catch {
        if (current) setLoadState('error');
      }
    })();
    return () => { current = false; if (timer.current) clearTimeout(timer.current); };
  }, [userId, attempt]);

  const flush = useCallback(async () => {
    const uid = owner.current;
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    setSaveState('saving'); setSaveError('');
    try {
      const response = await makeAuthenticatedRequest('/api/settings/home-office', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const result = await response.json().catch(() => ({}));
      if (owner.current !== uid) return;
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Home office facts could not be saved.');
      // Server-normalized facts win, except for edits typed while the request was in flight.
      if (result.data) setFacts({ ...(result.data as HomeOfficeFacts), ...pending.current });
      setSaveState('saved');
    } catch (error) {
      if (owner.current !== uid) return;
      pending.current = { ...patch, ...pending.current };
      setSaveState('error'); setSaveError(error instanceof Error ? error.message : 'Home office facts could not be saved.');
    }
  }, []);

  const change = useCallback((patch: HomeOfficeFacts) => {
    setFacts(previous => ({ ...(previous ?? {}), ...patch }));
    pending.current = { ...pending.current, ...patch };
    setSaveState('idle');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 1200);
  }, [flush]);

  const reasons = facts ? homeOfficeReviewReasons({ ...facts, method: facts.method ?? null }) : [];
  const started = facts ? homeOfficeFactsStarted(facts) : false;
  const ineligible = facts && !reasons.length && (facts.regularUse === 'no' || facts.exclusiveUse === 'no' || facts.qualifyingUse === 'none' || facts.monthsUsed === 0);
  const optionValue = (value: unknown) => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

  return (
    <SettingsSection title="Home Office Deduction" icon={Home} summary={homeOfficeSummary(facts, reasons)}>
      {loadState === 'loading' && <p className="text-xs text-muted-foreground" role="status">Loading saved home office facts…</p>}
      {loadState === 'error' && (
        <div role="alert" className="space-y-2 rounded-lg border p-3 text-sm">
          <p>Saved home office facts could not be loaded.</p>
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => setAttempt(count => count + 1)}>Retry</Button>
        </div>
      )}
      {loadState === 'ready' && facts && (
        <>
          <p className="text-xs text-muted-foreground">
            Answer each question as it applies to {SUPPORTED_TAX_YEARS[SUPPORTED_TAX_YEARS.length - 1]}. Leaving a question unanswered keeps the estimate in review; answering “No” records that the area does not qualify. Planning estimate only (IRS Publication 587).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SettingsField label="Deduction method" hint={`Simplified: $${SIMPLIFIED_RATE_PER_SQFT}/sq ft up to ${SIMPLIFIED_MAX_SQFT} sq ft, no home depreciation, no carryover.`}>
              <SimpleSelectWrapper value={optionValue(facts.method)} placeholder="Not chosen" options={HOME_OFFICE_METHOD_OPTIONS}
                onValueChange={value => { change({ method: (value || null) as HomeOfficeFacts['method'] }); onLegacyChange({ home_office_method: value }); }} />
            </SettingsField>
            <SettingsField label="Home is rented or owned" hint="Owned homes keep mortgage interest and real estate taxes on Schedule A under the simplified method.">
              <SimpleSelectWrapper value={optionValue(facts.housingType)} placeholder="Not answered" options={HOUSING_TYPE_OPTIONS}
                onValueChange={value => change({ housingType: (value || null) as HomeOfficeFacts['housingType'] })} />
            </SettingsField>
            <SettingsField label="Regular business use of a specific area?" hint="Occasional or incidental use does not count.">
              <SimpleSelectWrapper value={optionValue(facts.regularUse)} placeholder="Not answered" options={YES_NO_OPTIONS}
                onValueChange={value => change({ regularUse: (value || null) as HomeOfficeFacts['regularUse'] })} />
            </SettingsField>
            <SettingsField label="Used exclusively for business (no personal use)?" hint="The area does not need to be a whole room, but it cannot double as personal space.">
              <SimpleSelectWrapper value={optionValue(facts.exclusiveUse)} placeholder="Not answered" options={YES_NO_OPTIONS}
                onValueChange={value => change({ exclusiveUse: (value || null) as HomeOfficeFacts['exclusiveUse'], ...(value === 'yes' ? { exclusiveUseException: null } : {}) })} />
            </SettingsField>
            {facts.exclusiveUse === 'no' && (
              <SettingsField label="Exception to exclusive use" hint="Only licensed daycare and inventory/product-sample storage relax the exclusive-use test (§280A(c)(2), (c)(4)).">
                <SimpleSelectWrapper value={optionValue(facts.exclusiveUseException)} placeholder="Not answered" options={EXCLUSIVE_USE_EXCEPTION_OPTIONS}
                  onValueChange={value => change({ exclusiveUseException: (value || null) as HomeOfficeFacts['exclusiveUseException'] })} />
              </SettingsField>
            )}
            <SettingsField label="How the area qualifies" hint="Principal place of business, a place you meet clients, or a separate structure (§280A(c)(1)).">
              <SimpleSelectWrapper value={optionValue(facts.qualifyingUse)} placeholder="Not answered" options={QUALIFYING_USE_OPTIONS}
                onValueChange={value => change({ qualifyingUse: (value || null) as HomeOfficeFacts['qualifyingUse'] })} />
            </SettingsField>
            <SettingsField label="Months used for business this year" hint="Count a month with at least 15 days of qualified use.">
              <SimpleSelectWrapper value={optionValue(facts.monthsUsed)} placeholder="Not answered" options={MONTHS_USED_OPTIONS}
                onValueChange={value => change({ monthsUsed: value === '' ? null : Number(value) })} />
            </SettingsField>
            <SettingsField label="Office area (sq ft)" hint={`Only ${SIMPLIFIED_MAX_SQFT} sq ft count under the simplified method.`}>
              <Input type="number" min={0} inputMode="numeric" value={facts.officeSqFt || ''} placeholder="0" className="h-11 text-base rounded-lg border-border bg-background"
                onChange={e => { const sqft = e.target.value ? Number(e.target.value) : 0; change({ officeSqFt: sqft }); onLegacyChange({ home_office_sqft: sqft || undefined }); }} />
            </SettingsField>
            <SettingsField label="Total home area (sq ft)" hint="Schedule C line 30 reports both areas.">
              <Input type="number" min={0} inputMode="numeric" value={facts.totalHomeSqFt || ''} placeholder="0" className="h-11 text-base rounded-lg border-border bg-background"
                onChange={e => { const sqft = e.target.value ? Number(e.target.value) : 0; change({ totalHomeSqFt: sqft }); onLegacyChange({ total_home_sqft: sqft || undefined }); }} />
            </SettingsField>
          </div>
          <div role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {saveState === 'saving' && 'Saving home office facts…'}
            {saveState === 'saved' && 'Home office facts saved.'}
            {saveState === 'error' && <span role="alert" className="text-red-700 dark:text-red-300">{saveError} <button type="button" className="underline" onClick={() => void flush()}>Retry</button></span>}
          </div>
          {started && reasons.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
              <p className="font-medium">Before a home office amount is included in your estimate:</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
            </div>
          )}
          {started && !reasons.length && (
            <p className="rounded-lg border p-3 text-xs">
              {ineligible
                ? 'Your answers indicate the area does not qualify under §280A(c)(1), so $0 is included. Change an answer if it was recorded incorrectly.'
                : `Facts complete. The estimate uses $${SIMPLIFIED_RATE_PER_SQFT} × the smaller of ${facts.officeSqFt} sq ft or ${SIMPLIFIED_MAX_SQFT} sq ft × ${facts.monthsUsed}/12 months, limited to your business income (Rev. Proc. 2013-13). No Form 8829 is filed under the simplified method.`}
            </p>
          )}
          {!started && <p className="text-xs text-muted-foreground">No home office deduction is included until you choose a method and answer these questions.</p>}
        </>
      )}
    </SettingsSection>
  );
};

/**
 * Reg. §1.263(a)-1(f) de minimis safe harbor: an annual election made by statement on a timely
 * filed original return, not an asset attribute. Stored in settings/depreciation per tax year.
 */
export const DeMinimisElectionSection = ({ userId }: { userId: string }) => {
  const [years, setYears] = useState<number[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'saving'>('loading');
  const [attempt, setAttempt] = useState(0);
  const owner = useRef(userId);
  owner.current = userId;
  useEffect(() => {
    let current = true;
    setState('loading'); setYears(null);
    (async () => {
      try {
        const response = await makeAuthenticatedRequest('/api/settings/depreciation');
        const result = await response.json().catch(() => ({}));
        if (!current) return;
        if (!response.ok || !Array.isArray(result.data?.deMinimisSafeHarborYears)) throw new Error('load failed');
        setYears(result.data.deMinimisSafeHarborYears as number[]);
        setState('ready');
      } catch { if (current) setState('error'); }
    })();
    return () => { current = false; };
  }, [userId, attempt]);
  const toggle = async (year: number, elected: boolean) => {
    if (!years || state !== 'ready') return;
    const uid = owner.current;
    const next = elected ? [...new Set([...years, year])].sort() : years.filter(item => item !== year);
    setYears(next); setState('saving');
    try {
      const response = await makeAuthenticatedRequest('/api/settings/depreciation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deMinimisSafeHarborYears: next }) });
      const result = await response.json().catch(() => ({}));
      if (owner.current !== uid) return;
      if (!response.ok || !Array.isArray(result.data?.deMinimisSafeHarborYears)) throw new Error('save failed');
      setYears(result.data.deMinimisSafeHarborYears as number[]); setState('ready');
    } catch {
      if (owner.current !== uid) return;
      setYears(years); setState('ready'); toast.error('The de minimis election could not be saved. Please try again.');
    }
  };
  const summary = years?.length ? `Elected for ${years.join(', ')}` : 'De minimis safe harbor election by year';
  return (
    <SettingsSection title="Asset expensing election" icon={Landmark} summary={summary}>
      {state === 'loading' && <p className="text-xs text-muted-foreground" role="status">Loading saved elections…</p>}
      {state === 'error' && (
        <div role="alert" className="space-y-2 rounded-lg border p-3 text-sm">
          <p>Saved elections could not be loaded.</p>
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => setAttempt(count => count + 1)}>Retry</Button>
        </div>
      )}
      {years && state !== 'loading' && state !== 'error' && (
        <fieldset className="space-y-2">
          <legend className="text-xs text-muted-foreground">
            Items costing ${DE_MINIMIS_SAFE_HARBOR_LIMIT.toLocaleString('en-US')} or less per invoice or item are deducted as current expenses instead of depreciated when you make this election for the year (Reg. §1.263(a)-1(f), no applicable financial statement). It applies to all qualifying purchases that year and must be attached as a statement to a timely filed original return.
          </legend>
          {[...SUPPORTED_TAX_YEARS].reverse().map(year => {
            const id = `de-minimis-${year}`;
            return (
              <label key={year} htmlFor={id} className="flex min-h-11 items-start gap-3 text-sm">
                <input id={id} type="checkbox" className="mt-1 h-4 w-4" checked={years.includes(year)} disabled={state === 'saving'} onChange={event => void toggle(year, event.target.checked)} />
                <span>I elect the de minimis safe harbor on my timely filed {year} return.</span>
              </label>
            );
          })}
          <p className="text-xs text-muted-foreground">Do not also deduct the purchase transaction for an expensed item. Assets above the limit stay on the Form 4562 worksheet (Section 179 or MACRS).</p>
        </fieldset>
      )}
    </SettingsSection>
  );
};

interface SettingsScreenProps {
  user: {
    id: string;
    email?: string;
    user_metadata?: {
      name?: string;
    };
  };
  onBack: () => void;
  onNavigate: (screen: string) => void;
  inAppNavigation?: boolean;
}

type SettingsTab = 'profile' | 'tax' | 'account';

const initialProfile = (user: SettingsScreenProps['user']) => ({
    // Profile & Business Tab
    name: user?.user_metadata?.name || '',
    email: user?.email || '',
    profession: [] as string[],
    customProfession: '',
    businessEntityType: '',
    state: '',
    filing_status: '',
    income: '',
    mailing_address: { street: '', city: '', state: '', zip: '' },
    business_purpose: '',
    business_start_date: '',
    ein: '',
    w2_income: undefined as number | undefined,
    business_income: undefined as number | undefined,
    naics_code: '',
    w2_federal_withheld: undefined as number | undefined,

    // Tax Settings Tab
    home_office_sqft: undefined as number | undefined,
    total_home_sqft: undefined as number | undefined,
    home_office_method: '',
    vehicle_business_use_percentage: undefined as number | undefined,
    vehicle_deduction_method: '',
    itemization_status: '',
    health_insurance_premiums: undefined as number | undefined,
    sep_ira_contribution: undefined as number | undefined,
    solo_401k_contribution: undefined as number | undefined,
    hsa_contribution: undefined as number | undefined,
    simple_ira_contribution: undefined as number | undefined,

    // Advanced (kept for save compatibility)
    audit_history: 'none',
    tax_professional: false,
    documentation_habits: 'moderate',
    business_seasonality: 'year_round',
    multiple_locations: false,
    international_business: false,
    tax_bracket: undefined as number | undefined,
    prior_year_tax: undefined as number | undefined,
    professional_licenses: [] as string[],
    prior_year_deductions: [] as string[]
  });

function analysisSettingsProfile(profile: ReturnType<typeof initialProfile>) {
  return { ...profile, business_entity_type: profile.businessEntityType,
    profession: profile.profession.filter(value => value !== 'Other')
      .concat(profile.profession.includes('Other') && profile.customProfession.trim() ? [profile.customProfession.trim()] : []).join(', ') };
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  user,
  onBack,
  onNavigate,
  inAppNavigation = false
}) => {
  const router = useRouter();
  const [profile, setProfile] = useState(() => initialProfile(user));

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [profileAiRefresh, setProfileAiRefresh] = useState(false);
  const savedProfileRef = useRef(profile);
  const settingsSearchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => settingsSearchParams.get('tab') === 'account' || settingsSearchParams.get('tab') === 'payment' ? 'account' : settingsSearchParams.get('tab') === 'tax' ? 'tax' : 'profile');
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    variant: 'default' | 'destructive';
    onConfirm: () => void;
  }>({ open: false, title: '', description: '', confirmLabel: 'Confirm', variant: 'default', onConfirm: () => {} });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const profileRef = useRef(profile);
  const profileRevision = useRef(0);
  const dirtyRef = useRef(false);
  const clearedNumericFields = useRef(new Set<string>());
  const pendingNavigation = useRef<(() => void) | null>(null);
  const navigationTimeout = useRef<ReturnType<typeof setTimeout>>();
  const saveInFlight = useRef<symbol | null>(null);
  const saveGeneration = useRef(0);
  const saveLatestRef = useRef<() => Promise<void>>(async () => {});
  const profileOwner = useRef<string | null>(user.id);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const exportInFlight = useRef(false);
  const exportOwner = useRef<string | null>(user.id); exportOwner.current = user.id;
  const exportGeneration = useRef(0);
  useEffect(() => {
    exportOwner.current = user.id; exportGeneration.current += 1;
    return () => { exportOwner.current = null; exportGeneration.current += 1; };
  }, [user.id]);
  const [exportLoading, setExportLoading] = useState(false);

  useBeforeUnload(hasUnsavedChanges);

  const professionOptions = [
    { value: 'Software Developer', label: 'Software Developer' },
    { value: 'Freelance Writer', label: 'Freelance Writer' },
    { value: 'Graphic Designer', label: 'Graphic Designer' },
    { value: 'Consultant', label: 'Consultant' },
    { value: 'Marketing Specialist', label: 'Marketing Specialist' },
    { value: 'Real Estate Agent', label: 'Real Estate Agent' },
    { value: 'Photographer', label: 'Photographer' },
    { value: 'Web Designer', label: 'Web Designer' },
    { value: 'Content Creator', label: 'Content Creator' },
    { value: 'Business Coach', label: 'Business Coach' },
    { value: 'Virtual Assistant', label: 'Virtual Assistant' },
    { value: 'Social Media Manager', label: 'Social Media Manager' },
    { value: 'Online Tutor', label: 'Online Tutor' },
    { value: 'E-commerce Store Owner', label: 'E-commerce Store Owner' },
    { value: 'Other', label: 'Other' }
  ];

  const incomeOptions = [
    { value: 'Under $11,600', label: 'Under $11,600' },
    { value: '$11,600 - $47,150', label: '$11,600 - $47,150' },
    { value: '$47,150 - $100,525', label: '$47,150 - $100,525' },
    { value: '$100,525 - $191,950', label: '$100,525 - $191,950' },
    { value: '$191,950 - $243,725', label: '$191,950 - $243,725' },
    { value: '$243,725 - $609,350', label: '$243,725 - $609,350' },
    { value: 'Over $609,350', label: 'Over $609,350' }
  ];

  const stateOptions = [
    { value: 'Alabama', label: 'Alabama' },
    { value: 'Alaska', label: 'Alaska' },
    { value: 'Arizona', label: 'Arizona' },
    { value: 'Arkansas', label: 'Arkansas' },
    { value: 'California', label: 'California' },
    { value: 'Colorado', label: 'Colorado' },
    { value: 'Connecticut', label: 'Connecticut' },
    { value: 'Delaware', label: 'Delaware' },
    { value: 'Florida', label: 'Florida' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Hawaii', label: 'Hawaii' },
    { value: 'Idaho', label: 'Idaho' },
    { value: 'Illinois', label: 'Illinois' },
    { value: 'Indiana', label: 'Indiana' },
    { value: 'Iowa', label: 'Iowa' },
    { value: 'Kansas', label: 'Kansas' },
    { value: 'Kentucky', label: 'Kentucky' },
    { value: 'Louisiana', label: 'Louisiana' },
    { value: 'Maine', label: 'Maine' },
    { value: 'Maryland', label: 'Maryland' },
    { value: 'Massachusetts', label: 'Massachusetts' },
    { value: 'Michigan', label: 'Michigan' },
    { value: 'Minnesota', label: 'Minnesota' },
    { value: 'Mississippi', label: 'Mississippi' },
    { value: 'Missouri', label: 'Missouri' },
    { value: 'Montana', label: 'Montana' },
    { value: 'Nebraska', label: 'Nebraska' },
    { value: 'Nevada', label: 'Nevada' },
    { value: 'New Hampshire', label: 'New Hampshire' },
    { value: 'New Jersey', label: 'New Jersey' },
    { value: 'New Mexico', label: 'New Mexico' },
    { value: 'New York', label: 'New York' },
    { value: 'North Carolina', label: 'North Carolina' },
    { value: 'North Dakota', label: 'North Dakota' },
    { value: 'Ohio', label: 'Ohio' },
    { value: 'Oklahoma', label: 'Oklahoma' },
    { value: 'Oregon', label: 'Oregon' },
    { value: 'Pennsylvania', label: 'Pennsylvania' },
    { value: 'Rhode Island', label: 'Rhode Island' },
    { value: 'South Carolina', label: 'South Carolina' },
    { value: 'South Dakota', label: 'South Dakota' },
    { value: 'Tennessee', label: 'Tennessee' },
    { value: 'Texas', label: 'Texas' },
    { value: 'Utah', label: 'Utah' },
    { value: 'Vermont', label: 'Vermont' },
    { value: 'Virginia', label: 'Virginia' },
    { value: 'Washington', label: 'Washington' },
    { value: 'West Virginia', label: 'West Virginia' },
    { value: 'Wisconsin', label: 'Wisconsin' },
    { value: 'Wyoming', label: 'Wyoming' }
  ];

  const filingStatusOptions = [
    { value: 'Single', label: 'Single' },
    { value: 'Married Filing Jointly', label: 'Married Filing Jointly' },
    { value: 'Married Filing Separately', label: 'Married Filing Separately' },
    { value: 'Head of Household', label: 'Head of Household' },
    { value: 'Qualifying Surviving Spouse', label: 'Qualifying Surviving Spouse' }
  ];

  const businessEntityTypeOptions = [
    { value: 'Sole Proprietor / Independent Contractor', label: 'Sole proprietor' },
    { value: 'Single-Member LLC (disregarded entity)', label: 'Single-member LLC' },
    { value: 'Partnership', label: 'Partnership' },
    { value: 'S-Corporation', label: 'S-Corporation' },
    { value: 'C-Corporation', label: 'C-Corporation' }
  ];

  // --- Save logic ---
  const handleSave = useCallback(async () => {
    if (saveInFlight.current || profileOwner.current !== user.id) return;
    const profile = profileRef.current;
    const revision = profileRevision.current;
    const owner = user.id;
    const request = Symbol('profile-save');
    const generation = saveGeneration.current;
    const currentSave = () => profileOwner.current === owner && saveGeneration.current === generation;
    saveInFlight.current = request;
    try {
      setIsSaving(true);
      setSaveStatus('saving');
      setErrorMessage('');

      // Prepare profession string
      let professionString = profile.profession.join(', ');
      if (profile.profession.includes('Other') && profile.customProfession?.trim()) {
        professionString = profile.profession
          .filter(p => p !== 'Other')
          .concat(profile.customProfession.trim())
          .join(', ');
      }

      const profileData = {
        user_id: user.id,
        email: profile.email,
        name: profile.name,
        profession: professionString,
        business_entity_type: profile.businessEntityType,
        state: profile.state,
        filing_status: profile.filing_status,
        income: profile.income,
        mailing_address: profile.mailing_address,
        business_purpose: profile.business_purpose,
        business_start_date: profile.business_start_date,
        ein: profile.ein,
        w2_income: profile.w2_income,
        business_income: profile.business_income,
        naics_code: profile.naics_code,
        home_office_sqft: profile.home_office_sqft,
        total_home_sqft: profile.total_home_sqft,
        home_office_method: profile.home_office_method,
        vehicle_business_use_percentage: profile.vehicle_business_use_percentage,
        vehicle_deduction_method: profile.vehicle_deduction_method,
        itemization_status: profile.itemization_status,
        health_insurance_premiums: profile.health_insurance_premiums,
        sep_ira_contribution: profile.sep_ira_contribution,
        solo_401k_contribution: profile.solo_401k_contribution,
        hsa_contribution: profile.hsa_contribution,
        simple_ira_contribution: profile.simple_ira_contribution,
        w2_federal_withheld: profile.w2_federal_withheld,
        audit_history: profile.audit_history,
        tax_professional: profile.tax_professional,
        documentation_habits: profile.documentation_habits,
        business_seasonality: profile.business_seasonality,
        multiple_locations: profile.multiple_locations,
        international_business: profile.international_business,
        tax_bracket: profile.tax_bracket,
        prior_year_tax: profile.prior_year_tax,
        professional_licenses: profile.professional_licenses,
        prior_year_deductions: profile.prior_year_deductions,
        // Undefined is omitted by the Firestore merge helper; explicit clears need null.
        ...Object.fromEntries([...clearedNumericFields.current].map(key => [key, null]))
      };

      const { error } = await upsertUserProfile(user.id, profileData as any);
      if (!currentSave()) return;

      if (error) {
        console.error('Error saving profile:', error);
        setSaveStatus('error');
        setErrorMessage(`Failed to save: ${(error as any)?.message || 'Unknown error'}`);
        return;
      }

      const changedAnalysisFacts = hasAnalysisProfileChange(analysisSettingsProfile(savedProfileRef.current), analysisSettingsProfile(profile));
      savedProfileRef.current = profile;
      setProfileAiRefresh(changedAnalysisFacts);

      if (profileRevision.current === revision) {
        setSaveStatus('saved');
        dirtyRef.current = false;
        clearedNumericFields.current.clear();
        setHasUnsavedChanges(false);
        if (pendingNavigation.current) {
          // Allow the dirty beforeunload listener to detach before a full-page redirect.
          navigationTimeout.current = setTimeout(() => {
            if (!currentSave() || dirtyRef.current) return;
            const navigate = pendingNavigation.current;
            pendingNavigation.current = null;
            navigate?.();
          }, 0);
        }
      }

    } catch (err) {
      if (!currentSave()) return;
      console.error('Error saving profile:', err);
      setSaveStatus('error');
      setErrorMessage(`Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      if (saveInFlight.current === request) saveInFlight.current = null;
      if (currentSave()) {
        setIsSaving(false);
        // A newer edit must never be marked saved by an older request.
        if (profileRevision.current !== revision) {
          if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = setTimeout(() => void saveLatestRef.current(), pendingNavigation.current ? 0 : 1500);
        }
      }
    }
  }, [user.id]);
  saveLatestRef.current = handleSave;

  const beforeNavigate = useCallback((navigate: () => void) => {
    if (!dirtyRef.current) { navigate(); return; }
    pendingNavigation.current = navigate;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    void saveLatestRef.current();
  }, []);

  useEffect(() => {
    const beforeAppNavigation = (event: Event) => {
      const href = (event as CustomEvent<{ href?: unknown }>).detail?.href;
      if (!dirtyRef.current || typeof href !== 'string' || !/^\/protected(?:[/?]|$)/.test(href)) return;
      event.preventDefault();
      beforeNavigate(() => router.push(href));
    };
    window.addEventListener(APP_NAVIGATION_EVENT, beforeAppNavigation);
    return () => window.removeEventListener(APP_NAVIGATION_EVENT, beforeAppNavigation);
  }, [beforeNavigate, router]);

  // Auto-save with debounce
  const handleProfileChange = useCallback((changes: Partial<typeof profile>) => {
    for (const [key, value] of Object.entries(changes)) {
      const previous = profileRef.current[key as keyof typeof profile];
      if (value === undefined && typeof previous === 'number') clearedNumericFields.current.add(key);
      else if (typeof value === 'number') clearedNumericFields.current.delete(key);
    }
    setProfileAiRefresh(false);
    profileRef.current = { ...profileRef.current, ...changes };
    profileRevision.current += 1;
    setProfile(profileRef.current);
    dirtyRef.current = true;
    setHasUnsavedChanges(true);

    // Clear any existing timeout
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    // Set status to idle (pending)
    setSaveStatus('idle');

    // Auto-save after 1.5s of no changes
    saveTimeoutRef.current = setTimeout(() => {
      void saveLatestRef.current();
    }, 1500);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (navigationTimeout.current) clearTimeout(navigationTimeout.current);
      pendingNavigation.current = null;
      profileOwner.current = null;
      saveGeneration.current += 1;
    };
  }, []);

  // Handle profession selection (multiple selection)
  const handleProfessionChange = (profession: string, checked: boolean) => {
    const newProfessions = checked
      ? [...new Set([...profile.profession, profession])]
      : profile.profession.filter(p => p !== profession);
    const customProfession = profession === 'Other' && !checked ? '' : profile.customProfession;
    handleProfileChange({ profession: newProfessions, customProfession });
  };

  // Load existing profile data
  useEffect(() => {
    let current = true;
    profileOwner.current = user.id;
    saveGeneration.current += 1;
    saveInFlight.current = null;
    const initial = initialProfile({ id: user.id, email: user.email, user_metadata: { name: user.user_metadata?.name } });
    profileRef.current = initial;
    savedProfileRef.current = initial;
    setProfileAiRefresh(false);
    setProfile(initial);
    profileRevision.current += 1;
    dirtyRef.current = false;
    clearedNumericFields.current.clear();
    pendingNavigation.current = null;
    if (navigationTimeout.current) clearTimeout(navigationTimeout.current);
    setHasUnsavedChanges(false);
    setSaveStatus('idle');
    const loadProfile = async () => {
      try {
        setIsLoading(true);
        setLoadFailed(false);
        setErrorMessage('');
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

        const { data: existingProfile, error } = await getUserProfile(user.id);
        if (!current) return;

        if (error && error.code !== 'PGRST116' && error.code !== 'PROFILE_NOT_FOUND') {
          console.error('Error loading profile:', error);
          setErrorMessage('Failed to load profile data');
          setLoadFailed(true);
          return;
        }

        if (existingProfile) {
          // Parse profession string and handle custom professions
          const professionString = existingProfile.profession || '';
          const professionArray = professionString ? professionString.split(', ').filter((p: string) => p.trim()) : [];

          const predefinedProfessions = [
            'Software Developer', 'Freelance Writer', 'Graphic Designer', 'Consultant', 'Marketing Specialist',
            'Real Estate Agent', 'Photographer', 'Web Designer', 'Content Creator', 'Business Coach',
            'Virtual Assistant', 'Social Media Manager', 'Online Tutor', 'E-commerce Store Owner', 'Other'
          ];

          const customProfessions = professionArray.filter((p: string) => !predefinedProfessions.includes(p));
          const standardProfessions = professionArray.filter((p: string) => predefinedProfessions.includes(p));

          const finalProfessions = customProfessions.length > 0
            ? [...standardProfessions, 'Other']
            : standardProfessions;

          const loadedProfile = {
            name: existingProfile.name || user?.user_metadata?.name || '',
            email: existingProfile.email || user?.email || '',
            profession: finalProfessions,
            customProfession: customProfessions.join(', '),
            businessEntityType: existingProfile.business_entity_type || '',
            state: existingProfile.state || '',
            filing_status: existingProfile.filing_status || '',
            income: existingProfile.income || '',
            mailing_address: {
              street: existingProfile.mailing_address?.street || '',
              city: existingProfile.mailing_address?.city || '',
              state: existingProfile.mailing_address?.state || '',
              zip: existingProfile.mailing_address?.zip || '',
            },
            business_purpose: existingProfile.business_purpose || '',
            business_start_date: existingProfile.business_start_date || '',
            ein: existingProfile.ein || '',
            w2_income: existingProfile.w2_income ?? undefined,
            business_income: existingProfile.business_income ?? undefined,
            naics_code: existingProfile.naics_code || '',
            w2_federal_withheld: existingProfile.w2_federal_withheld ?? undefined,
            home_office_sqft: existingProfile.home_office_sqft ?? undefined,
            total_home_sqft: existingProfile.total_home_sqft ?? undefined,
            home_office_method: existingProfile.home_office_method || '',
            vehicle_business_use_percentage: existingProfile.vehicle_business_use_percentage ?? undefined,
            vehicle_deduction_method: existingProfile.vehicle_deduction_method || '',
            itemization_status: existingProfile.itemization_status || '',
            health_insurance_premiums: existingProfile.health_insurance_premiums ?? undefined,
            sep_ira_contribution: existingProfile.sep_ira_contribution ?? undefined,
            solo_401k_contribution: existingProfile.solo_401k_contribution ?? undefined,
            hsa_contribution: existingProfile.hsa_contribution ?? undefined,
            simple_ira_contribution: (existingProfile as any).simple_ira_contribution ?? undefined,
            audit_history: existingProfile.audit_history || 'none',
            tax_professional: existingProfile.tax_professional || false,
            documentation_habits: existingProfile.documentation_habits || 'moderate',
            business_seasonality: existingProfile.business_seasonality || 'year_round',
            multiple_locations: existingProfile.multiple_locations || false,
            international_business: existingProfile.international_business || false,
            tax_bracket: existingProfile.tax_bracket ?? undefined,
            prior_year_tax: existingProfile.prior_year_tax ?? undefined,
            professional_licenses: existingProfile.professional_licenses || [],
            prior_year_deductions: existingProfile.prior_year_deductions || []
          };

          profileRef.current = loadedProfile;
          savedProfileRef.current = loadedProfile;
          profileRevision.current += 1;
          setProfile(loadedProfile);
          setHasUnsavedChanges(false);
        }

      } catch (err) {
        if (!current) return;
        console.error('Error loading profile:', err);
        setErrorMessage('Failed to load profile data');
        setLoadFailed(true);
      } finally {
        if (current) setIsLoading(false);
      }
    };

    void loadProfile();
    return () => { current = false; };
  }, [user.id, user?.user_metadata?.name, user?.email, loadAttempt]);

  if (isLoading) {
    return (
      <div className="min-h-full bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return <div className="mx-auto max-w-5xl space-y-3 p-4" role="alert">
      <h1 className="text-xl font-semibold">Settings</h1>
      <p className="text-sm">Your settings could not be loaded.</p>
      <Button className="min-h-11" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Retry loading settings</Button>
    </div>;
  }

  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-50">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 py-3 sm:px-6">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">Settings</h1>

          {/* Save status pill */}
          <div className="flex items-center" role="status" aria-live="polite">
            {saveStatus === 'idle' && <span className="text-xs text-muted-foreground">{hasUnsavedChanges ? 'Unsaved changes' : 'Changes save automatically'}</span>}
            {saveStatus === 'saving' && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-muted rounded-full">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Saving...</span>
              </div>
            )}
            {saveStatus === 'saved' && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-green-50 dark:bg-green-950/30 rounded-full">
                <CheckCircle className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                <span className="text-xs font-medium text-green-700 dark:text-green-300">Saved</span>
              </div>
            )}
            {saveStatus === 'error' && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-red-50 dark:bg-red-950/30 rounded-full">
                <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                <span className="text-xs font-medium text-red-700 dark:text-red-300">Save failed</span>
                <button
                  onClick={handleSave}
                  className="min-h-11 px-2 text-xs font-medium text-red-700 dark:text-red-300 underline ml-1"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-4 sm:px-6 space-y-3">
        {saveStatus === 'saved' && profileAiRefresh && <p role="status" className="text-xs text-muted-foreground">AI reviews will update using your new profile. Confirmed categories stay saved.</p>}
        {/* Tab Navigation */}
        <nav aria-label="Settings sections" className="flex gap-1 bg-muted rounded-xl p-1 border border-border">
          {([
            { key: 'profile' as SettingsTab, label: 'Profile', icon: User },
            { key: 'tax' as SettingsTab, label: 'Tax', icon: Receipt },
            { key: 'account' as SettingsTab, label: 'Account', icon: Shield },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              aria-pressed={activeTab === key}
              aria-controls={`settings-${key}`}
              className={`min-h-11 min-w-0 flex-1 px-2 py-2 rounded-lg text-sm font-medium transition-all duration-150 flex items-center justify-center gap-1.5 ${
                activeTab === key
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/60'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{label.split(' ')[0]}</span>
            </button>
          ))}
        </nav>

        {/* ============= TAB 1: Profile & Business ============= */}
        {activeTab === 'profile' && (
          <div id="settings-profile" className="grid items-start gap-3 md:grid-cols-2">
            {/* Tax Filing Essentials - Highlighted Card */}
            <SettingsSection title="Tax profile" defaultOpen icon={FileText} summary={[profile.filing_status, profile.state].filter(Boolean).join(' · ') || 'Filing status, state & W-2 income'}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SettingsField label="Filing Status">
                  <SimpleSelectWrapper
                    value={profile.filing_status}
                    onValueChange={(value) => handleProfileChange({ filing_status: value })}
                    placeholder="Select filing status"
                    options={filingStatusOptions}
                  />
                </SettingsField>
                <SettingsField label="State">
                  <SimpleSelectWrapper
                    value={profile.state}
                    onValueChange={(value) => handleProfileChange({ state: value })}
                    placeholder="Select your state"
                    options={stateOptions}
                  />
                </SettingsField>
                <SettingsField label="Annual Income Range">
                  <SimpleSelectWrapper
                    value={profile.income}
                    onValueChange={(value) => handleProfileChange({ income: value })}
                    placeholder="Select income range"
                    options={incomeOptions}
                  />
                </SettingsField>
                <SettingsField label="W-2 Income" hint="Total wages from W-2 forms">
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={profile.w2_income ?? ''}
                      onChange={(e) => handleProfileChange({ w2_income: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="0"
                      className="h-11 text-base rounded-lg border-border bg-background pl-9"
                    />
                  </div>
                </SettingsField>
                <SettingsField label="W-2 Federal Tax Withheld" hint="Box 2 on your W-2">
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={profile.w2_federal_withheld ?? ''}
                      onChange={(e) => handleProfileChange({ w2_federal_withheld: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="0"
                      className="h-11 text-base rounded-lg border-border bg-background pl-9"
                    />
                  </div>
                </SettingsField>
              </div>
            </SettingsSection>

            {/* Personal Information */}
            <SettingsSection title="Personal Information" icon={User} summary={[profile.name, profile.email].filter(Boolean).join(' · ') || 'Name & email'}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SettingsField label="Full Name">
                  <Input
                    type="text"
                    value={profile.name}
                    onChange={(e) => handleProfileChange({ name: e.target.value })}
                    placeholder="Enter your full name"
                    className="h-11 text-base rounded-lg border-border bg-background"
                  />
                </SettingsField>
                <SettingsField label="Email">
                  <Input
                    type="email"
                    value={profile.email}
                    readOnly
                    className="h-11 text-base rounded-lg border-border bg-muted/50 text-muted-foreground cursor-not-allowed"
                  />
                </SettingsField>
              </div>
            </SettingsSection>

            {/* Professional Information */}
            <SettingsSection title="Professional Information" icon={Briefcase} summary={profile.profession.map(value => value === 'Other' ? profile.customProfession || 'Other' : value).join(', ') || 'Profession & business type'}>
              <SettingsField label="Add profession" hint="You can choose more than one.">
                <SimpleSelectWrapper value="" onValueChange={(value) => { if (value) handleProfessionChange(value, true); }}
                  placeholder="Choose a profession" options={professionOptions.filter(option => !profile.profession.includes(option.value))} />
              </SettingsField>
              {profile.profession.length > 0 && (
                <div className="flex flex-wrap gap-2" aria-label="Selected professions">
                  {profile.profession.map(profession => (
                    <button key={profession} type="button" onClick={() => handleProfessionChange(profession, false)}
                      aria-label={`Remove ${profession}`} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg bg-muted px-3 text-sm">
                      <span className="min-w-0 break-words">{profession}</span><X aria-hidden="true" className="h-4 w-4 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
              {profile.profession.includes('Other') && (
                <SettingsField label="Custom Profession" hint="Separate multiple with commas">
                  <Input
                    type="text"
                    value={profile.customProfession || ''}
                    onChange={(e) => handleProfileChange({ customProfession: e.target.value })}
                    placeholder="Enter your profession"
                    className="h-11 text-base rounded-lg border-border bg-background"
                  />
                </SettingsField>
              )}
              <SettingsField label="Business Entity Type">
                <SimpleSelectWrapper
                  value={profile.businessEntityType}
                  onValueChange={(value) => handleProfileChange({ businessEntityType: value })}
                  placeholder="Select entity type"
                  options={businessEntityTypeOptions}
                />
              </SettingsField>
            </SettingsSection>

            {/* Business Details */}
            <SettingsSection title="Business Details" icon={Building2} summary={profile.business_purpose || 'Business purpose, start date & tax IDs'}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SettingsField label="Business Purpose">
                  <Input
                    type="text"
                    value={profile.business_purpose}
                    onChange={(e) => handleProfileChange({ business_purpose: e.target.value })}
                    placeholder="e.g., Software consulting"
                    className="h-11 text-base rounded-lg border-border bg-background"
                  />
                </SettingsField>
                <SettingsField label="Business Start Date">
                  <Input
                    type="date"
                    value={profile.business_start_date}
                    onChange={(e) => handleProfileChange({ business_start_date: e.target.value })}
                    className="h-11 text-base rounded-lg border-border bg-background"
                  />
                </SettingsField>
                <SettingsField label="EIN">
                  <Input
                    type="text"
                    value={profile.ein}
                    onChange={(e) => handleProfileChange({ ein: e.target.value })}
                    placeholder="XX-XXXXXXX"
                    className="h-11 text-base rounded-lg border-border bg-background"
                  />
                </SettingsField>
                <SettingsField label="NAICS Code">
                  <Input
                    type="text"
                    value={profile.naics_code}
                    onChange={(e) => handleProfileChange({ naics_code: e.target.value })}
                    placeholder="e.g., 541511"
                    className="h-11 text-base rounded-lg border-border bg-background"
                  />
                </SettingsField>
              </div>
            </SettingsSection>

            {/* Mailing Address */}
            <SettingsSection title="Mailing Address" icon={MapPin} summary={[profile.mailing_address.city, profile.mailing_address.state].filter(Boolean).join(', ') || 'Street, city, state & ZIP'}>
              <div className="grid grid-cols-1 gap-4">
                <SettingsField label="Street Address">
                  <Input
                    type="text"
                    value={profile.mailing_address.street}
                    onChange={(e) => handleProfileChange({ mailing_address: { ...profile.mailing_address, street: e.target.value } })}
                    placeholder="123 Main St"
                    className="h-11 text-base rounded-lg border-border bg-background"
                  />
                </SettingsField>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="col-span-2 md:col-span-1">
                    <SettingsField label="City">
                      <Input
                        type="text"
                        value={profile.mailing_address.city}
                        onChange={(e) => handleProfileChange({ mailing_address: { ...profile.mailing_address, city: e.target.value } })}
                        placeholder="City"
                        className="h-11 text-base rounded-lg border-border bg-background"
                      />
                    </SettingsField>
                  </div>
                  <SettingsField label="State">
                    <Input
                      type="text"
                      value={profile.mailing_address.state}
                      onChange={(e) => handleProfileChange({ mailing_address: { ...profile.mailing_address, state: e.target.value } })}
                      placeholder="CA"
                      className="h-11 text-base rounded-lg border-border bg-background"
                    />
                  </SettingsField>
                  <SettingsField label="Zip">
                    <Input
                      type="text"
                      value={profile.mailing_address.zip}
                      onChange={(e) => handleProfileChange({ mailing_address: { ...profile.mailing_address, zip: e.target.value } })}
                      placeholder="90210"
                      className="h-11 text-base rounded-lg border-border bg-background"
                    />
                  </SettingsField>
                </div>
              </div>
            </SettingsSection>
          </div>
        )}

        {/* ============= TAB 2: Tax Settings ============= */}
        {activeTab === 'tax' && (
          <div id="settings-tax" className="space-y-3">
            {/* Home Office Deduction: facts live in settings/homeOffice; legacy profile fields are mirrored. */}
            <HomeOfficeFactsSection userId={user.id} onLegacyChange={handleProfileChange} />

            {/* De minimis safe harbor election (settings/depreciation) */}
            <DeMinimisElectionSection userId={user.id} />

            {/* Vehicle Deduction */}
            <SettingsSection title="Vehicle Deduction" icon={Car} summary={profile.vehicle_deduction_method ? `${profile.vehicle_deduction_method === 'standard_mileage' ? 'Standard mileage' : 'Actual expense'}${profile.vehicle_business_use_percentage !== undefined ? ` · ${profile.vehicle_business_use_percentage}% business` : ''}` : 'Business use & deduction method'}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SettingsField label="Vehicle Business Use %" hint="0-100">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={profile.vehicle_business_use_percentage ?? ''}
                    onChange={(e) => handleProfileChange({ vehicle_business_use_percentage: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="0"
                    className="h-11 text-base rounded-lg border-border bg-background"
                  />
                </SettingsField>
                <SettingsField label="Vehicle Deduction Method">
                  <SimpleSelectWrapper
                    value={profile.vehicle_deduction_method}
                    onValueChange={(value) => handleProfileChange({ vehicle_deduction_method: value })}
                    placeholder="Select method"
                    options={[
                      { value: 'standard_mileage', label: 'Standard Mileage' },
                      { value: 'actual_expense', label: 'Actual Expense' }
                    ]}
                  />
                </SettingsField>
              </div>
            </SettingsSection>

            {/* Tax Preferences */}
            <SettingsSection title="Tax Preferences" icon={FileText} summary={profile.itemization_status === 'standard' ? 'Standard deduction' : profile.itemization_status === 'itemized' ? 'Itemized deductions' : 'Deduction choice & prior-year tax'}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SettingsField label="Itemization Status">
                  <SimpleSelectWrapper
                    value={profile.itemization_status}
                    onValueChange={(value) => handleProfileChange({ itemization_status: value })}
                    placeholder="Select status"
                    options={[
                      { value: 'standard', label: 'Standard Deduction' },
                      { value: 'itemized', label: 'Itemized Deductions' }
                    ]}
                  />
                </SettingsField>
                <SettingsField label="Prior Year Total Tax" hint="From last year's return">
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={profile.prior_year_tax ?? ''}
                      onChange={(e) => handleProfileChange({ prior_year_tax: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="0"
                      className="h-11 text-base rounded-lg border-border bg-background pl-9"
                    />
                  </div>
                </SettingsField>
                <SettingsField label="Tax Bracket Override %" hint="Optional, 0-100">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={profile.tax_bracket ?? ''}
                    onChange={(e) => handleProfileChange({ tax_bracket: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="Auto-calculated"
                    className="h-11 text-base rounded-lg border-border bg-background"
                  />
                </SettingsField>
              </div>
            </SettingsSection>

            {/* Above-the-Line Deductions */}
            <SettingsSection title="Insurance & retirement" icon={Receipt} summary={'Insurance, retirement & HSA amounts'}>
              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-800 dark:text-blue-200">
                  Entered amounts are subject to eligibility and annual limits.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SettingsField label="Health Insurance Premiums">
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={profile.health_insurance_premiums ?? ''}
                      onChange={(e) => handleProfileChange({ health_insurance_premiums: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="0"
                      className="h-11 text-base rounded-lg border-border bg-background pl-9"
                    />
                  </div>
                </SettingsField>
                <SettingsField label="SEP-IRA Contribution">
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={profile.sep_ira_contribution ?? ''}
                      onChange={(e) => handleProfileChange({ sep_ira_contribution: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="0"
                      className="h-11 text-base rounded-lg border-border bg-background pl-9"
                    />
                  </div>
                </SettingsField>
                <SettingsField label="Solo 401(k) Contribution">
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={profile.solo_401k_contribution ?? ''}
                      onChange={(e) => handleProfileChange({ solo_401k_contribution: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="0"
                      className="h-11 text-base rounded-lg border-border bg-background pl-9"
                    />
                  </div>
                </SettingsField>
                <SettingsField label="HSA Contribution">
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={profile.hsa_contribution ?? ''}
                      onChange={(e) => handleProfileChange({ hsa_contribution: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="0"
                      className="h-11 text-base rounded-lg border-border bg-background pl-9"
                    />
                  </div>
                </SettingsField>
                <SettingsField label="SIMPLE IRA Contribution">
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={profile.simple_ira_contribution ?? ''}
                      onChange={(e) => handleProfileChange({ simple_ira_contribution: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="0"
                      className="h-11 text-base rounded-lg border-border bg-background pl-9"
                    />
                  </div>
                </SettingsField>
              </div>
            </SettingsSection>
          </div>
        )}

        {/* ============= TAB 3: Account ============= */}
        {activeTab === 'account' && (
          <div id="settings-account" className="space-y-3">
            {/* Bank Connections */}
            <section className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Landmark className="w-4 h-4 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">Bank Connections</h3>
              </div>
              <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3">
                <Button
                  type="button"
                  onClick={() => beforeNavigate(() => {
                    if (inAppNavigation) {
                      onNavigate('plaid-link?from=settings');
                    } else {
                      router.push('/protected/plaid-link?from=settings');
                    }
                  })}
                  className="h-11 bg-primary hover:bg-primary/90 text-white rounded-lg flex items-center justify-center gap-2"
                >
                  <Link2 className="w-4 h-4" />
                  <span className="text-sm">Connect Bank</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => beforeNavigate(() => onNavigate('plaid'))}
                  variant="outline"
                  className="h-11 text-base rounded-lg flex items-center justify-center gap-2"
                >
                  <DollarSign className="w-4 h-4" />
                  <span className="text-sm">Accounts</span>
                </Button>
              </div>
            </section>

            {/* Subscription */}
            <SettingsSection title="Subscription" icon={CreditCard} summary={'Plan, payments & invoices'} defaultOpen={settingsSearchParams.get('tab') === 'payment'}>
              <PaymentSettingsTab beforeNavigate={beforeNavigate} />
            </SettingsSection>

            {/* Data & Privacy */}
            <SettingsSection title="Data & Privacy" icon={Shield} summary={'Export data, revoke access or delete account'}>
              <div className="space-y-3">
                <DocumentImageConsentSettings userId={user.id} />
                <Button
                  onClick={async () => {
                    if (exportInFlight.current) return;
                    const owner = user.id, generation = exportGeneration.current;
                    const currentExport = () => exportOwner.current === owner && exportGeneration.current === generation;
                    exportInFlight.current = true;
                    setExportLoading(true);
                    try {
                      // Check if user can export (rate limiting)
                      const statusRes = await makeAuthenticatedRequest('/api/user/export');
                      if (!statusRes.ok) throw new Error('Could not check export availability. Please retry.');
                      const statusData = await statusRes.json();
                      if (!currentExport()) return;

                      if (!statusData.canExport) {
                        toast.warning(`Export limit reached. Please wait ${statusData.timeRemaining} minutes.`);
                        return;
                      }

                      // Request the export
                      const res = await makeAuthenticatedRequest('/api/user/export', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                      });

                      if (res.ok) {
                        const exportData = await res.json();
                        if (!currentExport()) return;
                        if (!exportData.success || !exportData.data?.json || !exportData.data?.summary || typeof exportData.data.csv !== 'string' || typeof exportData.data.readme !== 'string') throw new Error('The export response was incomplete. Please retry.');

                        // Create downloadable files
                        const timestamp = new Date().toISOString().split('T')[0];
                        const exportId = exportData.exportId;

                        // Download JSON data
                        const jsonBlob = new Blob([JSON.stringify(exportData.data, null, 2)], { type: 'application/json' });
                        const jsonUrl = window.URL.createObjectURL(jsonBlob);
                        const jsonLink = document.createElement('a');
                        jsonLink.href = jsonUrl;
                        jsonLink.download = `writeoff-export-${timestamp}-${exportId}.json`;
                        document.body.appendChild(jsonLink);
                        jsonLink.click();
                        jsonLink.remove();
                        window.URL.revokeObjectURL(jsonUrl);

                        // Download CSV data
                        const csvBlob = new Blob([exportData.data.csv], { type: 'text/csv' });
                        const csvUrl = window.URL.createObjectURL(csvBlob);
                        const csvLink = document.createElement('a');
                        csvLink.href = csvUrl;
                        csvLink.download = `writeoff-transactions-${timestamp}-${exportId}.csv`;
                        document.body.appendChild(csvLink);
                        csvLink.click();
                        csvLink.remove();
                        window.URL.revokeObjectURL(csvUrl);

                        // Download README
                        const readmeBlob = new Blob([exportData.data.readme], { type: 'text/plain' });
                        const readmeUrl = window.URL.createObjectURL(readmeBlob);
                        const readmeLink = document.createElement('a');
                        readmeLink.href = readmeUrl;
                        readmeLink.download = `writeoff-export-readme-${timestamp}-${exportId}.txt`;
                        document.body.appendChild(readmeLink);
                        readmeLink.click();
                        readmeLink.remove();
                        window.URL.revokeObjectURL(readmeUrl);

                        toast.success(`Exported ${exportData.summary.transactions} transactions, ${exportData.summary.accounts} accounts, and ${exportData.summary.receipts} receipt metadata records. Receipt images are not attached.`);
                      } else {
                        const errorData = await res.json();
                        if (currentExport()) toast.error(errorData.message || 'Failed to export data.');
                      }
                    } catch (err) {
                      console.error('Export error:', err);
                      if (currentExport()) toast.error('Failed to export data.');
                    } finally {
                      exportInFlight.current = false;
                      setExportLoading(false);
                    }
                  }}
                  disabled={exportLoading}
                  variant="outline"
                  className="w-full h-11 justify-center gap-2 rounded-lg"
                >
                  <Download className="w-4 h-4" />
                  {exportLoading ? 'Preparing export...' : 'Export Data'}
                </Button>

                <Button
                  asChild
                  variant="outline"
                  className="w-full h-11 justify-center gap-2 rounded-lg"
                >
                  <a href="https://my.plaid.com/" target="_blank" rel="noopener noreferrer">
                    <Shield className="w-4 h-4" />
                    Revoke Plaid Access
                    <ExternalLink className="w-3.5 h-3.5 ml-1" />
                  </a>
                </Button>

                <Button
                  onClick={() => {
                    setConfirmDialog({
                      open: true,
                      title: 'Delete Account',
                      description: 'Are you sure you want to delete your account and all associated data? This includes all Plaid connections, accounts, transactions, and receipts. This action cannot be undone.',
                      confirmLabel: 'Delete Account',
                      variant: 'destructive',
                      onConfirm: async () => {
                        try {
                          const res = await fetch('/api/user/delete', { method: 'DELETE' });
                          const result = await res.json();
                          if (result.success) {
                            toast.success('Account deleted. You will be logged out.');
                            window.location.href = '/';
                          } else {
                            const errorMsg = result.details || result.error || 'Unknown error';
                            toast.error(errorMsg || 'Failed to delete account.');
                          }
                        } catch (err) {
                          console.error('Error deleting account:', err);
                          toast.error('Failed to delete account.');
                        }
                      },
                    });
                  }}
                  variant="destructive"
                  className="w-full h-11 justify-center gap-2 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Account
                </Button>
              </div>
            </SettingsSection>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmLabel={confirmDialog.confirmLabel}
        variant={confirmDialog.variant}
        onConfirm={() => {
          setConfirmDialog(prev => ({ ...prev, open: false }));
          confirmDialog.onConfirm();
        }}
      />
    </div>
  );
};
