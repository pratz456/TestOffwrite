import React, { useState } from 'react';
import { useBeforeUnload } from '@/lib/hooks/use-before-unload';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/simple-select';
import { User, Briefcase, MapPin, FileText, Mail, ArrowRight, ArrowLeft, ChevronDown, ChevronUp } from '@/lib/icons';
import { upsertUserProfile } from '@/lib/firebase/profiles';
import { PlaidLinkScreen } from './plaid-link-screen';
import { DataSourceScreen } from './data-source-screen';

interface UserProfile {
  email: string;
  name: string;
  yearOfBirth?: string;
  profession: string[];
  customProfession?: string;
  businessEntityType: string;
  primaryWorkLocation: string;
  workRelatedTravelPattern: string;
  income: string;
  state: string;
  filingStatus: string;
  plaidToken?: string;
  businessStartDate?: string;
  homeOfficeSqft?: number;
  totalHomeSqft?: number;
  vehicleBusinessUsePercentage?: number;
  businessPurpose?: string;
  ein?: string;
  w2Income?: number;
  businessIncome?: number;
}

interface ProfileSetupScreenProps {
  user: any;
  onBack: () => void;
  onComplete: (profile: UserProfile, redirectTo?: string) => void;
}

const professions = [
  'Software Developer', 'Freelance Writer', 'Graphic Designer', 'Consultant', 'Marketing Specialist',
  'Real Estate Agent', 'Photographer', 'Web Designer', 'Content Creator', 'Business Coach',
  'Virtual Assistant', 'Social Media Manager', 'Online Tutor', 'E-commerce Store Owner', 'Other'
];

const incomeRanges = [
  'Under $11,600', '$11,600 - $47,150', '$47,150 - $100,525', '$100,525 - $191,950',
  '$191,950 - $243,725', '$243,725 - $609,350', 'Over $609,350'
];

const usStates = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
  'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'
];

const filingStatuses = [
  'Single', 'Married Filing Jointly', 'Married Filing Separately', 'Head of Household', 'Qualifying Widower'
];

const businessEntityTypeOptions: { value: string; label: string }[] = [
  { value: 'Sole Proprietor / Independent Contractor', label: 'Sole proprietor or freelancer' },
  { value: 'Single-Member LLC (disregarded entity)', label: 'Single-owner LLC' },
  { value: 'Multi-Member LLC', label: 'LLC with multiple owners' },
  { value: 'S-Corporation', label: 'S-Corp' },
  { value: 'C-Corporation', label: 'C-Corp' },
  { value: 'Partnership', label: 'Partnership' },
  { value: 'This does not apply to me', label: 'Not applicable' }
];

const primaryWorkLocations = [
  'Home Office',
  'Rented Office / Coworking Space',
  'Client Sites (Traveling)',
  'Retail / Commercial Storefront',
  'Warehouse / Studio / Workshop',
  'Multiple Locations',
  'This does not apply to me'
];

const workRelatedTravelPatterns = [
  'Local Travel',
  'National Travel',
  'International Travel',
  'This does not apply to me'
];

export const ProfileSetupScreen: React.FC<ProfileSetupScreenProps> = ({ user, onBack, onComplete }) => {
  useBeforeUnload(true);
  const [currentStep, setCurrentStep] = useState<'profile' | 'data-source' | 'plaid'>('profile');
  const [currentSlide, setCurrentSlide] = useState<'about' | 'business'>('about');
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [skipBusiness, setSkipBusiness] = useState(false);
  const [formData, setFormData] = useState<UserProfile>({
    email: user?.email || '',
    name: user?.user_metadata?.name || '',
    yearOfBirth: '',
    profession: [],
    customProfession: '',
    businessEntityType: '',
    primaryWorkLocation: '',
    workRelatedTravelPattern: '',
    income: '',
    state: '',
    filingStatus: '',
    plaidToken: '',
    businessStartDate: '',
    businessPurpose: '',
    ein: '',
    homeOfficeSqft: undefined,
    totalHomeSqft: undefined,
    vehicleBusinessUsePercentage: undefined,
    w2Income: undefined,
    businessIncome: undefined,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 validation: core fields that power AI analysis + tax filing
  const isAboutYouValid = formData.email && formData.name && formData.state && formData.filingStatus &&
    formData.profession.length > 0 && formData.businessEntityType && formData.primaryWorkLocation && formData.income &&
    (!formData.profession.includes('Other') || (formData.profession.includes('Other') && formData.customProfession?.trim()));

  const aboutYouMissing: string[] = [];
  if (currentSlide === 'about') {
    if (!formData.name) aboutYouMissing.push('full name');
    if (!formData.state) aboutYouMissing.push('state');
    if (!formData.filingStatus) aboutYouMissing.push('filing status');
    if (formData.profession.length === 0) aboutYouMissing.push('at least one profession');
    if (!formData.businessEntityType) aboutYouMissing.push('business entity type');
    if (!formData.primaryWorkLocation) aboutYouMissing.push('work location');
    if (!formData.income) aboutYouMissing.push('income range');
    if (formData.profession.includes('Other') && !formData.customProfession?.trim()) aboutYouMissing.push('your profession');
  }

  // Step 2 is always valid (all fields optional, or skipped entirely)
  const isBusinessValid = true;

  const isFormValid = isAboutYouValid && isBusinessValid;

  const handleProfessionChange = (profession: string, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      profession: checked
        ? [...prev.profession, profession]
        : prev.profession.filter(p => p !== profession),
      customProfession: profession === 'Other' && !checked ? '' : prev.customProfession
    }));
  };

  const handleSubmit = async () => {
    if (!isFormValid) return;
    setIsSubmitting(true);
    setError(null);

    try {
      let professionString = formData.profession.join(', ');
      if (formData.profession.includes('Other') && formData.customProfession?.trim()) {
        professionString = formData.profession
          .filter(p => p !== 'Other')
          .concat(formData.customProfession.trim())
          .join(', ');
      }

      const { data, error: profileError } = await upsertUserProfile(user.id, {
        email: formData.email,
        name: formData.name,
        year_of_birth: formData.yearOfBirth || undefined,
        profession: professionString,
        business_entity_type: formData.businessEntityType,
        primary_work_location: formData.primaryWorkLocation,
        work_related_travel_pattern: formData.workRelatedTravelPattern || undefined,
        income: formData.income,
        state: formData.state,
        filing_status: formData.filingStatus,
        plaid_token: formData.plaidToken,
        business_start_date: formData.businessStartDate || undefined,
        home_office_sqft: formData.homeOfficeSqft,
        total_home_sqft: formData.totalHomeSqft,
        vehicle_business_use_percentage: formData.vehicleBusinessUsePercentage,
        business_purpose: formData.businessPurpose || undefined,
        ein: formData.ein || undefined,
        w2_income: formData.w2Income,
        business_income: formData.businessIncome,
      });

      if (profileError) {
        console.error('Profile save error details:', profileError);
        let errorMessage = 'Failed to save profile';
        if (typeof profileError === 'string') {
          errorMessage = profileError;
        } else if (profileError?.message) {
          errorMessage = profileError.message;
        } else if (profileError?.code) {
          errorMessage = `Error: ${profileError.code}`;
        }
        throw new Error(errorMessage);
      }

      console.log('Profile saved successfully:', data);
      setCurrentStep('data-source');
    } catch (error) {
      console.error('Error saving profile:', error);
      setError(error instanceof Error ? error.message : 'Failed to save profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePlaidSuccess = () => {
    onComplete(formData, '/protected?screen=dashboard');
  };

  const handlePlaidBack = () => {
    setCurrentStep('data-source');
  };

  if (currentStep === 'data-source') {
    return (
      <DataSourceScreen
        user={user}
        onConnectBank={() => setCurrentStep('plaid')}
        onSkipToApp={() => onComplete(formData, '/protected')}
        onBack={() => setCurrentStep('profile')}
      />
    );
  }

  if (currentStep === 'plaid') {
    return (
      <PlaidLinkScreen
        user={user}
        onSuccess={handlePlaidSuccess}
        onBack={() => setCurrentStep('data-source')}
      />
    );
  }

  const slides = ['about', 'business'] as const;
  const slideLabels = { about: 'About You', business: 'Your Business' };
  const slideIndex = slides.indexOf(currentSlide);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="bg-background/80 backdrop-blur-sm border-b border-border z-50 shadow-sm flex-shrink-0">
        <div className="flex items-center justify-between px-4 py-3 max-w-3xl mx-auto">
          <button
            onClick={currentSlide === 'about' ? onBack : () => setCurrentSlide('about')}
            className="w-9 h-9 bg-card border border-border rounded-xl flex items-center justify-center text-foreground hover:bg-muted transition-all duration-200 shadow-sm"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-blue-700 rounded-lg flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-sm">W</span>
            </div>
            <span className="font-bold text-foreground">WriteOff</span>
          </div>
          <div className="w-9 h-9"></div>
        </div>
      </div>

      {/* Title + Progress */}
      <div className="flex-shrink-0 pt-3 pb-2 px-4 max-w-3xl mx-auto w-full">
        <h1 className="text-xl font-bold text-foreground text-center mb-1">Complete Your Profile</h1>
        <p className="text-muted-foreground text-sm text-center mb-3">Helps us personalize your deduction analysis</p>

        <div className="flex items-center justify-center gap-3">
          {slides.map((slide, index) => (
            <React.Fragment key={slide}>
              <div className="flex items-center gap-1.5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 ${
                  slideIndex >= index ? 'bg-primary shadow-md shadow-primary/20' : 'bg-muted'
                }`}>
                  <span className={`font-semibold text-xs ${
                    slideIndex >= index ? 'text-primary-foreground' : 'text-muted-foreground'
                  }`}>{index + 1}</span>
                </div>
                <span className={`text-xs font-medium transition-colors duration-300 ${
                  currentSlide === slide ? 'text-foreground' : 'text-muted-foreground'
                }`}>{slideLabels[slide]}</span>
              </div>
              {index < slides.length - 1 && <div className="w-8 h-0.5 bg-muted"></div>}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Scrollable card area */}
      <div className="flex-1 overflow-y-auto px-4 pb-2">
        <div className="max-w-3xl mx-auto">
          <div className="relative overflow-hidden">
            <div className={`flex transition-transform duration-500 ease-in-out ${
              currentSlide === 'about' ? 'translate-x-0' : '-translate-x-full'
            }`}>

              {/* ===== STEP 1: About You ===== */}
              <div className="w-full flex-shrink-0">
                <Card className="p-4 bg-card/70 backdrop-blur-sm border border-border shadow-xl">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                      <User className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-card-foreground">About You</h2>
                      <p className="text-xs text-muted-foreground">Personal details, profession & income</p>
                    </div>
                  </div>

                  {/* Row 1: Email + Name */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Email <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <Input
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                          className="h-9 text-sm rounded-xl border-2 border-border bg-background pr-10 shadow-sm"
                          disabled
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                            <span className="text-white text-[10px] font-bold">✓</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Full Name <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Enter your full name"
                        className="h-9 text-sm rounded-xl border-2 border-border focus:border-blue-500 bg-background shadow-sm"
                      />
                    </div>
                  </div>

                  {/* Row 2: State + Filing Status */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        State <span className="text-red-500">*</span>
                      </label>
                      <Select value={formData.state} onValueChange={(value: string) => setFormData(prev => ({ ...prev, state: value }))}>
                        <SelectTrigger className="h-9 text-sm rounded-xl border-2 border-border focus:border-blue-500 bg-background shadow-sm">
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                        <SelectContent>
                          {usStates.map((state) => (
                            <SelectItem key={state} value={state}>{state}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Filing Status <span className="text-red-500">*</span>
                      </label>
                      <Select value={formData.filingStatus} onValueChange={(value: string) => setFormData(prev => ({ ...prev, filingStatus: value }))}>
                        <SelectTrigger className="h-9 text-sm rounded-xl border-2 border-border focus:border-blue-500 bg-background shadow-sm">
                          <SelectValue placeholder="Select filing status" />
                        </SelectTrigger>
                        <SelectContent>
                          {filingStatuses.map((status) => (
                            <SelectItem key={status} value={status}>{status}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Professions */}
                  <div className="mb-3">
                    <label className="block text-xs font-semibold text-foreground mb-1">
                      Profession(s) <span className="text-red-500">*</span>
                      <span className="font-normal text-muted-foreground ml-1">select all that apply</span>
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-32 overflow-y-auto border-2 border-border rounded-xl p-2 bg-muted/30 shadow-sm">
                      {professions.map((profession) => (
                        <label key={profession} className="flex items-center space-x-1.5 cursor-pointer hover:bg-muted px-2 py-1.5 rounded-lg transition-colors">
                          <Checkbox
                            checked={formData.profession.includes(profession)}
                            onCheckedChange={(checked) => handleProfessionChange(profession, checked as boolean)}
                            className="text-blue-600"
                          />
                          <span className="text-xs text-foreground">{profession}</span>
                        </label>
                      ))}
                    </div>
                    {formData.profession.length > 0 && (
                      <p className="text-xs text-blue-600 font-medium mt-1">Selected: {formData.profession.join(', ')}</p>
                    )}
                    {formData.profession.includes('Other') && (
                      <Input
                        type="text"
                        value={formData.customProfession || ''}
                        onChange={(e) => setFormData(prev => ({ ...prev, customProfession: e.target.value }))}
                        placeholder="Enter your profession"
                        className="h-9 text-sm rounded-xl border-2 border-border focus:border-blue-500 bg-background shadow-sm mt-2"
                      />
                    )}
                  </div>

                  {/* Row 3: Entity + Work Location + Income */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Business Entity <span className="text-red-500">*</span>
                      </label>
                      <Select value={formData.businessEntityType} onValueChange={(value: string) => setFormData(prev => ({ ...prev, businessEntityType: value }))}>
                        <SelectTrigger className="h-9 text-sm rounded-xl border-2 border-border focus:border-blue-500 bg-background shadow-sm">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          {businessEntityTypeOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Work Location <span className="text-red-500">*</span>
                      </label>
                      <Select value={formData.primaryWorkLocation} onValueChange={(value: string) => setFormData(prev => ({ ...prev, primaryWorkLocation: value }))}>
                        <SelectTrigger className="h-9 text-sm rounded-xl border-2 border-border focus:border-blue-500 bg-background shadow-sm">
                          <SelectValue placeholder="Where you work" />
                        </SelectTrigger>
                        <SelectContent>
                          {primaryWorkLocations.map((location) => (
                            <SelectItem key={location} value={location}>{location}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1">
                        Income Range <span className="text-red-500">*</span>
                      </label>
                      <Select value={formData.income} onValueChange={(value: string) => setFormData(prev => ({ ...prev, income: value }))}>
                        <SelectTrigger className="h-9 text-sm rounded-xl border-2 border-border focus:border-blue-500 bg-background shadow-sm">
                          <SelectValue placeholder="Annual income" />
                        </SelectTrigger>
                        <SelectContent>
                          {incomeRanges.map((range) => (
                            <SelectItem key={range} value={range}>{range}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Expandable: More Details */}
                  <button
                    type="button"
                    onClick={() => setShowMoreDetails(!showMoreDetails)}
                    className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors mb-2"
                  >
                    {showMoreDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {showMoreDetails ? 'Hide' : 'Add more details'} (optional)
                  </button>

                  {showMoreDetails && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border">
                      <div>
                        <label className="block text-xs font-semibold text-foreground mb-1">Year of Birth</label>
                        <Input
                          type="number"
                          min="1920"
                          max={new Date().getFullYear() - 16}
                          value={formData.yearOfBirth || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, yearOfBirth: e.target.value }))}
                          placeholder="e.g., 1990"
                          className="h-9 text-sm rounded-xl border-2 border-border focus:border-blue-500 bg-background shadow-sm"
                        />
                        <p className="text-[10px] text-muted-foreground mt-0.5">Age-specific tax advice (retirement limits, etc.)</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-foreground mb-1">Travel Pattern</label>
                        <Select value={formData.workRelatedTravelPattern} onValueChange={(value: string) => setFormData(prev => ({ ...prev, workRelatedTravelPattern: value }))}>
                          <SelectTrigger className="h-9 text-sm rounded-xl border-2 border-border focus:border-blue-500 bg-background shadow-sm">
                            <SelectValue placeholder="Work travel frequency" />
                          </SelectTrigger>
                          <SelectContent>
                            {workRelatedTravelPatterns.map((pattern) => (
                              <SelectItem key={pattern} value={pattern}>{pattern}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-foreground mb-1">W-2 / Salary Income</label>
                        <Input
                          type="number"
                          min="0"
                          value={formData.w2Income || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, w2Income: parseInt(e.target.value) || undefined }))}
                          placeholder="e.g., 65000"
                          className="h-9 text-sm rounded-xl border-2 border-border focus:border-blue-500 bg-background shadow-sm"
                        />
                        <p className="text-[10px] text-muted-foreground mt-0.5">From traditional employment, if any</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-foreground mb-1">Self-Employment Income</label>
                        <Input
                          type="number"
                          min="0"
                          value={formData.businessIncome || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, businessIncome: parseInt(e.target.value) || undefined }))}
                          placeholder="e.g., 40000"
                          className="h-9 text-sm rounded-xl border-2 border-border focus:border-blue-500 bg-background shadow-sm"
                        />
                        <p className="text-[10px] text-muted-foreground mt-0.5">Freelance, 1099, or business revenue</p>
                      </div>
                    </div>
                  )}
                </Card>
              </div>

              {/* ===== STEP 2: Your Business ===== */}
              <div className="w-full flex-shrink-0">
                <Card className="p-4 bg-card/70 backdrop-blur-sm border border-border shadow-xl mx-1">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-9 h-9 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center shadow-lg">
                      <Briefcase className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-card-foreground">Your Business</h2>
                      <p className="text-xs text-muted-foreground">Business details & deduction info</p>
                    </div>
                  </div>

                  {/* Skip option */}
                  <div className="flex items-center space-x-2 mb-4 p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <input
                      type="checkbox"
                      id="skipBusiness"
                      checked={skipBusiness}
                      onChange={(e) => setSkipBusiness(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-border rounded focus:ring-blue-500"
                    />
                    <label htmlFor="skipBusiness" className="text-xs font-medium text-blue-600">
                      Skip -- I'll fill this in later (you can update anytime in Settings)
                    </label>
                  </div>

                  {!skipBusiness && (
                    <div className="space-y-3">
                      {/* Business Purpose + Start Date */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-foreground mb-1">Business Purpose</label>
                          <Input
                            type="text"
                            value={formData.businessPurpose || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, businessPurpose: e.target.value }))}
                            placeholder="e.g., Freelance web design"
                            className="h-9 text-sm rounded-xl border-2 border-border focus:border-orange-500 bg-background shadow-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-foreground mb-1">Business Start Date</label>
                          <Input
                            type="date"
                            value={formData.businessStartDate || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, businessStartDate: e.target.value }))}
                            className="h-9 text-sm rounded-xl border-2 border-border focus:border-orange-500 bg-background shadow-sm"
                          />
                        </div>
                      </div>

                      {/* EIN */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-semibold text-foreground mb-1">EIN (optional)</label>
                          <Input
                            type="text"
                            value={formData.ein || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, ein: e.target.value }))}
                            placeholder="XX-XXXXXXX"
                            className="h-9 text-sm rounded-xl border-2 border-border focus:border-orange-500 bg-background shadow-sm"
                          />
                        </div>
                      </div>

                      {/* Home Office */}
                      <div className="pt-2 border-t border-border">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Home Office</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-foreground mb-1">Office Sq Ft</label>
                            <Input
                              type="number"
                              value={formData.homeOfficeSqft || ''}
                              onChange={(e) => setFormData(prev => ({ ...prev, homeOfficeSqft: parseInt(e.target.value) || undefined }))}
                              placeholder="e.g., 150"
                              className="h-9 text-sm rounded-xl border-2 border-border focus:border-orange-500 bg-background shadow-sm"
                            />
                            <p className="text-[10px] text-muted-foreground mt-0.5">Dedicated workspace only</p>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-foreground mb-1">Total Home Sq Ft</label>
                            <Input
                              type="number"
                              value={formData.totalHomeSqft || ''}
                              onChange={(e) => setFormData(prev => ({ ...prev, totalHomeSqft: parseInt(e.target.value) || undefined }))}
                              placeholder="e.g., 1200"
                              className="h-9 text-sm rounded-xl border-2 border-border focus:border-orange-500 bg-background shadow-sm"
                            />
                            <p className="text-[10px] text-muted-foreground mt-0.5">Calculates deduction %</p>
                          </div>
                        </div>
                      </div>

                      {/* Vehicle */}
                      <div className="pt-2 border-t border-border">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Vehicle</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-semibold text-foreground mb-1">Business Use %</label>
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              value={formData.vehicleBusinessUsePercentage || ''}
                              onChange={(e) => setFormData(prev => ({ ...prev, vehicleBusinessUsePercentage: parseInt(e.target.value) || undefined }))}
                              placeholder="e.g., 75"
                              className="h-9 text-sm rounded-xl border-2 border-border focus:border-orange-500 bg-background shadow-sm"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Sticky bottom nav bar */}
      <div className="flex-shrink-0 border-t border-border bg-background/90 backdrop-blur-sm px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Button
            onClick={currentSlide === 'about' ? onBack : () => setCurrentSlide('about')}
            variant="outline"
            className="h-9 px-4 rounded-xl border-2 border-border hover:bg-muted bg-background shadow-sm"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            {currentSlide === 'about' ? 'Back' : 'Previous'}
          </Button>

          {aboutYouMissing.length > 0 && currentSlide === 'about' && (
            <p className="text-[10px] text-muted-foreground max-w-[200px] text-center hidden md:block">
              Complete: {aboutYouMissing.slice(0, 3).join(', ')}{aboutYouMissing.length > 3 ? '...' : ''}
            </p>
          )}

          {currentSlide === 'about' ? (
            <Button
              onClick={() => setCurrentSlide('business')}
              disabled={!isAboutYouValid}
              className="h-9 px-5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={!isFormValid || isSubmitting}
              className="h-9 px-5 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-medium shadow-md shadow-green-500/20 disabled:opacity-50 transition-all duration-200"
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5"></div>
                  Saving...
                </>
              ) : (
                <>
                  Connect Bank
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </>
              )}
            </Button>
          )}
        </div>
        {error && (
          <div className="max-w-3xl mx-auto mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-red-600 text-xs font-medium">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};
