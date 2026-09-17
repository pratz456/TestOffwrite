'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useBeforeUnload } from '@/lib/hooks/use-before-unload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowRight, ArrowLeft, ChevronDown, ChevronUp } from '@/lib/icons';
import { upsertUserProfile } from '@/lib/firebase/profiles';
import type { AuthUser } from '@/lib/firebase/auth';
import { PlaidLinkScreen } from './plaid-link-screen';
import { DataSourceScreen } from './data-source-screen';
import { reloadProfileEmail } from '@/lib/onboarding/profile-identity';

import { missingProfileFields, profileDetailsError, profileWriteData, PROFILE_COMPLETE_SCREEN, type ProfileSetupData as UserProfile } from '@/lib/onboarding/profile';

interface ProfileSetupScreenProps {
  user: AuthUser;
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
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia',
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
  const [currentStep, setCurrentStep] = useState<'profile' | 'data-source' | 'plaid'>('profile');
  const [currentSlide, setCurrentSlide] = useState<'about' | 'work' | 'business'>('about');
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollAreaRef.current?.scrollTo({ top: 0 }); }, [currentSlide]);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [skipBusiness, setSkipBusiness] = useState(false);
  const [identity, setIdentity] = useState<{ userId: string; loading: boolean; email?: string; error?: string } | null>(null);
  const [identityAttempt, setIdentityAttempt] = useState(0);
  useEffect(() => {
    if (user.email?.trim()) { setIdentity(null); return; }
    let cancelled = false;
    setIdentity({ userId: user.id, loading: true });
    void reloadProfileEmail(user.id).then(
      email => { if (!cancelled) setIdentity({ userId: user.id, loading: false, email }); },
      failure => { if (!cancelled) setIdentity({ userId: user.id, loading: false, error: failure instanceof Error ? failure.message : 'We could not load your account email. Please try again.' }); },
    );
    return () => { cancelled = true; };
  }, [user.id, user.email, identityAttempt]);
  const currentIdentity = identity?.userId === user.id ? identity : null;
  const [profileDetails, setFormData] = useState<UserProfile>({
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
  // This read-only field belongs to the authenticated identity. Keep it current
  // when provider data hydrates without resetting any answers the user has typed.
  const formData: UserProfile = { ...profileDetails, email: user.email?.trim() ? user.email : currentIdentity?.email || '' };
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  // Loading a read-only account email is not an unsaved edit to the user's answers.
  const snapshot = JSON.stringify({ formData: profileDetails, skipBusiness });
  const initialSnapshot = useRef(snapshot);
  useBeforeUnload(currentStep === 'profile' && savedSnapshot !== snapshot && initialSnapshot.current !== snapshot);
  const [error, setError] = useState<string | null>(null);

  const aboutYouMissing = missingProfileFields(formData);
  const isAboutYouValid = aboutYouMissing.length === 0;
  const detailsError = profileDetailsError(formData, skipBusiness);
  const isFormValid = isAboutYouValid && !detailsError;

  const handleProfessionChange = (profession: string, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      profession: checked
        ? Array.from(new Set([...prev.profession, profession]))
        : prev.profession.filter(p => p !== profession),
      customProfession: profession === 'Other' && !checked ? '' : prev.customProfession
    }));
  };

  const handleSubmit = async () => {
    if (!isFormValid || submittingRef.current) return;
    if (!user?.id) {
      setError('Your session has expired. Sign in again to save your profile.');
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      const { error: profileError } = await upsertUserProfile(user.id, profileWriteData(formData, skipBusiness));
      if (profileError) throw profileError;
      setSavedSnapshot(snapshot);
      setCurrentStep('data-source');
    } catch {
      setError('We could not save your profile. Your answers are still here. Check your connection and try again.');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handlePlaidSuccess = () => {
    onComplete(formData, PROFILE_COMPLETE_SCREEN);
  };

  if (currentStep === 'data-source') {
    return (
      <DataSourceScreen
        user={user}
        onConnectBank={() => setCurrentStep('plaid')}
        onSkipToApp={() => onComplete(formData, PROFILE_COMPLETE_SCREEN)}
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

  const slides = ['about', 'work', 'business'] as const;
  const slideLabels = { about: 'About you', work: 'Your work', business: 'Details' };
  const slideIndex = slides.indexOf(currentSlide);
  const personalMissing = aboutYouMissing.filter(label => ['email address', 'full name', 'state', 'filing status'].includes(label));
  const currentMissing = currentSlide === 'about' ? personalMissing : currentSlide === 'work' ? aboutYouMissing : [];
  const canContinue = currentSlide === 'about' ? personalMissing.length === 0 : isAboutYouValid;
  const previousStep = () => currentSlide === 'about' ? onBack() : setCurrentSlide(slides[slideIndex - 1]);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border bg-background">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-2">
          <button type="button" disabled={isSubmitting} aria-label={currentSlide === 'about' ? 'Back' : 'Previous step'} onClick={previousStep} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-muted">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-base font-semibold">Set up WriteOff</h1>
          <span className="text-xs text-muted-foreground">{slideIndex + 1} of 3</span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-xl shrink-0 px-4 pb-3 pt-4">
        <ol className="flex gap-3 text-xs" aria-label="Profile setup progress">
          {slides.map((slide, index) => <li key={slide} aria-current={currentSlide === slide ? 'step' : undefined} className={`flex-1 border-t-2 pt-2 ${slideIndex >= index ? 'border-primary text-foreground' : 'border-border text-muted-foreground'}`}>{slideLabels[slide]}</li>)}
        </ol>
        <h2 className="mt-4 text-xl font-semibold">{currentSlide === 'business' ? 'Anything else to add?' : slideLabels[currentSlide]}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{currentSlide === 'about' ? 'Start with your personal and tax details.' : currentSlide === 'work' ? 'Help us understand your business expenses.' : 'Optional. You can update these in Settings later.'}</p>
      </div>

      <div ref={scrollAreaRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <fieldset disabled={isSubmitting} className="mx-auto min-w-0 max-w-xl">
          <legend className="sr-only">{slideLabels[currentSlide]}</legend>
          {currentSlide === 'about' && <div>
                  {/* Row 1: Email + Name */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label htmlFor="profile-email" className="block text-xs font-semibold text-foreground mb-1">
                        Email <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <Input id="profile-email"
                          type="email"
                          value={formData.email}
                          className="min-h-11 text-base rounded-xl border border-border bg-background pr-10 shadow-sm"
                          disabled
                        />
                        {formData.email && <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                            <span className="text-white text-xs font-bold">✓</span>
                          </div>
                        </div>}
                      </div>
                      {!formData.email && <div className="mt-2 space-y-1">
                        {currentIdentity?.error ? <>
                          <p role="alert" className="text-xs text-destructive">{currentIdentity.error}</p>
                          <Button type="button" size="sm" variant="outline" onClick={() => setIdentityAttempt(value => value + 1)}>Refresh account email</Button>
                        </> : <p role="status" className="text-xs text-muted-foreground">Loading your account email…</p>}
                      </div>}
                    </div>
                    <div>
                      <label htmlFor="profile-name" className="block text-xs font-semibold text-foreground mb-1">
                        Full Name <span className="text-red-500">*</span>
                      </label>
                      <Input id="profile-name"
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Enter your full name"
                        className="min-h-11 text-base rounded-xl border border-border focus:border-blue-500 bg-background shadow-sm"
                      />
                    </div>
                  </div>

                  {/* Row 2: State + Filing Status */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label htmlFor="profile-state" className="block text-xs font-semibold text-foreground mb-1">
                        State <span className="text-red-500">*</span>
                      </label>
                      <select id="profile-state" value={formData.state} onChange={event => { const value = event.target.value; setFormData(prev => ({ ...prev, state: value })); }} className="h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <option value="" disabled>Select state</option>
                          {usStates.map((state) => (
                            <option key={state} value={state}>{state}</option>
                          ))}

                      </select>
                    </div>
                    <div>
                      <label htmlFor="profile-filingStatus" className="block text-xs font-semibold text-foreground mb-1">
                        Filing Status <span className="text-red-500">*</span>
                      </label>
                      <select id="profile-filingStatus" value={formData.filingStatus} onChange={event => { const value = event.target.value; setFormData(prev => ({ ...prev, filingStatus: value })); }} className="h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <option value="" disabled>Select filing status</option>
                          {filingStatuses.map((status) => (
                            <option key={status} value={status}>{status}</option>
                          ))}

                      </select>
                    </div>
                  </div>


          </div>}
          {currentSlide === 'work' && <div>
                  {/* Professions */}
                  <div className="mb-3">
                    <label htmlFor="profile-profession" className="block text-xs font-semibold text-foreground mb-1">
                      Profession(s) <span className="text-red-500">*</span>
                      <span className="font-normal text-muted-foreground ml-1">add all that apply</span>
                    </label>
                    <select id="profile-profession" value="" onChange={event => { if (event.target.value) handleProfessionChange(event.target.value, true); }} disabled={formData.profession.length === professions.length} className="h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <option value="" disabled>{formData.profession.length ? 'Add another profession' : 'Choose your profession'}</option>
                      {professions.filter(profession => !formData.profession.includes(profession)).map(profession => (
                        <option key={profession} value={profession}>{profession}</option>
                      ))}
                    </select>
                    {formData.profession.length > 0 && <div className="mt-2 flex flex-wrap gap-2" aria-label="Selected professions">
                      {formData.profession.map(profession => <button key={profession} type="button" aria-label={`Remove ${profession}`} onClick={() => handleProfessionChange(profession, false)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-sm">
                        {profession}<span aria-hidden="true">×</span>
                      </button>)}
                    </div>}
                    {formData.profession.includes('Other') && (
                      <Input
                        type="text"
                        aria-label="Your profession"
                        value={formData.customProfession || ''}
                        onChange={(e) => setFormData(prev => ({ ...prev, customProfession: e.target.value }))}
                        placeholder="Enter your profession"
                        className="min-h-11 text-base rounded-xl border border-border focus:border-blue-500 bg-background shadow-sm mt-2"
                      />
                    )}
                  </div>

                  {/* Row 3: Entity + Work Location + Income */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div>
                      <label htmlFor="profile-businessEntityType" className="block text-xs font-semibold text-foreground mb-1">
                        Business Entity <span className="text-red-500">*</span>
                      </label>
                      <select id="profile-businessEntityType" value={formData.businessEntityType} onChange={event => { const value = event.target.value; setFormData(prev => ({ ...prev, businessEntityType: value })); }} className="h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <option value="" disabled>Select type</option>
                          {businessEntityTypeOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}

                      </select>
                    </div>
                    <div>
                      <label htmlFor="profile-primaryWorkLocation" className="block text-xs font-semibold text-foreground mb-1">
                        Work Location <span className="text-red-500">*</span>
                      </label>
                      <select id="profile-primaryWorkLocation" value={formData.primaryWorkLocation} onChange={event => { const value = event.target.value; setFormData(prev => ({ ...prev, primaryWorkLocation: value })); }} className="h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <option value="" disabled>Where you work</option>
                          {primaryWorkLocations.map((location) => (
                            <option key={location} value={location}>{location}</option>
                          ))}

                      </select>
                    </div>
                    <div>
                      <label htmlFor="profile-income" className="block text-xs font-semibold text-foreground mb-1">
                        Income Range <span className="text-red-500">*</span>
                      </label>
                      <select id="profile-income" value={formData.income} onChange={event => { const value = event.target.value; setFormData(prev => ({ ...prev, income: value })); }} className="h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <option value="" disabled>Annual income</option>
                          {incomeRanges.map((range) => (
                            <option key={range} value={range}>{range}</option>
                          ))}

                      </select>
                    </div>
                  </div>


          </div>}
          {currentSlide === 'business' && <div>
                  {/* Expandable: More Details */}
                  <button
                    type="button"
                    aria-expanded={showMoreDetails}
                    onClick={() => setShowMoreDetails(!showMoreDetails)}
                    className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors mb-2"
                  >
                    {showMoreDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {showMoreDetails ? 'Hide income & personal details' : 'Add income & personal details'}
                  </button>

                  {showMoreDetails && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border">
                      <div>
                        <label htmlFor="profile-yearOfBirth" className="block text-xs font-semibold text-foreground mb-1">Year of Birth</label>
                        <Input id="profile-yearOfBirth"
                          type="number"
                          step="1"
                          min="1900"
                          max={new Date().getFullYear()}
                          value={formData.yearOfBirth || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, yearOfBirth: e.target.value }))}
                          placeholder="e.g., 1990"
                          className="min-h-11 text-base rounded-xl border border-border focus:border-blue-500 bg-background shadow-sm"
                        />
                        <p className="text-xs text-muted-foreground mt-0.5">Age-specific tax advice (retirement limits, etc.)</p>
                      </div>
                      <div>
                        <label htmlFor="profile-workRelatedTravelPattern" className="block text-xs font-semibold text-foreground mb-1">Travel Pattern</label>
                        <select id="profile-workRelatedTravelPattern" value={formData.workRelatedTravelPattern} onChange={event => { const value = event.target.value; setFormData(prev => ({ ...prev, workRelatedTravelPattern: value })); }} className="h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <option value="">Work travel frequency</option>
                            {workRelatedTravelPatterns.map((pattern) => (
                              <option key={pattern} value={pattern}>{pattern}</option>
                            ))}

                      </select>
                      </div>
                      <div>
                        <label htmlFor="profile-w2Income" className="block text-xs font-semibold text-foreground mb-1">W-2 / Salary Income</label>
                        <Input id="profile-w2Income"
                          type="number"
                          step="any"
                          min="0"
                          value={formData.w2Income ?? ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, w2Income: e.target.value === '' ? undefined : Number(e.target.value) }))}
                          placeholder="e.g., 65000"
                          className="min-h-11 text-base rounded-xl border border-border focus:border-blue-500 bg-background shadow-sm"
                        />
                        <p className="text-xs text-muted-foreground mt-0.5">From traditional employment, if any</p>
                      </div>
                      <div>
                        <label htmlFor="profile-businessIncome" className="block text-xs font-semibold text-foreground mb-1">Self-Employment Income</label>
                        <Input id="profile-businessIncome"
                          type="number"
                          step="any"
                          min="0"
                          value={formData.businessIncome ?? ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, businessIncome: e.target.value === '' ? undefined : Number(e.target.value) }))}
                          placeholder="e.g., 40000"
                          className="min-h-11 text-base rounded-xl border border-border focus:border-blue-500 bg-background shadow-sm"
                        />
                        <p className="text-xs text-muted-foreground mt-0.5">Freelance, 1099, or business revenue</p>
                      </div>
                    </div>
                  )}
            <div className="mt-2 border-t border-border pt-3">
                  {/* Skip option */}
                  <div className="flex min-h-11 items-center space-x-2 mb-3 p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <input
                      type="checkbox"
                      id="skipBusiness"
                      checked={skipBusiness}
                      onChange={(e) => setSkipBusiness(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-border rounded focus:ring-blue-500"
                    />
                    <label htmlFor="skipBusiness" className="flex min-h-11 flex-1 items-center text-sm font-medium text-blue-600">
                      Skip business details for now
                    </label>
                  </div>

                  {!skipBusiness && (
                    <details className="group">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">Business, home office & vehicle <span aria-hidden="true" className="text-muted-foreground group-open:rotate-45">+</span></summary>
                    <div className="space-y-3 pt-3">
                      {/* Business Purpose + Start Date */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="profile-businessPurpose" className="block text-xs font-semibold text-foreground mb-1">Business Purpose</label>
                          <Input id="profile-businessPurpose"
                            type="text"
                            value={formData.businessPurpose || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, businessPurpose: e.target.value }))}
                            placeholder="e.g., Freelance web design"
                            className="min-h-11 text-base rounded-xl border border-border focus:border-orange-500 bg-background shadow-sm"
                          />
                        </div>
                        <div>
                          <label htmlFor="profile-businessStartDate" className="block text-xs font-semibold text-foreground mb-1">Business Start Date</label>
                          <Input id="profile-businessStartDate"
                            type="date"
                            value={formData.businessStartDate || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, businessStartDate: e.target.value }))}
                            className="min-h-11 text-base rounded-xl border border-border focus:border-orange-500 bg-background shadow-sm"
                          />
                        </div>
                      </div>

                      {/* EIN */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="profile-ein" className="block text-xs font-semibold text-foreground mb-1">EIN (optional)</label>
                          <Input id="profile-ein"
                            type="text"
                            value={formData.ein || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, ein: e.target.value }))}
                            placeholder="XX-XXXXXXX"
                            className="min-h-11 text-base rounded-xl border border-border focus:border-orange-500 bg-background shadow-sm"
                          />
                        </div>
                      </div>

                      {/* Home Office */}
                      <div className="pt-2 border-t border-border">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Home Office</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label htmlFor="profile-homeOfficeSqft" className="block text-xs font-semibold text-foreground mb-1">Office Sq Ft</label>
                            <Input id="profile-homeOfficeSqft"
                              type="number"
                              step="any"
                              value={formData.homeOfficeSqft ?? ''}
                              onChange={(e) => setFormData(prev => ({ ...prev, homeOfficeSqft: e.target.value === '' ? undefined : Number(e.target.value) }))}
                              placeholder="e.g., 150"
                              className="min-h-11 text-base rounded-xl border border-border focus:border-orange-500 bg-background shadow-sm"
                            />
                            <p className="text-xs text-muted-foreground mt-0.5">Dedicated workspace only</p>
                          </div>
                          <div>
                            <label htmlFor="profile-totalHomeSqft" className="block text-xs font-semibold text-foreground mb-1">Total Home Sq Ft</label>
                            <Input id="profile-totalHomeSqft"
                              type="number"
                              step="any"
                              value={formData.totalHomeSqft ?? ''}
                              onChange={(e) => setFormData(prev => ({ ...prev, totalHomeSqft: e.target.value === '' ? undefined : Number(e.target.value) }))}
                              placeholder="e.g., 1200"
                              className="min-h-11 text-base rounded-xl border border-border focus:border-orange-500 bg-background shadow-sm"
                            />
                            <p className="text-xs text-muted-foreground mt-0.5">Calculates deduction %</p>
                          </div>
                        </div>
                      </div>

                      {/* Vehicle */}
                      <div className="pt-2 border-t border-border">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Vehicle</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label htmlFor="profile-vehicleBusinessUsePercentage" className="block text-xs font-semibold text-foreground mb-1">Business Use %</label>
                            <Input id="profile-vehicleBusinessUsePercentage"
                              type="number"
                              step="any"
                              min="0"
                              max="100"
                              value={formData.vehicleBusinessUsePercentage ?? ''}
                              onChange={(e) => setFormData(prev => ({ ...prev, vehicleBusinessUsePercentage: e.target.value === '' ? undefined : Number(e.target.value) }))}
                              placeholder="e.g., 75"
                              className="min-h-11 text-base rounded-xl border border-border focus:border-orange-500 bg-background shadow-sm"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    </details>
                  )}
            </div>
          </div>}
        </fieldset>
      </div>

      <div className="shrink-0 border-t border-border bg-background px-4 py-3">
        <div className="mx-auto max-w-xl">
          {currentMissing.length > 0 && <p className="mb-2 text-xs text-muted-foreground" role="status">Still needed: {currentMissing.join(', ')}.</p>}
          {(error || detailsError) && <p role="alert" className="mb-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{error || detailsError}</p>}
          <div className="flex items-center justify-between gap-3">
            <Button onClick={previousStep} disabled={isSubmitting} variant="outline" className="min-h-11 rounded-xl px-4">
              {currentSlide === 'about' ? 'Back' : 'Previous'}
            </Button>
            {currentSlide !== 'business' ? <Button onClick={() => { if (canContinue) setCurrentSlide(slides[slideIndex + 1]); }} disabled={!canContinue || isSubmitting} className="min-h-11 rounded-xl px-5">
              Next <ArrowRight className="h-4 w-4" />
            </Button> : <Button onClick={handleSubmit} disabled={!isFormValid || isSubmitting} className="min-h-11 rounded-xl px-5">
              {isSubmitting ? 'Saving...' : 'Save and continue'}<ArrowRight className="h-4 w-4" />
            </Button>}
          </div>
        </div>
      </div>
    </div>
  );
};
