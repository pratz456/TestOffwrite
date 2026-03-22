"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/simple-select';
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
import { getUserProfile, upsertUserProfile, UserProfile } from '@/lib/firebase/profiles';
import { useBeforeUnload } from '@/lib/hooks/use-before-unload';
import { CreditCard, Calendar, Sparkles, ExternalLink, XCircle, AlertTriangle, Home, Car, Receipt, Info, Building2, Landmark, Download, Trash2, Link2 } from 'lucide-react';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { TrialCountdown } from '@/components/trial-countdown';
import { toast } from 'sonner';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Badge } from '@/components/ui/badge';

// Payment Settings Tab Component
const PaymentSettingsTab: React.FC<{ user: any }> = ({ user }) => {
  const [loading, setLoading] = useState(true);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [accessStatus, setAccessStatus] = useState<any>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    variant: 'default' | 'destructive';
    onConfirm: () => void;
  }>({ open: false, title: '', description: '', confirmLabel: 'Confirm', variant: 'default', onConfirm: () => {} });

  useEffect(() => {
    const fetchAccessStatus = async () => {
      try {
        const response = await makeAuthenticatedRequest('/api/subscriptions/check-access');
        if (response.ok) {
          const data = await response.json();
          setAccessStatus(data.data);
        }
      } catch (error) {
        console.error('Error fetching access status:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAccessStatus();

    // Refresh every minute to update countdown
    const interval = setInterval(fetchAccessStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleManageBilling = () => {
    // Navigate to subscription selection page to choose a plan
    window.location.href = '/protected/subscriptions';
  };

  const doCancelSubscription = async () => {
    setCancelLoading(true);
    try {
      const response = await makeAuthenticatedRequest('/api/stripe/cancel-subscription', {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        toast.success('Subscription cancelled. Access continues until end of billing period.');
        const statusResponse = await makeAuthenticatedRequest('/api/subscriptions/check-access');
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          setAccessStatus(statusData.data);
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.error || 'Failed to cancel subscription.');
      }
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      toast.error('Failed to cancel subscription.');
    } finally {
      setCancelLoading(false);
    }
  };

  const handleCancelSubscription = () => {
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
      <div className="p-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Historical Transactions Subscription</h3>
        </div>

        {accessStatus?.hasAccess ? (
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
                  <p className="font-medium text-foreground text-sm">Status</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={accessStatus.isTrial ? 'default' : 'default'}>
                      {accessStatus.isTrial ? 'Trial Active' : accessStatus.subscription?.status === 'canceled' ? 'Cancelled' : 'Active'}
                    </Badge>
                    {accessStatus.subscription?.cancelAtPeriodEnd && (
                      <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">
                        Cancelling at period end
                      </Badge>
                    )}
                  </div>
                </div>
                {!accessStatus.isTrial && accessStatus.daysRemaining !== undefined && (
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Renews in</p>
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
                      {accessStatus.subscription.planInterval === 'year' ? 'Yearly' : 'Monthly'} Plan
                      {accessStatus.subscription.planAmount && (
                        <span className="ml-2">
                          ${accessStatus.subscription.planAmount.toFixed(2)}/{accessStatus.subscription.planInterval === 'year' ? 'year' : 'month'}
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

              {accessStatus.trialEnd && !accessStatus.isTrial && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  <span>
                    Next billing: {accessStatus.subscriptionEnd ? new Date(accessStatus.subscriptionEnd).toLocaleDateString() : 'N/A'}
                  </span>
                </div>
              )}

              {accessStatus.subscription?.cancelAtPeriodEnd && (
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

              <div className="flex gap-3">
                <Button
                  onClick={handleManageBilling}
                  className="flex-1"
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
                    className="flex-1"
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
        ) : (
          <div className="p-4 bg-muted/30 border border-border rounded-lg space-y-4">
            <p className="text-sm text-muted-foreground">
              You don't have an active subscription. Upgrade to access up to 24 months (depending on your bank).
            </p>
            <div className="flex gap-3">
              <Button
                onClick={() => window.location.href = '/protected/subscriptions'}
                variant="outline"
                size="sm"
                className="flex-1"
              >
                View Upgrade Options
                <ExternalLink className="ml-2 w-4 h-4" />
              </Button>
              <Button
                onClick={() => {
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
                          window.location.reload();
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
                className="flex-1"
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
            Manage your payment methods, billing address, and invoice history through the Stripe billing portal.
          </p>
          <Button
            onClick={handleManageBilling}
            disabled={!accessStatus?.hasAccess}
            variant="outline"
            size="sm"
            className="w-full"
          >
            Open Billing Portal
            <ExternalLink className="ml-2 w-4 h-4" />
          </Button>
          {!accessStatus?.hasAccess && (
            <p className="text-xs text-muted-foreground mt-2">
              Subscribe first to access billing management
            </p>
          )}
        </div>
      </div>

      {/* Information */}
      <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <p className="text-xs text-blue-800 dark:text-blue-200">
          <strong>Note:</strong> The billing portal allows you to update payment methods, view invoices,
          cancel your subscription, and manage all billing-related settings securely through Stripe.
        </p>
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

// Simple wrapper for Select components
const SimpleSelectWrapper: React.FC<{
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}> = ({ value, onValueChange, placeholder, options }) => {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-10 rounded-lg border border-border bg-background">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

// Reusable settings field component
const SettingsField = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div className="space-y-1.5">
    <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</Label>
    {children}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

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

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  user,
  onBack,
  onNavigate,
  inAppNavigation = false
}) => {
  const [profile, setProfile] = useState({
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

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
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
        prior_year_deductions: profile.prior_year_deductions
      };

      const { data, error } = await upsertUserProfile(user.id, profileData as any);

      if (error) {
        console.error('Error saving profile:', error);
        setSaveStatus('error');
        setErrorMessage(`Failed to save: ${(error as any)?.message || 'Unknown error'}`);
        return;
      }

      setSaveStatus('saved');
      setHasUnsavedChanges(false);

      // Clear saved message after 2 seconds
      setTimeout(() => {
        setSaveStatus('idle');
      }, 2000);

    } catch (err) {
      console.error('Error saving profile:', err);
      setSaveStatus('error');
      setErrorMessage(`Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  }, [profile, user.id]);

  // Auto-save with debounce
  const handleProfileChange = useCallback((changes: Partial<typeof profile>) => {
    setProfile(prev => ({ ...prev, ...changes }));
    setHasUnsavedChanges(true);

    // Clear any existing timeout
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    // Set status to idle (pending)
    setSaveStatus('idle');

    // Auto-save after 1.5s of no changes
    saveTimeoutRef.current = setTimeout(() => {
      handleSave();
    }, 1500);
  }, [handleSave]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Handle profession selection (multiple selection)
  const handleProfessionChange = (profession: string, checked: boolean) => {
    const newProfessions = checked
      ? [...profile.profession, profession]
      : profile.profession.filter(p => p !== profession);
    const customProfession = profession === 'Other' && !checked ? '' : profile.customProfession;
    handleProfileChange({ profession: newProfessions, customProfession });
  };

  // Load existing profile data
  useEffect(() => {
    const loadProfile = async () => {
      try {
        setIsLoading(true);

        const { data: existingProfile, error } = await getUserProfile(user.id);

        if (error && error.code !== 'PGRST116') {
          console.error('Error loading profile:', error);
          setErrorMessage('Failed to load profile data');
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
            w2_income: existingProfile.w2_income,
            business_income: existingProfile.business_income,
            naics_code: existingProfile.naics_code || '',
            w2_federal_withheld: existingProfile.w2_federal_withheld,
            home_office_sqft: existingProfile.home_office_sqft,
            total_home_sqft: existingProfile.total_home_sqft,
            home_office_method: existingProfile.home_office_method || '',
            vehicle_business_use_percentage: existingProfile.vehicle_business_use_percentage,
            vehicle_deduction_method: existingProfile.vehicle_deduction_method || '',
            itemization_status: existingProfile.itemization_status || '',
            health_insurance_premiums: existingProfile.health_insurance_premiums,
            sep_ira_contribution: existingProfile.sep_ira_contribution,
            solo_401k_contribution: existingProfile.solo_401k_contribution,
            hsa_contribution: existingProfile.hsa_contribution,
            simple_ira_contribution: (existingProfile as any).simple_ira_contribution,
            audit_history: existingProfile.audit_history || 'none',
            tax_professional: existingProfile.tax_professional || false,
            documentation_habits: existingProfile.documentation_habits || 'moderate',
            business_seasonality: existingProfile.business_seasonality || 'year_round',
            multiple_locations: existingProfile.multiple_locations || false,
            international_business: existingProfile.international_business || false,
            tax_bracket: existingProfile.tax_bracket,
            prior_year_tax: existingProfile.prior_year_tax,
            professional_licenses: existingProfile.professional_licenses || [],
            prior_year_deductions: existingProfile.prior_year_deductions || []
          };

          setProfile(loadedProfile);
          setHasUnsavedChanges(false);
        }

        setIsLoading(false);
      } catch (err) {
        console.error('Error loading profile:', err);
        setErrorMessage('Failed to load profile data');
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [user.id, user?.user_metadata?.name, user?.email]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-50">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">Settings</h1>

          {/* Save status pill */}
          <div className="flex items-center">
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
                  className="text-xs font-medium text-red-700 dark:text-red-300 underline ml-1"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4 sm:px-6 sm:py-6 space-y-4 sm:space-y-6">
        {/* Tab Navigation */}
        <div className="flex gap-1 bg-muted rounded-xl p-1.5 border border-border">
          {([
            { key: 'profile' as SettingsTab, label: 'Profile & Business', icon: User },
            { key: 'tax' as SettingsTab, label: 'Tax Settings', icon: Receipt },
            { key: 'account' as SettingsTab, label: 'Account', icon: Shield },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 px-3 py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all duration-150 flex items-center justify-center gap-1.5 ${
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
        </div>

        {/* ============= TAB 1: Profile & Business ============= */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            {/* Tax Filing Essentials - Highlighted Card */}
            <Card className="p-4 sm:p-5 border-l-4 border-l-primary bg-primary/[0.03] border-border">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-5 h-5 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Tax Filing Essentials</h3>
              </div>
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
                      className="h-10 rounded-lg border-border bg-background pl-9"
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
                      className="h-10 rounded-lg border-border bg-background pl-9"
                    />
                  </div>
                </SettingsField>
              </div>
            </Card>

            {/* Personal Information */}
            <section className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <User className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Personal Information</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SettingsField label="Full Name">
                  <Input
                    type="text"
                    value={profile.name}
                    onChange={(e) => handleProfileChange({ name: e.target.value })}
                    placeholder="Enter your full name"
                    className="h-10 rounded-lg border-border bg-background"
                  />
                </SettingsField>
                <SettingsField label="Email">
                  <Input
                    type="email"
                    value={profile.email}
                    readOnly
                    className="h-10 rounded-lg border-border bg-muted/50 text-muted-foreground cursor-not-allowed"
                  />
                </SettingsField>
              </div>
            </section>

            {/* Professional Information */}
            <section className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <Briefcase className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Professional Information</h3>
              </div>
              <SettingsField label="Profession(s)" hint="Select all that apply">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3">
                  {professionOptions.map((option) => (
                    <label key={option.value} className="flex items-center space-x-2 rounded-md px-2 py-1.5 hover:bg-muted transition-colors cursor-pointer">
                      <Checkbox
                        checked={profile.profession.includes(option.label)}
                        onCheckedChange={(checked) => handleProfessionChange(option.label, checked as boolean)}
                        className="text-primary"
                      />
                      <span className="text-sm text-foreground">{option.label}</span>
                    </label>
                  ))}
                </div>
              </SettingsField>
              {profile.profession.includes('Other') && (
                <SettingsField label="Custom Profession" hint="Separate multiple with commas">
                  <Input
                    type="text"
                    value={profile.customProfession || ''}
                    onChange={(e) => handleProfileChange({ customProfession: e.target.value })}
                    placeholder="Enter your profession"
                    className="h-10 rounded-lg border-border bg-background"
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
            </section>

            {/* Business Details */}
            <section className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <Building2 className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Business Details</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SettingsField label="Business Purpose">
                  <Input
                    type="text"
                    value={profile.business_purpose}
                    onChange={(e) => handleProfileChange({ business_purpose: e.target.value })}
                    placeholder="e.g., Software consulting"
                    className="h-10 rounded-lg border-border bg-background"
                  />
                </SettingsField>
                <SettingsField label="Business Start Date">
                  <Input
                    type="date"
                    value={profile.business_start_date}
                    onChange={(e) => handleProfileChange({ business_start_date: e.target.value })}
                    className="h-10 rounded-lg border-border bg-background"
                  />
                </SettingsField>
                <SettingsField label="EIN">
                  <Input
                    type="text"
                    value={profile.ein}
                    onChange={(e) => handleProfileChange({ ein: e.target.value })}
                    placeholder="XX-XXXXXXX"
                    className="h-10 rounded-lg border-border bg-background"
                  />
                </SettingsField>
                <SettingsField label="NAICS Code">
                  <Input
                    type="text"
                    value={profile.naics_code}
                    onChange={(e) => handleProfileChange({ naics_code: e.target.value })}
                    placeholder="e.g., 541511"
                    className="h-10 rounded-lg border-border bg-background"
                  />
                </SettingsField>
              </div>
            </section>

            {/* Mailing Address */}
            <section className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <MapPin className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Mailing Address</h3>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <SettingsField label="Street Address">
                  <Input
                    type="text"
                    value={profile.mailing_address.street}
                    onChange={(e) => handleProfileChange({ mailing_address: { ...profile.mailing_address, street: e.target.value } })}
                    placeholder="123 Main St"
                    className="h-10 rounded-lg border-border bg-background"
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
                        className="h-10 rounded-lg border-border bg-background"
                      />
                    </SettingsField>
                  </div>
                  <SettingsField label="State">
                    <Input
                      type="text"
                      value={profile.mailing_address.state}
                      onChange={(e) => handleProfileChange({ mailing_address: { ...profile.mailing_address, state: e.target.value } })}
                      placeholder="CA"
                      className="h-10 rounded-lg border-border bg-background"
                    />
                  </SettingsField>
                  <SettingsField label="Zip">
                    <Input
                      type="text"
                      value={profile.mailing_address.zip}
                      onChange={(e) => handleProfileChange({ mailing_address: { ...profile.mailing_address, zip: e.target.value } })}
                      placeholder="90210"
                      className="h-10 rounded-lg border-border bg-background"
                    />
                  </SettingsField>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* ============= TAB 2: Tax Settings ============= */}
        {activeTab === 'tax' && (
          <div className="space-y-6">
            {/* Home Office Deduction */}
            <section className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <Home className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Home Office Deduction</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SettingsField label="Home Office Sqft">
                  <Input
                    type="number"
                    value={profile.home_office_sqft ?? ''}
                    onChange={(e) => handleProfileChange({ home_office_sqft: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="0"
                    className="h-10 rounded-lg border-border bg-background"
                  />
                </SettingsField>
                <SettingsField label="Total Home Sqft">
                  <Input
                    type="number"
                    value={profile.total_home_sqft ?? ''}
                    onChange={(e) => handleProfileChange({ total_home_sqft: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="0"
                    className="h-10 rounded-lg border-border bg-background"
                  />
                </SettingsField>
                <SettingsField label="Home Office Method">
                  <SimpleSelectWrapper
                    value={profile.home_office_method}
                    onValueChange={(value) => handleProfileChange({ home_office_method: value })}
                    placeholder="Select method"
                    options={[
                      { value: 'simplified', label: 'Simplified $5/sqft' },
                      { value: 'actual', label: 'Actual Expenses' }
                    ]}
                  />
                </SettingsField>
              </div>
            </section>

            {/* Vehicle Deduction */}
            <section className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <Car className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Vehicle Deduction</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SettingsField label="Vehicle Business Use %" hint="0-100">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={profile.vehicle_business_use_percentage ?? ''}
                    onChange={(e) => handleProfileChange({ vehicle_business_use_percentage: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="0"
                    className="h-10 rounded-lg border-border bg-background"
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
            </section>

            {/* Tax Preferences */}
            <section className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <FileText className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Tax Preferences</h3>
              </div>
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
                      className="h-10 rounded-lg border-border bg-background pl-9"
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
                    className="h-10 rounded-lg border-border bg-background"
                  />
                </SettingsField>
              </div>
            </section>

            {/* Above-the-Line Deductions */}
            <section className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <Receipt className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Above-the-Line Deductions</h3>
              </div>
              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-800 dark:text-blue-200">
                  These deductions reduce your adjusted gross income (AGI) and are available whether you itemize or take the standard deduction.
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
                      className="h-10 rounded-lg border-border bg-background pl-9"
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
                      className="h-10 rounded-lg border-border bg-background pl-9"
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
                      className="h-10 rounded-lg border-border bg-background pl-9"
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
                      className="h-10 rounded-lg border-border bg-background pl-9"
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
                      className="h-10 rounded-lg border-border bg-background pl-9"
                    />
                  </div>
                </SettingsField>
              </div>
            </section>
          </div>
        )}

        {/* ============= TAB 3: Account ============= */}
        {activeTab === 'account' && (
          <div className="space-y-6">
            {/* Bank Connections */}
            <section className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <Landmark className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Bank Connections</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  onClick={() => {
                    if (inAppNavigation) {
                      onNavigate('plaid-link?from=settings');
                    } else {
                      window.location.href = '/protected/plaid-link?from=settings';
                    }
                  }}
                  className="h-10 bg-primary hover:bg-primary/90 text-white rounded-lg flex items-center justify-center gap-2"
                >
                  <Link2 className="w-4 h-4" />
                  <span className="text-sm">Connect Bank</span>
                </Button>
                <Button
                  type="button"
                  onClick={() => onNavigate('plaid')}
                  variant="outline"
                  className="h-10 rounded-lg flex items-center justify-center gap-2"
                >
                  <DollarSign className="w-4 h-4" />
                  <span className="text-sm">Manage Accounts</span>
                </Button>
              </div>
            </section>

            {/* Subscription */}
            <section className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <CreditCard className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Subscription</h3>
              </div>
              <PaymentSettingsTab user={user} />
            </section>

            {/* Data & Privacy */}
            <section className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <Shield className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">Data & Privacy</h3>
              </div>
              <div className="space-y-3">
                <Button
                  onClick={async () => {
                    try {
                      // Check if user can export (rate limiting)
                      const statusRes = await fetch('/api/user/export');
                      const statusData = await statusRes.json();

                      if (!statusData.canExport) {
                        toast.warning(`Export limit reached. Please wait ${statusData.timeRemaining} minutes.`);
                        return;
                      }

                      // Request the export
                      const res = await fetch('/api/user/export', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                      });

                      if (res.ok) {
                        const exportData = await res.json();

                        // Create downloadable files
                        const timestamp = new Date().toISOString().split('T')[0];
                        const exportId = exportData.exportId;

                        // Download JSON data
                        const jsonBlob = new Blob([JSON.stringify(exportData.data.json, null, 2)], { type: 'application/json' });
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

                        toast.success(`Exported ${exportData.summary.transactions} transactions, ${exportData.summary.accounts} accounts, and ${exportData.summary.receipts} receipts.`);
                      } else {
                        const errorData = await res.json();
                        toast.error(errorData.message || 'Failed to export data.');
                      }
                    } catch (err) {
                      console.error('Export error:', err);
                      toast.error('Failed to export data.');
                    }
                  }}
                  variant="outline"
                  className="w-full h-10 justify-center gap-2 rounded-lg"
                >
                  <Download className="w-4 h-4" />
                  Export Data
                </Button>

                <Button
                  asChild
                  variant="outline"
                  className="w-full h-10 justify-center gap-2 rounded-lg"
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
                  className="w-full h-10 justify-center gap-2 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Account
                </Button>
              </div>
            </section>
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
