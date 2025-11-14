"use client";

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/simple-select';
import { Badge } from '@/components/ui/badge';
import {
  User,
  Briefcase,
  DollarSign,
  FileText,
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  Shield
} from '@/lib/icons';
import { getUserProfile, upsertUserProfile, UserProfile } from '@/lib/firebase/profiles';

// Simple wrapper for Select components
const SimpleSelectWrapper: React.FC<{
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}> = ({ value, onValueChange, placeholder, options }) => {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-12 rounded-xl border border-border bg-background">
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

type SettingsTab = 'profile' | 'businessDetails' | 'taxSettings' | 'advancedSettings';

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  user,
  onBack,
  onNavigate,
  inAppNavigation = false
}) => {
  const [profile, setProfile] = useState({
    // Profile Tab - Required Fields
    name: user?.user_metadata?.name || '',
    email: user?.email || '',
    profession: [] as string[],
    customProfession: '',
    businessEntityType: '',
    state: '',
    filing_status: '',
    income: '',

    // Business Details Tab
    business_purpose: '',
    business_start_date: '',
    ein: '',
    w2_income: undefined as number | undefined,
    business_income: undefined as number | undefined,
    naics_code: '',

    // Tax Settings Tab - Required Fields
    home_office_sqft: undefined as number | undefined,
    total_home_sqft: undefined as number | undefined,
    home_office_method: '',
    vehicle_business_use_percentage: undefined as number | undefined,
    vehicle_deduction_method: '',
    itemization_status: '',

    // Advanced Tab
    audit_history: 'none',
    tax_professional: false,
    documentation_habits: 'moderate',
    business_seasonality: 'year_round',
    multiple_locations: false,
    international_business: false,
    tax_bracket: undefined as number | undefined,
    professional_licenses: [] as string[],
    prior_year_deductions: [] as string[]
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'profile' | 'businessDetails' | 'taxSettings' | 'advancedSettings'>('profile');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [originalProfile, setOriginalProfile] = useState<any>(null);
  const [editState, setEditState] = useState<Record<SettingsTab, boolean>>({
    profile: false,
    businessDetails: false,
    taxSettings: false,
    advancedSettings: false,
  });

  const isEditingCurrentTab = editState[activeTab];

  const startEditing = (tab: SettingsTab) => {
    setEditState(prev => ({ ...prev, [tab]: true }));
    setSaveStatus('idle');
    setErrorMessage('');
    setHasUnsavedChanges(false);
  };

  const cancelEditing = (tab: SettingsTab) => {
    if (originalProfile) {
      setProfile(JSON.parse(JSON.stringify(originalProfile)));
    }
    setEditState(prev => ({ ...prev, [tab]: false }));
    setHasUnsavedChanges(false);
    setSaveStatus('idle');
    setErrorMessage('');
  };

  // Track changes to show unsaved indicator
  const handleProfileChange = (updates: any) => {
    if (!isEditingCurrentTab) return;
    setProfile(prev => ({ ...prev, ...updates }));
    setHasUnsavedChanges(true);
  };

  // Load existing profile data
  useEffect(() => {
    const loadProfile = async () => {
      try {
        setIsLoading(true);
        console.log('Loading profile for user:', {
          id: user.id,
          email: user.email,
          metadata: user.user_metadata
        });

        const { data: existingProfile, error } = await getUserProfile(user.id);

        if (error && error.code !== 'PGRST116') {
          console.error('Error loading profile:', error);
          setErrorMessage('Failed to load profile data');
          return;
        }

        if (existingProfile) {
          console.log('Loaded existing profile:', existingProfile);

          // Parse profession string and handle custom professions
          const professionString = existingProfile.profession || '';
          const professionArray = professionString ? professionString.split(', ').filter(p => p.trim()) : [];

          const predefinedProfessions = [
            'Software Developer', 'Freelance Writer', 'Graphic Designer', 'Consultant', 'Marketing Specialist',
            'Real Estate Agent', 'Photographer', 'Web Designer', 'Content Creator', 'Business Coach',
            'Virtual Assistant', 'Social Media Manager', 'Online Tutor', 'E-commerce Store Owner', 'Other'
          ];

          const customProfessions = professionArray.filter(p => !predefinedProfessions.includes(p));
          const standardProfessions = professionArray.filter(p => predefinedProfessions.includes(p));

          const finalProfessions = customProfessions.length > 0
            ? [...standardProfessions, 'Other']
            : standardProfessions;

          const loadedProfile = {
            // Profile Tab - Map all fields from database
            name: existingProfile.name || user?.user_metadata?.name || '',
            email: existingProfile.email || user?.email || '',
            profession: finalProfessions,
            customProfession: customProfessions.join(', '),
            businessEntityType: existingProfile.business_entity_type || '',
            state: existingProfile.state || '',
            filing_status: existingProfile.filing_status || '',
            income: existingProfile.income || '',

            // Business Details Tab - Map all business fields
            business_purpose: existingProfile.business_purpose || '',
            business_start_date: existingProfile.business_start_date || '',
            ein: existingProfile.ein || '',
            w2_income: existingProfile.w2_income,
            business_income: existingProfile.business_income,
            naics_code: existingProfile.naics_code || '',

            // Tax Settings Tab - Map all tax-related fields
            home_office_sqft: existingProfile.home_office_sqft,
            total_home_sqft: existingProfile.total_home_sqft,
            home_office_method: existingProfile.home_office_method || '',
            vehicle_business_use_percentage: existingProfile.vehicle_business_use_percentage,
            vehicle_deduction_method: existingProfile.vehicle_deduction_method || '',
            itemization_status: existingProfile.itemization_status || '',

            // Advanced Tab - Map all advanced fields
            audit_history: existingProfile.audit_history || 'none',
            tax_professional: existingProfile.tax_professional || false,
            documentation_habits: existingProfile.documentation_habits || 'moderate',
            business_seasonality: existingProfile.business_seasonality || 'year_round',
            multiple_locations: existingProfile.multiple_locations || false,
            international_business: existingProfile.international_business || false,
            tax_bracket: existingProfile.tax_bracket,
            professional_licenses: existingProfile.professional_licenses || [],
            prior_year_deductions: existingProfile.prior_year_deductions || []
          };

          console.log('Mapped profile data:', loadedProfile);

          setProfile(loadedProfile);
          setOriginalProfile(JSON.parse(JSON.stringify(loadedProfile)));
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

  const handleInputChange = (field: string, value: string | boolean) => {
    setProfile(prev => ({
      ...prev,
      [field]: value
    }));
    setSaveStatus('idle');
  };

  // Handle profession selection (multiple selection)
  const handleProfessionChange = (profession: string, checked: boolean) => {
    if (!editState.profile) return;
    setProfile(prev => ({
      ...prev,
      profession: checked
        ? [...prev.profession, profession]
        : prev.profession.filter(p => p !== profession),
      // Clear custom profession if "Other" is deselected
      customProfession: profession === 'Other' && !checked ? '' : prev.customProfession
    }));
    setHasUnsavedChanges(true);
  };

  const handleSave = async () => {
    if (!editState[activeTab]) {
      return;
    }
    try {
      setIsSaving(true);
      setSaveStatus('idle');
      setErrorMessage('');

      console.log('Attempting to save profile for user:', user.id);

      // Prepare profession string - include custom profession if "Other" is selected
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

        // Business Details
        business_purpose: profile.business_purpose,
        business_start_date: profile.business_start_date,
        ein: profile.ein,
        w2_income: profile.w2_income,
        business_income: profile.business_income,
        naics_code: profile.naics_code,

        // Tax Settings
        home_office_sqft: profile.home_office_sqft,
        total_home_sqft: profile.total_home_sqft,
        home_office_method: profile.home_office_method,
        vehicle_business_use_percentage: profile.vehicle_business_use_percentage,
        vehicle_deduction_method: profile.vehicle_deduction_method,
        itemization_status: profile.itemization_status,

        // Advanced Settings
        audit_history: profile.audit_history,
        tax_professional: profile.tax_professional,
        documentation_habits: profile.documentation_habits,
        business_seasonality: profile.business_seasonality,
        multiple_locations: profile.multiple_locations,
        international_business: profile.international_business,
        tax_bracket: profile.tax_bracket,
        professional_licenses: profile.professional_licenses,
        prior_year_deductions: profile.prior_year_deductions
      };

      console.log('Profile data to save:', profileData);

      const { data, error } = await upsertUserProfile(user.id, profileData);

      if (error) {
        console.error('Error saving profile:', error);
        setSaveStatus('error');
        setErrorMessage(`Failed to save profile: ${(error as any)?.message || 'Unknown error'}`);
        return;
      }

      console.log('Profile saved successfully:', data);
      setSaveStatus('success');
      setHasUnsavedChanges(false);
      setOriginalProfile(JSON.parse(JSON.stringify(profile)));
      setEditState(prev => ({ ...prev, [activeTab]: false }));

      // Clear success message after 3 seconds
      setTimeout(() => {
        setSaveStatus('idle');
      }, 3000);

    } catch (err) {
      console.error('Error saving profile:', err);
      setSaveStatus('error');
      setErrorMessage(`Failed to save profile: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Validation - require essential fields for AI analysis
  const isFormValid = profile.name && profile.email && profile.profession.length > 0 && profile.income && profile.state && profile.filing_status;

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
    { value: 'Qualifying Widower', label: 'Qualifying Widower' }
  ];

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

  const businessEntityTypeOptions = [
    { value: 'Sole Proprietor / Independent Contractor', label: 'Sole Proprietor / Independent Contractor' },
    { value: 'Single-Member LLC (disregarded entity)', label: 'Single-Member LLC (disregarded entity)' },
    { value: 'Multi-Member LLC', label: 'Multi-Member LLC' },
    { value: 'S-Corporation', label: 'S-Corporation' },
    { value: 'C-Corporation', label: 'C-Corporation' },
    { value: 'Partnership', label: 'Partnership' },
    { value: 'This does not apply to me', label: 'This does not apply to me' }
  ];

  const primaryWorkLocationOptions = [
    { value: 'home_office', label: 'Home Office' },
    { value: 'rented_office', label: 'Rented Office / Coworking Space' },
    { value: 'client_sites', label: 'Client Sites (Traveling)' },
    { value: 'retail_storefront', label: 'Retail / Commercial Storefront' },
    { value: 'warehouse_studio', label: 'Warehouse / Studio / Workshop' },
    { value: 'multiple_locations', label: 'Multiple Locations' },
    { value: 'not_applicable', label: 'This does not apply to me' }
  ];

  const workRelatedTravelPatternOptions = [
    { value: 'mostly_local', label: 'Mostly Local (rare overnight trips)' },
    { value: 'frequent_local', label: 'Frequent Local Travel (client visits, local driving)' },
    { value: 'regional_travel', label: 'Regional Travel (overnight <250 miles)' },
    { value: 'national_travel', label: 'National Travel (frequent domestic flights)' },
    { value: 'international_travel', label: 'International Travel' },
    { value: 'not_applicable', label: 'This does not apply to me' }
  ];

  const displayedProfessions = React.useMemo(() => {
    if (!profile.profession?.length) return [];
    if (profile.profession.includes('Other') && profile.customProfession) {
      return profile.profession
        .filter(p => p !== 'Other')
        .concat(profile.customProfession.split(',').map(item => item.trim()).filter(Boolean));
    }
    return profile.profession;
  }, [profile.profession, profile.customProfession]);

  const formatCurrency = (value?: number) => {
    if (value === undefined || value === null || Number.isNaN(value)) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  };

  const formatDate = (value?: string) => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString();
  };

  const renderViewField = (label: string, value: React.ReactNode) => {
    const content = value !== undefined && value !== null && value !== '' ? value : '—';
    return (
      <div className="space-y-1 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="text-sm md:text-base text-foreground">
          {typeof content === 'string' ? <span>{content}</span> : content}
        </div>
      </div>
    );
  };


  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading profile settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-50 shadow-sm">
        <div className="flex items-center justify-between p-6">
          {/* <button
            onClick={onBack}
            className="w-12 h-12 bg-card border border-border rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200 shadow-sm"
          >
            <ArrowLeft className="w-5 h-5" />
          </button> */}
          <div className="w-full flex flex-col items-center">
            <h2 className="text-4xl font-bold text-primary mb-2 text-center">Settings</h2>
            <p className="text-lg text-muted-foreground text-center">Manage your profile and preferences</p>
          </div>

          {/* Save Status Indicator */}
          <div className="flex items-center gap-3">
            {hasUnsavedChanges && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-800">Unsaved changes</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="max-w-5xl mx-auto space-y-6">
        {/* Save Status Messages */}
        {saveStatus === 'success' && (
          <Card className="p-4 bg-accent/5 border-accent/20 shadow-sm mb-6">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-6 h-6 text-accent" />
              <div>
                <p className="text-accent font-medium">Settings Updated Successfully</p>
                <p className="text-accent/80 text-sm">Your changes have been saved.</p>
              </div>
            </div>
          </Card>
        )}

        {saveStatus === 'error' && (
          <Card className="p-4 bg-red-50 border-red-200 shadow-sm mb-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-red-600" />
              <div>
                <p className="text-red-800 font-medium">Save Failed</p>
                <p className="text-red-600 text-sm">{errorMessage}</p>
              </div>
            </div>
          </Card>
        )}

        {/* Tab Navigation */}
        <div className="flex space-x-1 mb-6 bg-card/80 rounded-lg p-1 w-fit overflow-x-auto border border-border">
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${activeTab === 'profile'
              ? 'bg-primary/10 text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
          >
            <User className="w-4 h-4" />
            Profile
          </button>
          <button
            onClick={() => setActiveTab('businessDetails')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${activeTab === 'businessDetails'
              ? 'bg-primary/10 text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
          >
            <Briefcase className="w-4 h-4" />
            Business Details
          </button>
          <button
            onClick={() => setActiveTab('taxSettings')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${activeTab === 'taxSettings'
              ? 'bg-primary/10 text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
          >
            <FileText className="w-4 h-4" />
            Tax Settings
          </button>
          <button
            onClick={() => setActiveTab('advancedSettings')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${activeTab === 'advancedSettings'
              ? 'bg-primary/10 text-primary shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              }`}
          >
            <Shield className="w-4 h-4" />
            Advanced
          </button>
        </div>

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <Card className="p-8 bg-card border border-border shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-8">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-primary/90 flex items-center justify-center">
                  <User className="w-10 h-10 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-foreground">Profile Settings</h2>
                  <p className="text-sm text-muted-foreground">Manage your personal and professional information</p>
                </div>
              </div>
              {!editState.profile && (
                <Button
                  variant="outline"
                  className="h-11 rounded-lg border-border"
                  onClick={() => startEditing('profile')}
                >
                  Edit Profile
                </Button>
              )}
            </div>

            <div className="space-y-8">
              {/* Personal Information Section */}
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <User className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">Personal Information</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {editState.profile ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">
                          Full Name <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          type="text"
                          value={profile.name}
                          onChange={(e) => handleProfileChange({ name: e.target.value })}
                          placeholder="Enter your full name"
                          className="h-12 rounded-lg border-border bg-background"
                          required
                        />
                        <p className="text-xs text-muted-foreground">Required for AI analysis</p>
                      </>
                    ) : (
                      renderViewField('Full Name', profile.name || '—')
                    )}
                  </div>
                  <div className="space-y-2">
                    {editState.profile ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">
                          Email Address <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          type="email"
                          value={profile.email}
                          onChange={(e) => handleProfileChange({ email: e.target.value })}
                          placeholder="Enter your email"
                          className="h-12 rounded-lg border-border bg-background"
                          required
                        />
                        <p className="text-xs text-muted-foreground">Required for account management</p>
                      </>
                    ) : (
                      renderViewField('Email Address', profile.email || '—')
                    )}
                  </div>
                </div>
              </section>

              {/* Professional Information Section */}
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">Professional Information</h3>
                </div>

                <div className="space-y-3">
                  {editState.profile ? (
                    <>
                      <Label className="text-sm font-medium text-foreground">
                        Profession(s) <span className="text-destructive">*</span>
                      </Label>
                      <p className="text-xs text-muted-foreground">Select all that apply to your work</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-52 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
                        {professionOptions.map((option) => (
                          <label key={option.value} className="flex items-center space-x-2 rounded-md px-3 py-2 hover:bg-muted transition-colors cursor-pointer">
                            <Checkbox
                              checked={profile.profession.includes(option.label)}
                              onCheckedChange={(checked) => handleProfessionChange(option.label, checked as boolean)}
                              className="text-primary"
                            />
                            <span className="text-sm text-foreground">{option.label}</span>
                          </label>
                        ))}
                      </div>
                      {profile.profession.includes('Other') && (
                        <div className="space-y-2">
                          <Label className="text-sm font-medium text-foreground">
                            Custom Profession <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            type="text"
                            value={profile.customProfession || ''}
                            onChange={(e) => handleProfileChange({ customProfession: e.target.value })}
                            placeholder="Enter your profession"
                            className="h-10 rounded-lg border-border bg-background text-sm"
                          />
                          <p className="text-xs text-muted-foreground">Separate multiple professions with commas</p>
                        </div>
                      )}
                    </>
                  ) : (
                    renderViewField(
                      'Professions',
                      displayedProfessions.length ? (
                        <div className="flex flex-wrap gap-2">
                          {displayedProfessions.map((item, idx) => (
                            <Badge key={`${item}-${idx}`} variant="secondary" className="rounded-full px-3 py-1 text-xs">
                              {item}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        '—'
                      )
                    )
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {editState.profile ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">
                          Business Entity Type <span className="text-destructive">*</span>
                        </Label>
                        <SimpleSelectWrapper
                          value={profile.businessEntityType}
                          onValueChange={(value) => handleProfileChange({ businessEntityType: value })}
                          placeholder="Select your business entity type"
                          options={businessEntityTypeOptions}
                        />
                        <p className="text-xs text-muted-foreground">Required for tax calculations</p>
                      </>
                    ) : (
                      renderViewField('Business Entity Type', profile.businessEntityType || '—')
                    )}
                  </div>
                  <div className="space-y-2">
                    {editState.profile ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">
                          State <span className="text-destructive">*</span>
                        </Label>
                        <SimpleSelectWrapper
                          value={profile.state}
                          onValueChange={(value) => handleProfileChange({ state: value })}
                          placeholder="Select your state"
                          options={stateOptions}
                        />
                        <p className="text-xs text-muted-foreground">Required for state tax calculations</p>
                      </>
                    ) : (
                      renderViewField('State', profile.state || '—')
                    )}
                  </div>
                  <div className="space-y-2">
                    {editState.profile ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">
                          Filing Status <span className="text-destructive">*</span>
                        </Label>
                        <SimpleSelectWrapper
                          value={profile.filing_status}
                          onValueChange={(value) => handleProfileChange({ filing_status: value })}
                          placeholder="Select filing status"
                          options={filingStatusOptions}
                        />
                        <p className="text-xs text-muted-foreground">Required for tax calculations</p>
                      </>
                    ) : (
                      renderViewField('Filing Status', profile.filing_status || '—')
                    )}
                  </div>
                  <div className="space-y-2">
                    {editState.profile ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">
                          Annual Income <span className="text-destructive">*</span>
                        </Label>
                        <SimpleSelectWrapper
                          value={profile.income}
                          onValueChange={(value) => handleProfileChange({ income: value })}
                          placeholder="Select income range"
                          options={incomeOptions}
                        />
                        <p className="text-xs text-muted-foreground">Required for AI analysis</p>
                      </>
                    ) : (
                      renderViewField('Annual Income', profile.income || '—')
                    )}
                  </div>
                </div>
              </section>

              {/* Save Button */}
              <div className="flex justify-end gap-3 pt-6 border-t border-border">
                {editState.profile ? (
                  <>
                    <Button
                      variant="outline"
                      className="h-11 px-6 rounded-lg"
                      onClick={() => cancelEditing('profile')}
                      disabled={isSaving}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={!isFormValid || isSaving}
                      className="h-11 px-6 rounded-lg"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-5 h-5 mr-2" />
                          Save Changes
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" className="h-11 px-6 rounded-lg" onClick={onBack}>
                    Close
                  </Button>
                )}
              </div>
              {editState.profile && !isFormValid && (
                <p className="text-sm text-destructive">
                  Please fill in all required fields (marked with *) to save your profile.
                </p>
              )}
            </div>
          </Card>
        )}

        {/* Tax Settings Tab */}
        {activeTab === 'taxSettings' && (
          <Card className="p-8 bg-card border border-border shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-8">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-purple-500/90 flex items-center justify-center">
                  <FileText className="w-10 h-10 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-foreground">Tax Settings</h2>
                  <p className="text-sm text-muted-foreground">Configure your tax preferences and deduction methods</p>
                </div>
              </div>
              {!editState.taxSettings && (
                <Button
                  variant="outline"
                  className="h-11 rounded-lg border-border"
                  onClick={() => startEditing('taxSettings')}
                >
                  Edit Tax Settings
                </Button>
              )}
            </div>

            <div className="space-y-8">
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-purple-500" />
                  <h3 className="text-lg font-semibold text-foreground">Home Office Deduction</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {editState.taxSettings ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">
                          Home Office Square Footage <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          type="number"
                          value={profile.home_office_sqft ?? ''}
                          onChange={(e) => handleProfileChange({ home_office_sqft: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                          placeholder="e.g., 150"
                          className="h-12 rounded-lg border-border bg-background"
                          required
                        />
                        <p className="text-xs text-muted-foreground">Required if you have a home office</p>
                      </>
                    ) : (
                      renderViewField('Home Office Square Footage', profile.home_office_sqft ?? '—')
                    )}
                  </div>
                  <div className="space-y-2">
                    {editState.taxSettings ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">
                          Total Home Square Footage <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          type="number"
                          value={profile.total_home_sqft ?? ''}
                          onChange={(e) => handleProfileChange({ total_home_sqft: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                          placeholder="e.g., 2000"
                          className="h-12 rounded-lg border-border bg-background"
                          required
                        />
                        <p className="text-xs text-muted-foreground">Required for home office calculation</p>
                      </>
                    ) : (
                      renderViewField('Total Home Square Footage', profile.total_home_sqft ?? '—')
                    )}
                  </div>
                  <div className="space-y-2">
                    {editState.taxSettings ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">
                          Home Office Method <span className="text-destructive">*</span>
                        </Label>
                        <SimpleSelectWrapper
                          value={profile.home_office_method}
                          onValueChange={(value) => handleProfileChange({ home_office_method: value })}
                          placeholder="Select method"
                          options={[
                            { value: 'simplified', label: 'Simplified Method ($5/sq ft)' },
                            { value: 'actual', label: 'Actual Expenses' }
                          ]}
                        />
                        <p className="text-xs text-muted-foreground">Choose your deduction method</p>
                      </>
                    ) : (
                      renderViewField(
                        'Home Office Method',
                        profile.home_office_method
                          ? profile.home_office_method === 'simplified'
                            ? 'Simplified Method'
                            : 'Actual Expenses'
                          : '—'
                      )
                    )}
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-purple-500" />
                  <h3 className="text-lg font-semibold text-foreground">Vehicle Deduction</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {editState.taxSettings ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">
                          Vehicle Business Use % <span className="text-destructive">*</span>
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={profile.vehicle_business_use_percentage ?? ''}
                          onChange={(e) => handleProfileChange({
                            vehicle_business_use_percentage: e.target.value ? parseInt(e.target.value, 10) : undefined
                          })}
                          placeholder="e.g., 75"
                          className="h-12 rounded-lg border-border bg-background"
                          required
                        />
                        <p className="text-xs text-muted-foreground">Required if you use a vehicle for business</p>
                      </>
                    ) : (
                      renderViewField(
                        'Vehicle Business Use %',
                        profile.vehicle_business_use_percentage !== undefined && profile.vehicle_business_use_percentage !== null
                          ? `${profile.vehicle_business_use_percentage}%`
                          : '—'
                      )
                    )}
                  </div>
                  <div className="space-y-2">
                    {editState.taxSettings ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">
                          Vehicle Deduction Method <span className="text-destructive">*</span>
                        </Label>
                        <SimpleSelectWrapper
                          value={profile.vehicle_deduction_method}
                          onValueChange={(value) => handleProfileChange({ vehicle_deduction_method: value })}
                          placeholder="Select method"
                          options={[
                            { value: 'standard_mileage', label: 'Standard Mileage Rate' },
                            { value: 'actual_expense', label: 'Actual Expenses' }
                          ]}
                        />
                        <p className="text-xs text-muted-foreground">Choose your deduction method</p>
                      </>
                    ) : (
                      renderViewField(
                        'Vehicle Deduction Method',
                        profile.vehicle_deduction_method
                          ? profile.vehicle_deduction_method === 'standard_mileage'
                            ? 'Standard Mileage Rate'
                            : 'Actual Expenses'
                          : '—'
                      )
                    )}
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-purple-500" />
                  <h3 className="text-lg font-semibold text-foreground">Tax Preferences</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {editState.taxSettings ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">
                          Itemization Status <span className="text-destructive">*</span>
                        </Label>
                        <SimpleSelectWrapper
                          value={profile.itemization_status}
                          onValueChange={(value) => handleProfileChange({ itemization_status: value })}
                          placeholder="Select itemization status"
                          options={[
                            { value: 'itemize', label: 'I itemize deductions' },
                            { value: 'standard', label: 'I take standard deduction' },
                            { value: 'unsure', label: 'I\'m not sure' }
                          ]}
                        />
                        <p className="text-xs text-muted-foreground">Required for tax calculations</p>
                      </>
                    ) : (
                      renderViewField(
                        'Itemization Status',
                        profile.itemization_status
                          ? profile.itemization_status === 'itemize'
                            ? 'I itemize deductions'
                            : profile.itemization_status === 'standard'
                              ? 'I take standard deduction'
                              : 'I\'m not sure'
                          : '—'
                      )
                    )}
                  </div>
                </div>
              </section>

              <div className="flex justify-end gap-3 pt-6 border-t border-border">
                {editState.taxSettings ? (
                  <>
                    <Button
                      variant="outline"
                      className="h-11 px-6 rounded-lg"
                      onClick={() => cancelEditing('taxSettings')}
                      disabled={isSaving}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="h-11 px-6 rounded-lg"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-5 h-5 mr-2" />
                          Save Changes
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" className="h-11 px-6 rounded-lg" onClick={onBack}>
                    Close
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Business Details Tab */}
        {activeTab === 'businessDetails' && (
          <Card className="p-8 bg-card border border-border shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-8">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-orange-500/90 flex items-center justify-center">
                  <Briefcase className="w-10 h-10 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-foreground">Business Details</h2>
                  <p className="text-sm text-muted-foreground">Configure your business structure and income information</p>
                </div>
              </div>
              {!editState.businessDetails && (
                <Button
                  variant="outline"
                  className="h-11 rounded-lg border-border"
                  onClick={() => startEditing('businessDetails')}
                >
                  Edit Business Details
                </Button>
              )}
            </div>

            <div className="space-y-8">
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-orange-500" />
                  <h3 className="text-lg font-semibold text-foreground">Business Information</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {editState.businessDetails ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">Business Purpose</Label>
                        <Input
                          type="text"
                          value={profile.business_purpose || ''}
                          onChange={(e) => handleProfileChange({ business_purpose: e.target.value })}
                          placeholder="Describe your business"
                          className="h-12 rounded-lg border-border bg-background"
                        />
                        <p className="text-xs text-muted-foreground">Helps AI understand your business context</p>
                      </>
                    ) : (
                      renderViewField('Business Purpose', profile.business_purpose || '—')
                    )}
                  </div>
                  <div className="space-y-2">
                    {editState.businessDetails ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">Business Start Date</Label>
                        <Input
                          type="date"
                          value={profile.business_start_date || ''}
                          onChange={(e) => handleProfileChange({ business_start_date: e.target.value })}
                          className="h-12 rounded-lg border-border bg-background"
                        />
                        <p className="text-xs text-muted-foreground">When did you start your business?</p>
                      </>
                    ) : (
                      renderViewField('Business Start Date', formatDate(profile.business_start_date))
                    )}
                  </div>
                  <div className="space-y-2">
                    {editState.businessDetails ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">EIN (Optional)</Label>
                        <Input
                          type="text"
                          value={profile.ein || ''}
                          onChange={(e) => handleProfileChange({ ein: e.target.value })}
                          placeholder="XX-XXXXXXX"
                          className="h-12 rounded-lg border-border bg-background"
                        />
                        <p className="text-xs text-muted-foreground">Employer Identification Number</p>
                      </>
                    ) : (
                      renderViewField('EIN', profile.ein || '—')
                    )}
                  </div>
                  <div className="space-y-2">
                    {editState.businessDetails ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">NAICS Code (Optional)</Label>
                        <Input
                          type="text"
                          value={profile.naics_code || ''}
                          onChange={(e) => handleProfileChange({ naics_code: e.target.value })}
                          placeholder="e.g., 541511"
                          className="h-12 rounded-lg border-border bg-background"
                        />
                        <p className="text-xs text-muted-foreground">North American Industry Classification System</p>
                      </>
                    ) : (
                      renderViewField('NAICS Code', profile.naics_code || '—')
                    )}
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-orange-500" />
                  <h3 className="text-lg font-semibold text-foreground">Income Information</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {editState.businessDetails ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">W-2 Income (Annual)</Label>
                        <Input
                          type="number"
                          value={profile.w2_income ?? ''}
                          onChange={(e) => handleProfileChange({ w2_income: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                          placeholder="e.g., 50000"
                          className="h-12 rounded-lg border-border bg-background"
                        />
                        <p className="text-xs text-muted-foreground">Income from employment (W-2)</p>
                      </>
                    ) : (
                      renderViewField('W-2 Income', formatCurrency(profile.w2_income))
                    )}
                  </div>
                  <div className="space-y-2">
                    {editState.businessDetails ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">Business Income (Annual)</Label>
                        <Input
                          type="number"
                          value={profile.business_income ?? ''}
                          onChange={(e) => handleProfileChange({ business_income: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                          placeholder="e.g., 30000"
                          className="h-12 rounded-lg border-border bg-background"
                        />
                        <p className="text-xs text-muted-foreground">Income from business activities</p>
                      </>
                    ) : (
                      renderViewField('Business Income', formatCurrency(profile.business_income))
                    )}
                  </div>
                </div>
              </section>

              <div className="flex justify-end gap-3 pt-6 border-t border-border">
                {editState.businessDetails ? (
                  <>
                    <Button
                      variant="outline"
                      className="h-11 px-6 rounded-lg"
                      onClick={() => cancelEditing('businessDetails')}
                      disabled={isSaving}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="h-11 px-6 rounded-lg"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-5 h-5 mr-2" />
                          Save Changes
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" className="h-11 px-6 rounded-lg" onClick={onBack}>
                    Close
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Advanced Settings Tab */}
        {activeTab === 'advancedSettings' && (
          <Card className="p-8 bg-card border border-border shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-8">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 md:w-20 md:h-20 rounded-xl bg-indigo-500/90 flex items-center justify-center">
                  <Shield className="w-10 h-10 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-foreground">Advanced Settings</h2>
                  <p className="text-sm text-muted-foreground">Optional advanced tax preferences and professional settings</p>
                </div>
              </div>
              {!editState.advancedSettings && (
                <Button
                  variant="outline"
                  className="h-11 rounded-lg border-border"
                  onClick={() => startEditing('advancedSettings')}
                >
                  Edit Advanced Settings
                </Button>
              )}
            </div>

            <div className="space-y-8">
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-indigo-500" />
                  <h3 className="text-lg font-semibold text-foreground">Professional Settings</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {editState.advancedSettings ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">Audit History</Label>
                        <SimpleSelectWrapper
                          value={profile.audit_history || 'none'}
                          onValueChange={(value) => handleProfileChange({ audit_history: value })}
                          placeholder="Select audit history"
                          options={[
                            { value: 'none', label: 'No audit history' },
                            { value: 'minor', label: 'Minor audit (simple questions)' },
                            { value: 'major', label: 'Major audit (detailed examination)' }
                          ]}
                        />
                        <p className="text-xs text-muted-foreground">Helps AI provide appropriate advice</p>
                      </>
                    ) : (
                      renderViewField(
                        'Audit History',
                        profile.audit_history === 'minor'
                          ? 'Minor audit (simple questions)'
                          : profile.audit_history === 'major'
                            ? 'Major audit (detailed examination)'
                            : 'No audit history'
                      )
                    )}
                  </div>
                  <div className="space-y-2">
                    {editState.advancedSettings ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">Tax Bracket (Optional)</Label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={profile.tax_bracket ?? ''}
                          onChange={(e) => handleProfileChange({ tax_bracket: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                          placeholder="e.g., 22"
                          className="h-12 rounded-lg border-border bg-background"
                        />
                        <p className="text-xs text-muted-foreground">Your marginal tax rate percentage</p>
                      </>
                    ) : (
                      renderViewField(
                        'Tax Bracket',
                        profile.tax_bracket !== undefined && profile.tax_bracket !== null
                          ? `${profile.tax_bracket}%`
                          : '—'
                      )
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {editState.advancedSettings ? (
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="tax_professional"
                          checked={profile.tax_professional || false}
                          onChange={(e) => handleProfileChange({ tax_professional: e.target.checked })}
                          className="w-4 h-4 text-indigo-600 border-border rounded focus:ring-indigo-500"
                        />
                        <Label htmlFor="tax_professional" className="text-sm font-medium text-foreground">
                          I use a tax professional
                        </Label>
                      </div>
                    ) : (
                      renderViewField('Uses Tax Professional', profile.tax_professional ? 'Yes' : 'No')
                    )}
                  </div>
                  <div className="space-y-2">
                    {editState.advancedSettings ? (
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="international_business"
                          checked={profile.international_business || false}
                          onChange={(e) => handleProfileChange({ international_business: e.target.checked })}
                          className="w-4 h-4 text-indigo-600 border-border rounded focus:ring-indigo-500"
                        />
                        <Label htmlFor="international_business" className="text-sm font-medium text-foreground">
                          International business activities
                        </Label>
                      </div>
                    ) : (
                      renderViewField('International Business Activities', profile.international_business ? 'Yes' : 'No')
                    )}
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-indigo-500" />
                  <h3 className="text-lg font-semibold text-foreground">Business Preferences</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    {editState.advancedSettings ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">Documentation Habits</Label>
                        <SimpleSelectWrapper
                          value={profile.documentation_habits || 'moderate'}
                          onValueChange={(value) => handleProfileChange({ documentation_habits: value })}
                          placeholder="Select documentation habits"
                          options={[
                            { value: 'minimal', label: 'Minimal (basic receipts)' },
                            { value: 'moderate', label: 'Moderate (organized records)' },
                            { value: 'detailed', label: 'Detailed (comprehensive documentation)' }
                          ]}
                        />
                        <p className="text-xs text-muted-foreground">How detailed are your expense records?</p>
                      </>
                    ) : (
                      renderViewField(
                        'Documentation Habits',
                        profile.documentation_habits === 'minimal'
                          ? 'Minimal (basic receipts)'
                          : profile.documentation_habits === 'detailed'
                            ? 'Detailed (comprehensive documentation)'
                            : 'Moderate (organized records)'
                      )
                    )}
                  </div>
                  <div className="space-y-2">
                    {editState.advancedSettings ? (
                      <>
                        <Label className="text-sm font-medium text-foreground">Business Seasonality</Label>
                        <SimpleSelectWrapper
                          value={profile.business_seasonality || 'year_round'}
                          onValueChange={(value) => handleProfileChange({ business_seasonality: value })}
                          placeholder="Select business pattern"
                          options={[
                            { value: 'year_round', label: 'Year-round business' },
                            { value: 'seasonal', label: 'Seasonal business' },
                            { value: 'project_based', label: 'Project-based work' }
                          ]}
                        />
                        <p className="text-xs text-muted-foreground">How does your business operate throughout the year?</p>
                      </>
                    ) : (
                      renderViewField(
                        'Business Seasonality',
                        profile.business_seasonality === 'seasonal'
                          ? 'Seasonal business'
                          : profile.business_seasonality === 'project_based'
                            ? 'Project-based work'
                            : 'Year-round business'
                      )
                    )}
                  </div>
                </div>
              </section>

              <div className="flex justify-end gap-3 pt-6 border-t border-border">
                {editState.advancedSettings ? (
                  <>
                    <Button
                      variant="outline"
                      className="h-11 px-6 rounded-lg"
                      onClick={() => cancelEditing('advancedSettings')}
                      disabled={isSaving}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="h-11 px-6 rounded-lg"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-5 h-5 mr-2" />
                          Save Changes
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" className="h-11 px-6 rounded-lg" onClick={onBack}>
                    Close
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Bank Account Management & Data Rights - Only in Profile Tab */}
        {activeTab === 'profile' && (
          <div className="space-y-6 mt-6">
            {/* Bank Account Management */}
            <Card className="p-6 bg-card border border-border shadow-lg">
              <h3 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-primary" />
                Bank Account Management
              </h3>
              <div className="space-y-4">
                <Button
                  type="button"
                  onClick={() => onNavigate('plaid-link')}
                  className="w-full h-12 bg-primary hover:bg-primary/90 text-white rounded-lg flex items-center justify-center gap-3"
                >
                  <DollarSign className="w-5 h-5" />
                  Connect Bank Account with Plaid
                </Button>
                <Button
                  type="button"
                  onClick={() => onNavigate('plaid')}
                  variant="outline"
                  className="w-full h-12 justify-center gap-3 rounded-lg"
                >
                  <DollarSign className="w-4 h-4" />
                  Manage Connected Accounts
                </Button>
              </div>
            </Card>

            {/* Data Rights & Privacy */}
            <Card className="p-6 bg-card border border-border shadow-lg">
              <h3 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Data Rights & Privacy
              </h3>
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  <p>You have the right to view, export, and delete your data, and to revoke access to your bank data at any time.</p>
                </div>
                <Button
                  onClick={async () => {
                    try {
                      // Check if user can export (rate limiting)
                      const statusRes = await fetch('/api/user/export');
                      const statusData = await statusRes.json();

                      if (!statusData.canExport) {
                        alert(`You can only export your data once per hour. Please wait ${statusData.timeRemaining} minutes.`);
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

                        alert(`Export completed! Downloaded ${exportData.summary.transactions} transactions, ${exportData.summary.accounts} accounts, and ${exportData.summary.receipts} receipts.`);
                      } else {
                        const errorData = await res.json();
                        alert(`Failed to export data: ${errorData.message || 'Unknown error'}`);
                      }
                    } catch (err) {
                      console.error('Export error:', err);
                      alert('Failed to export data. Please try again.');
                    }
                  }}
                  variant="outline"
                  className="w-full h-12 justify-center gap-3 rounded-lg"
                >
                  <FileText className="w-4 h-4" />
                  Export My Data (JSON + CSV)
                </Button>
                <Button
                  onClick={async () => {
                    if (window.confirm('Are you sure you want to delete your account and all associated data? This includes all Plaid connections, accounts, transactions, and receipts. This action cannot be undone.')) {
                      try {
                        const res = await fetch('/api/user/delete', { method: 'DELETE' });
                        const result = await res.json();
                        if (result.success) {
                          alert('Your account and all data have been deleted. You will be logged out.');
                          // Sign out and redirect to home
                          window.location.href = '/';
                        } else {
                          const errorMsg = result.details || result.error || 'Unknown error';
                          alert(`Failed to delete account: ${errorMsg}`);
                        }
                      } catch (err) {
                        console.error('Error deleting account:', err);
                        alert('Failed to delete account. Please try again.');
                      }
                    }
                  }}
                  variant="destructive"
                  className="w-full h-12 justify-center gap-3 rounded-lg"
                >
                  <Shield className="w-4 h-4" />
                  Delete My Account & Data
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="w-full h-12 justify-center gap-3 rounded-lg"
                >
                  <a href="https://my.plaid.com/" target="_blank" rel="noopener noreferrer">
                    <Shield className="w-4 h-4" />
                    Revoke Plaid Access (Plaid Portal)
                  </a>
                </Button>
              </div>
            </Card>

            {/* Quick Actions */}
            <Card className="p-6 bg-card border border-border shadow-lg">
              <h3 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                Quick Actions
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Button
                  onClick={() => onNavigate('dashboard')}
                  variant="outline"
                  className="h-12 justify-start gap-3"
                >
                  <Briefcase className="w-4 h-4" />
                  Back to Dashboard
                </Button>
                <Button
                  onClick={() => onNavigate('transactions')}
                  variant="outline"
                  className="h-12 justify-start gap-3"
                >
                  <FileText className="w-4 h-4" />
                  View Transactions
                </Button>
              </div>
            </Card>
          </div>
        )}

      </div>
    </div>
  </div>
  );
};
