import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { YearInput } from '@/components/ui/year-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/simple-select';
import { User, Briefcase, MapPin, FileText, Mail, ArrowRight, ArrowLeft } from '@/lib/icons';
import { upsertUserProfile } from '@/lib/firebase/profiles';
import { PlaidLinkScreen } from './plaid-link-screen';

interface UserProfile {
  email: string;
  name: string;
  profession: string[];
  customProfession?: string;
  businessEntityType: string;
  primaryWorkLocation: string;
  workRelatedTravelPattern: string;
  income: string;
  state: string;
  filingStatus: string;
  plaidToken?: string;
  
  // Phase 1: High Impact Fields
  itemizationStatus?: 'itemize' | 'standard';
  businessStartDate?: string;
  homeOfficeSqft?: number;
  totalHomeSqft?: number;
  homeOfficeMethod?: 'simplified' | 'actual';
  vehicleBusinessUsePercentage?: number;
  vehicleDeductionMethod?: 'standard_mileage' | 'actual_expense';
  
  // Phase 2: Medium Impact Fields
  naicsCode?: string;
  businessPurpose?: string;
  ein?: string;
  w2Income?: number;
  businessIncome?: number;
  otherIncome?: number;
  taxBracket?: number;
  professionalLicenses?: string[];
  
  // Phase 3: Advanced Fields
  priorYearDeductions?: string[];
  auditHistory?: 'none' | 'minor' | 'major';
  taxProfessional?: boolean;
  documentationHabits?: 'minimal' | 'moderate' | 'detailed';
  businessSeasonality?: 'year_round' | 'seasonal' | 'project_based';
  multipleLocations?: boolean;
  internationalBusiness?: boolean;
  
  // Vehicle Details
  businessVehicle?: {
    make?: string;
    model?: string;
    year?: number;
    businessUsePercentage?: number;
    deductionMethod?: 'standard_mileage' | 'actual_expense';
  };
  
  // Home Office Details
  homeOfficeDetails?: {
    sqft?: number;
    totalHomeSqft?: number;
    method?: 'simplified' | 'actual';
    exclusiveUse?: boolean;
    startDate?: string;
  };
  
  // Income Breakdown
  incomeBreakdown?: {
    w2_income?: number;
    business_income?: number;
    other_income?: number;
    quarterly_estimates?: number[];
  };
  
  // Deductions & Credits
  numberOfDependents?: number;
  homeownershipStatus?: 'own_mortgage' | 'own_outright' | 'rent' | 'other';
  mortgageInterestPaid?: number;
  retirementContributions?: number;
  studentLoanInterestPaid?: number;
  charitableDonations?: number;
  childcareExpenses?: number;
  selfEmployedHealthInsurance?: number;
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

const businessEntityTypes = [
  'Sole Proprietor / Independent Contractor',
  'Single-Member LLC (disregarded entity)',
  'Multi-Member LLC',
  'S-Corporation',
  'C-Corporation',
  'Partnership',
  'This does not apply to me'
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

// New options for enhanced profile

const itemizationStatuses = [
  'I itemize deductions',
  'I take the standard deduction'
];

const homeOfficeMethods = [
  'Simplified Method ($5/sq ft)',
  'Actual Expense Method'
];

const vehicleDeductionMethods = [
  'Standard Mileage Rate',
  'Actual Expense Method'
];


const documentationHabits = [
  'Minimal (basic receipts)',
  'Moderate (organized records)',
  'Detailed (comprehensive documentation)'
];

const businessSeasonalities = [
  'Year-round business',
  'Seasonal business',
  'Project-based work'
];

const auditHistories = [
  'No audit history',
  'Minor audit (simple questions)',
  'Major audit (detailed examination)'
];

export const ProfileSetupScreen: React.FC<ProfileSetupScreenProps> = ({ user, onBack, onComplete }) => {
  const [currentStep, setCurrentStep] = useState<'profile' | 'plaid'>('profile');
  const [currentSlide, setCurrentSlide] = useState<'basic' | 'professional' | 'business' | 'advanced' | 'deductions'>('basic');
  const [formData, setFormData] = useState<UserProfile>({
    email: user?.email || '',
    name: user?.user_metadata?.name || '',
    profession: [],
    customProfession: '',
    businessEntityType: '',
    primaryWorkLocation: '',
    workRelatedTravelPattern: '',
    income: '',
    state: '',
    filingStatus: '',
    plaidToken: '',
    
    // Phase 1: High Impact Fields
    itemizationStatus: undefined,
    businessStartDate: '',
    homeOfficeSqft: undefined,
    totalHomeSqft: undefined,
    homeOfficeMethod: undefined,
    vehicleBusinessUsePercentage: undefined,
    vehicleDeductionMethod: undefined,
    
    // Phase 2: Medium Impact Fields
    naicsCode: '',
    businessPurpose: '',
    ein: '',
    w2Income: undefined,
    businessIncome: undefined,
    otherIncome: undefined,
    taxBracket: undefined,
    professionalLicenses: [],
    
    // Phase 3: Advanced Fields
    priorYearDeductions: [],
    auditHistory: 'none',
    taxProfessional: false,
    documentationHabits: 'moderate',
    businessSeasonality: 'year_round',
    multipleLocations: false,
    internationalBusiness: false,
    
    // Vehicle Details
    businessVehicle: {
      make: '',
      model: '',
      year: undefined,
      businessUsePercentage: undefined,
      deductionMethod: undefined
    },
    
    // Home Office Details
    homeOfficeDetails: {
      sqft: undefined,
      totalHomeSqft: undefined,
      method: undefined,
      exclusiveUse: false,
      startDate: ''
    },
    
    // Income Breakdown
    incomeBreakdown: {
      w2_income: undefined,
      business_income: undefined,
      other_income: undefined,
      quarterly_estimates: []
    },
    
    // Deductions & Credits
    numberOfDependents: undefined,
    homeownershipStatus: undefined,
    mortgageInterestPaid: undefined,
    retirementContributions: undefined,
    studentLoanInterestPaid: undefined,
    charitableDonations: undefined,
    childcareExpenses: undefined,
    selfEmployedHealthInsurance: undefined
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingTable, setIsCreatingTable] = useState(false);
  const [noBusiness, setNoBusiness] = useState(false);
  const [fillDeductionsLater, setFillDeductionsLater] = useState(false);

  // Validation for each slide
  const isBasicInfoValid = formData.email && formData.name && formData.state && formData.filingStatus;
  
  const isProfessionalInfoValid = formData.profession.length > 0 && 
                                 formData.businessEntityType && formData.primaryWorkLocation && formData.workRelatedTravelPattern &&
                                 formData.income &&
                                 (!formData.profession.includes('Other') || (formData.profession.includes('Other') && formData.customProfession?.trim()));

  const isBusinessInfoValid = noBusiness || (formData.businessPurpose && formData.businessStartDate && formData.businessSeasonality);

  const isAdvancedInfoValid = formData.auditHistory && 
                              formData.homeOfficeSqft !== undefined && 
                              formData.homeOfficeSqft > 0 &&
                              formData.vehicleBusinessUsePercentage !== undefined &&
                              formData.vehicleBusinessUsePercentage >= 0 &&
                              formData.vehicleBusinessUsePercentage <= 100;

  const isDeductionsInfoValid = fillDeductionsLater || (
    formData.numberOfDependents !== undefined &&
    formData.homeownershipStatus &&
    formData.retirementContributions !== undefined &&
    formData.studentLoanInterestPaid !== undefined &&
    formData.charitableDonations !== undefined &&
    formData.childcareExpenses !== undefined &&
    formData.selfEmployedHealthInsurance !== undefined
  );

  const isFormValid = isBasicInfoValid && isProfessionalInfoValid && isBusinessInfoValid && isAdvancedInfoValid && isDeductionsInfoValid;

  // Navigation functions
  const handleNextSlide = () => {
    if (currentSlide === 'basic' && isBasicInfoValid) {
      setCurrentSlide('professional');
    } else if (currentSlide === 'professional' && isProfessionalInfoValid) {
      setCurrentSlide('business');
    } else if (currentSlide === 'business' && isBusinessInfoValid) {
      setCurrentSlide('advanced');
    } else if (currentSlide === 'advanced' && isAdvancedInfoValid) {
      setCurrentSlide('deductions');
    }
  };

  const handlePrevSlide = () => {
    if (currentSlide === 'professional') {
      setCurrentSlide('basic');
    } else if (currentSlide === 'business') {
      setCurrentSlide('professional');
    } else if (currentSlide === 'advanced') {
      setCurrentSlide('business');
    } else if (currentSlide === 'deductions') {
      setCurrentSlide('advanced');
    }
  };

  const handleBackButton = () => {
    if (currentSlide === 'professional') {
      // Go back to basic information slide
      setCurrentSlide('basic');
    } else {
      // On basic slide, use external back handler
      onBack();
    }
  };

  // Handle profession selection (multiple selection)
  const handleProfessionChange = (profession: string, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      profession: checked 
        ? [...prev.profession, profession]
        : prev.profession.filter(p => p !== profession),
      // Clear custom profession if "Other" is deselected
      customProfession: profession === 'Other' && !checked ? '' : prev.customProfession
    }));
  };

  const handleSubmit = async () => {
    if (!isFormValid) {
      return;
    }
    setIsSubmitting(true);
    setError(null);

    try {
      // Prepare profession string - include custom profession if "Other" is selected
      let professionString = formData.profession.join(', ');
      if (formData.profession.includes('Other') && formData.customProfession?.trim()) {
        // Replace "Other" with the custom profession
        professionString = formData.profession
          .filter(p => p !== 'Other')
          .concat(formData.customProfession.trim())
          .join(', ');
      }

      // Save profile to Firebase using the database service
      const { data, error: profileError } = await upsertUserProfile(user.id, {
        email: formData.email,
        name: formData.name,
        profession: professionString, // Use processed profession string
        business_entity_type: formData.businessEntityType,
        primary_work_location: formData.primaryWorkLocation,
        work_related_travel_pattern: formData.workRelatedTravelPattern,
        income: formData.income,
        state: formData.state,
        filing_status: formData.filingStatus,
        plaid_token: formData.plaidToken,
        
        // Phase 1: High Impact Fields
        itemization_status: formData.itemizationStatus,
        business_start_date: formData.businessStartDate,
        home_office_sqft: formData.homeOfficeSqft,
        total_home_sqft: formData.totalHomeSqft,
        home_office_method: formData.homeOfficeMethod,
        vehicle_business_use_percentage: formData.vehicleBusinessUsePercentage,
        vehicle_deduction_method: formData.vehicleDeductionMethod,
        
        // Phase 2: Medium Impact Fields
        naics_code: formData.naicsCode,
        business_purpose: formData.businessPurpose,
        ein: formData.ein,
        w2_income: formData.w2Income,
        business_income: formData.businessIncome,
        other_income: formData.otherIncome,
        tax_bracket: formData.taxBracket,
        professional_licenses: formData.professionalLicenses,
        
        // Phase 3: Advanced Fields
        prior_year_deductions: formData.priorYearDeductions,
        audit_history: formData.auditHistory,
        tax_professional: formData.taxProfessional,
        documentation_habits: formData.documentationHabits,
        business_seasonality: formData.businessSeasonality,
        multiple_locations: formData.multipleLocations,
        international_business: formData.internationalBusiness,
        
        // Vehicle Details
        business_vehicle: formData.businessVehicle,
        
        // Home Office Details
        home_office_details: formData.homeOfficeDetails,
        
        // Income Breakdown
        income_breakdown: formData.incomeBreakdown,
        
        // Deductions & Credits
        number_of_dependents: formData.numberOfDependents,
        homeownership_status: formData.homeownershipStatus,
        mortgage_interest_paid: formData.mortgageInterestPaid,
        retirement_contributions: formData.retirementContributions,
        student_loan_interest_paid: formData.studentLoanInterestPaid,
        charitable_donations: formData.charitableDonations,
        childcare_expenses: formData.childcareExpenses,
        self_employed_health_insurance: formData.selfEmployedHealthInsurance
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
      
      // Move to Plaid connection step
      setCurrentStep('plaid');
      
    } catch (error) {
      console.error('Error saving profile:', error);
      setError(error instanceof Error ? error.message : 'Failed to save profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePlaidSuccess = (linkToken: string) => {
    setFormData(prev => ({ ...prev, plaidToken: linkToken }));
    onComplete(formData, '/protected?screen=dashboard');
  };

  const handlePlaidBack = () => {
    setCurrentStep('profile');
  };

  if (currentStep === 'plaid') {
    return (
      <PlaidLinkScreen
        user={user}
        onSuccess={handlePlaidSuccess}
        onBack={handlePlaidBack}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="flex items-center justify-between p-4 max-w-4xl mx-auto">
          <button 
            onClick={handleBackButton}
            className="w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all duration-200 shadow-sm"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-lg">W</span>
            </div>
            <span className="font-bold text-slate-900 text-lg">WriteOff</span>
          </div>
          
          <div className="w-10 h-10"></div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4 pb-4">
        {/* Title Section */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Complete Your Profile</h1>
          <p className="text-slate-600 text-base">Help us personalize your tax experience</p>
        </div>

        {/* Progress Indicator */}
        <div className="flex items-center justify-center mb-6">
          <div className="flex items-center gap-2">
            {['basic', 'professional', 'business', 'advanced', 'deductions'].map((slide, index) => (
              <React.Fragment key={slide}>
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
                    currentSlide === slide ? 'bg-blue-600 shadow-lg shadow-blue-200' : 'bg-slate-200'
                  }`}>
                    <span className={`font-semibold text-xs ${
                      currentSlide === slide ? 'text-white' : 'text-slate-500'
                    }`}>{index + 1}</span>
                  </div>
                  <span className={`text-xs font-medium transition-colors duration-300 ${
                    currentSlide === slide ? 'text-slate-900' : 'text-slate-500'
                  }`}>
                    {slide === 'basic' ? 'Basic' : 
                     slide === 'professional' ? 'Professional' :
                     slide === 'business' ? 'Business' : 
                     slide === 'advanced' ? 'Advanced' : 'Deductions'}
                  </span>
                </div>
                {index < 4 && <div className="w-6 h-0.5 bg-slate-200"></div>}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Slide Container */}
        <div className="relative overflow-hidden">
          <div className={`flex transition-transform duration-500 ease-in-out ${
            currentSlide === 'basic' ? 'translate-x-0' : 
            currentSlide === 'professional' ? '-translate-x-full' :
            currentSlide === 'business' ? '-translate-x-[200%]' :
            currentSlide === 'advanced' ? '-translate-x-[300%]' :
            '-translate-x-[400%]'
          }`}>
            
            {/* Basic Information Slide */}
            <div className="w-full flex-shrink-0">
              <Card className="p-6 bg-white/70 backdrop-blur-sm border border-white/50 shadow-xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Basic Information</h2>
                    <p className="text-sm text-slate-600">Your personal details and tax information</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                        <Mail className="w-4 h-4 text-blue-600" />
                        Email Address <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <Input
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                          placeholder="Enter your email"
                          className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-blue-500 bg-white pr-12 shadow-sm"
                          disabled
                        />
                        <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                          <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                            <span className="text-white text-xs font-bold">✓</span>
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-green-600 mt-2 font-medium">✓ Verified email address</p>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                        <User className="w-4 h-4 text-blue-600" />
                        Full Name <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Enter your full name"
                        className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-blue-500 bg-white shadow-sm"
                      />
                    </div>

                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-blue-600" />
                        State of Residence <span className="text-red-500">*</span>
                      </label>
                      <Select value={formData.state} onValueChange={(value: string) => setFormData(prev => ({ ...prev, state: value }))}>
                        <SelectTrigger className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-blue-500 bg-white shadow-sm">
                          <SelectValue placeholder="Select your state" />
                        </SelectTrigger>
                        <SelectContent>
                          {usStates.map((state) => (
                            <SelectItem key={state} value={state}>
                              {state}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-600" />
                        Filing Status <span className="text-red-500">*</span>
                      </label>
                      <Select value={formData.filingStatus} onValueChange={(value: string) => setFormData(prev => ({ ...prev, filingStatus: value }))}>
                        <SelectTrigger className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-blue-500 bg-white shadow-sm">
                          <SelectValue placeholder="Select your filing status" />
                        </SelectTrigger>
                        <SelectContent>
                          {filingStatuses.map((status) => (
                            <SelectItem key={status} value={status}>
                              {status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Professional Details Slide */}
            <div className="w-full flex-shrink-0">
              <Card className="p-6 bg-white/70 backdrop-blur-sm border border-white/50 shadow-xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg">
                    <Briefcase className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Professional Details</h2>
                    <p className="text-sm text-slate-600">Your work and business information</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-emerald-600" />
                      Profession(s) <span className="text-red-500">*</span>
                    </label>
                    <p className="text-xs text-slate-600 mb-3">Select all that apply to your work</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto border-2 border-slate-200 rounded-xl p-3 bg-white shadow-sm">
                      {professions.map((profession) => (
                        <label key={profession} className="flex items-center space-x-2 cursor-pointer hover:bg-slate-50 p-2 rounded-lg transition-colors">
                          <Checkbox
                            checked={formData.profession.includes(profession)}
                            onCheckedChange={(checked) => handleProfessionChange(profession, checked as boolean)}
                            className="text-emerald-600"
                          />
                          <span className="text-sm text-slate-700 font-medium">{profession}</span>
                        </label>
                      ))}
                    </div>
                    {formData.profession.length > 0 && (
                      <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                        <p className="text-sm text-emerald-700 font-medium">Selected: {formData.profession.join(', ')}</p>
                      </div>
                    )}
                    
                    {/* Custom profession input */}
                    {formData.profession.includes('Other') && (
                      <div className="mt-4">
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                          Please specify your profession <span className="text-red-500">*</span>
                        </label>
                        <Input
                          type="text"
                          value={formData.customProfession || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, customProfession: e.target.value }))}
                          placeholder="Enter your profession"
                          className="h-12 text-sm rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-white shadow-sm"
                        />
                        <p className="text-xs text-slate-500 mt-2">This will replace "Other" in your profession list</p>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                        <Briefcase className="w-4 h-4 text-emerald-600" />
                        Business Entity Type <span className="text-red-500">*</span>
                      </label>
                      <Select value={formData.businessEntityType} onValueChange={(value: string) => setFormData(prev => ({ ...prev, businessEntityType: value }))}>
                        <SelectTrigger className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-white shadow-sm">
                          <SelectValue placeholder="Select your business entity type" />
                        </SelectTrigger>
                        <SelectContent>
                          {businessEntityTypes.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-emerald-600" />
                        Primary Work Location <span className="text-red-500">*</span>
                      </label>
                      <Select value={formData.primaryWorkLocation} onValueChange={(value: string) => setFormData(prev => ({ ...prev, primaryWorkLocation: value }))}>
                        <SelectTrigger className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-white shadow-sm">
                          <SelectValue placeholder="Select your primary work location" />
                        </SelectTrigger>
                        <SelectContent>
                          {primaryWorkLocations.map((location) => (
                            <SelectItem key={location} value={location}>
                              {location}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                        <Briefcase className="w-4 h-4 text-emerald-600" />
                        Work-Related Travel Pattern <span className="text-red-500">*</span>
                      </label>
                      <Select value={formData.workRelatedTravelPattern} onValueChange={(value: string) => setFormData(prev => ({ ...prev, workRelatedTravelPattern: value }))}>
                        <SelectTrigger className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-white shadow-sm">
                          <SelectValue placeholder="Select your travel pattern" />
                        </SelectTrigger>
                        <SelectContent>
                          {workRelatedTravelPatterns.map((pattern) => (
                            <SelectItem key={pattern} value={pattern}>
                              {pattern}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-emerald-600" />
                        Annual Income Range <span className="text-red-500">*</span>
                      </label>
                      <Select value={formData.income} onValueChange={(value: string) => setFormData(prev => ({ ...prev, income: value }))}>
                        <SelectTrigger className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-emerald-500 bg-white shadow-sm">
                          <SelectValue placeholder="Select your income range" />
                        </SelectTrigger>
                        <SelectContent>
                          {incomeRanges.map((range) => (
                            <SelectItem key={range} value={range}>
                              {range}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </Card>
            </div>


            {/* Business Details Slide */}
            <div className="w-full flex-shrink-0">
              <Card className="p-6 bg-white/70 backdrop-blur-sm border border-white/50 shadow-xl mx-2">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center shadow-lg">
                    <Briefcase className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Business Details</h2>
                    <p className="text-sm text-slate-600">Your business structure and operations</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  {/* No Business Checkbox */}
                  <div className="flex items-center space-x-2 mb-4">
                    <input
                      type="checkbox"
                      id="noBusiness"
                      checked={noBusiness}
                      onChange={(e) => setNoBusiness(e.target.checked)}
                      className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                    />
                    <label htmlFor="noBusiness" className="text-sm font-medium text-slate-700">
                      I don't have a business
                    </label>
                  </div>

                  {!noBusiness && (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Business Purpose <span className="text-red-500">*</span>
                          </label>
                          <Input
                            type="text"
                            value={formData.businessPurpose || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, businessPurpose: e.target.value }))}
                            placeholder="Describe your business"
                            className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-orange-500 bg-white shadow-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Business Start Date <span className="text-red-500">*</span>
                          </label>
                          <Input
                            type="date"
                            value={formData.businessStartDate || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, businessStartDate: e.target.value }))}
                            className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-orange-500 bg-white shadow-sm"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {!noBusiness && (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            EIN (Optional)
                          </label>
                          <Input
                            type="text"
                            value={formData.ein || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, ein: e.target.value }))}
                            placeholder="XX-XXXXXXX"
                            className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-orange-500 bg-white shadow-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Business Seasonality <span className="text-red-500">*</span>
                          </label>
                          <Select
                            value={formData.businessSeasonality || 'year_round'}
                            onValueChange={(value) => setFormData(prev => ({ ...prev, businessSeasonality: value as 'year_round' | 'seasonal' | 'project_based' }))}
                          >
                            <SelectTrigger className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-orange-500 bg-white shadow-sm">
                              <SelectValue placeholder="Select business pattern" />
                            </SelectTrigger>
                            <SelectContent>
                              {businessSeasonalities.map((seasonality) => (
                                <SelectItem key={seasonality} value={seasonality.toLowerCase().replace(' ', '_').replace('-', '_')}>
                                  {seasonality}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex items-center space-x-4">
                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id="multipleLocations"
                              checked={formData.multipleLocations || false}
                              onChange={(e) => setFormData(prev => ({ ...prev, multipleLocations: e.target.checked }))}
                              className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                            />
                            <label htmlFor="multipleLocations" className="text-sm font-medium text-slate-700">
                              Multiple business locations
                            </label>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </Card>
            </div>

            {/* Advanced Settings Slide */}
            <div className="w-full flex-shrink-0">
              <Card className="p-6 bg-white/70 backdrop-blur-sm border border-white/50 shadow-xl mx-2">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
                    <FileText className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Advanced Settings</h2>
                    <p className="text-sm text-slate-600">Required tax preferences</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Audit History <span className="text-red-500">*</span>
                      </label>
                      <Select
                        value={formData.auditHistory || 'none'}
                        onValueChange={(value) => setFormData(prev => ({ ...prev, auditHistory: value as 'none' | 'minor' | 'major' }))}
                      >
                        <SelectTrigger className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-indigo-500 bg-white shadow-sm">
                          <SelectValue placeholder="Select audit history" />
                        </SelectTrigger>
                        <SelectContent>
                          {auditHistories.map((history) => (
                            <SelectItem key={history} value={history.toLowerCase().replace(' ', '_').replace('(', '').replace(')', '').replace(' ', '_')}>
                              {history}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="taxProfessional"
                          checked={formData.taxProfessional || false}
                          onChange={(e) => setFormData(prev => ({ ...prev, taxProfessional: e.target.checked }))}
                          className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                        />
                        <label htmlFor="taxProfessional" className="text-sm font-medium text-slate-700">
                          I use a tax professional
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Home Office Square Footage <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="number"
                        value={formData.homeOfficeSqft || ''}
                        onChange={(e) => setFormData(prev => ({ ...prev, homeOfficeSqft: parseInt(e.target.value) || undefined }))}
                        placeholder="e.g., 150"
                        className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-indigo-500 bg-white shadow-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Vehicle Business Use % <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={formData.vehicleBusinessUsePercentage || ''}
                        onChange={(e) => setFormData(prev => ({ ...prev, vehicleBusinessUsePercentage: parseInt(e.target.value) || undefined }))}
                        placeholder="e.g., 75"
                        className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-indigo-500 bg-white shadow-sm"
                      />
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Deductions & Credits Slide */}
            <div className="w-full flex-shrink-0">
              <Card className="p-6 bg-white/70 backdrop-blur-sm border border-white/50 shadow-xl mx-2">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center shadow-lg">
                    <FileText className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Deductions & Credits</h2>
                    <p className="text-sm text-slate-600">Maximize your tax savings</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  {/* Fill Out Later Checkbox */}
                  <div className="flex items-center space-x-2 mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <input
                      type="checkbox"
                      id="fillDeductionsLater"
                      checked={fillDeductionsLater}
                      onChange={(e) => setFillDeductionsLater(e.target.checked)}
                      className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                    />
                    <label htmlFor="fillDeductionsLater" className="text-sm font-medium text-blue-900">
                      I'll fill out deductions and credits later
                    </label>
                  </div>

                  {!fillDeductionsLater && (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Number of Dependents <span className="text-red-500">*</span>
                          </label>
                          <Input
                            type="number"
                            min="0"
                            value={formData.numberOfDependents || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, numberOfDependents: parseInt(e.target.value) || undefined }))}
                            placeholder="0"
                            className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-green-500 bg-white shadow-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Homeownership Status <span className="text-red-500">*</span>
                          </label>
                          <Select
                            value={formData.homeownershipStatus}
                            onValueChange={(value) => setFormData(prev => ({ ...prev, homeownershipStatus: value as any }))}
                          >
                            <SelectTrigger className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-green-500 bg-white shadow-sm">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="own_mortgage">Own with mortgage</SelectItem>
                              <SelectItem value="own_outright">Own outright</SelectItem>
                              <SelectItem value="rent">Rent</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {formData.homeownershipStatus === 'own_mortgage' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                              Annual Mortgage Interest Paid
                            </label>
                            <Input
                              type="number"
                              min="0"
                              value={formData.mortgageInterestPaid || ''}
                              onChange={(e) => setFormData(prev => ({ ...prev, mortgageInterestPaid: parseInt(e.target.value) || undefined }))}
                              placeholder="$0"
                              className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-green-500 bg-white shadow-sm"
                            />
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Retirement Contributions (IRA/401k) <span className="text-red-500">*</span>
                          </label>
                          <Input
                            type="number"
                            min="0"
                            value={formData.retirementContributions || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, retirementContributions: parseInt(e.target.value) || undefined }))}
                            placeholder="$0"
                            className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-green-500 bg-white shadow-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Student Loan Interest Paid <span className="text-red-500">*</span>
                          </label>
                          <Input
                            type="number"
                            min="0"
                            value={formData.studentLoanInterestPaid || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, studentLoanInterestPaid: parseInt(e.target.value) || undefined }))}
                            placeholder="$0"
                            className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-green-500 bg-white shadow-sm"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Annual Charitable Donations <span className="text-red-500">*</span>
                          </label>
                          <Input
                            type="number"
                            min="0"
                            value={formData.charitableDonations || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, charitableDonations: parseInt(e.target.value) || undefined }))}
                            placeholder="$0"
                            className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-green-500 bg-white shadow-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Annual Childcare Expenses <span className="text-red-500">*</span>
                          </label>
                          <Input
                            type="number"
                            min="0"
                            value={formData.childcareExpenses || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, childcareExpenses: parseInt(e.target.value) || undefined }))}
                            placeholder="$0"
                            className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-green-500 bg-white shadow-sm"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Self-Employed Health Insurance <span className="text-red-500">*</span>
                          </label>
                          <Input
                            type="number"
                            min="0"
                            value={formData.selfEmployedHealthInsurance || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, selfEmployedHealthInsurance: parseInt(e.target.value) || undefined }))}
                            placeholder="$0"
                            className="h-10 text-sm rounded-xl border-2 border-slate-200 focus:border-green-500 bg-white shadow-sm"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </div>

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between mt-2">
          <Button
            onClick={handlePrevSlide}
            disabled={currentSlide === 'basic'}
            variant="outline"
            className="h-10 px-5 rounded-xl border-2 border-slate-200 hover:border-slate-300 bg-white shadow-sm disabled:opacity-50"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Previous
          </Button>

          {currentSlide === 'deductions' ? (
            <Button
              onClick={handleSubmit}
              disabled={!isFormValid || isSubmitting}
              className="h-10 px-6 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white shadow-lg shadow-emerald-200 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                  Creating Profile...
                </>
              ) : (
                <>
                  Continue to Bank Connection
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={handleNextSlide}
              disabled={
                (currentSlide === 'basic' && !isBasicInfoValid) ||
                (currentSlide === 'professional' && !isProfessionalInfoValid) ||
                (currentSlide === 'business' && !isBusinessInfoValid) ||
                (currentSlide === 'advanced' && !isAdvancedInfoValid) ||
                (currentSlide === 'deductions' && !isDeductionsInfoValid)
              }
              className="h-10 px-6 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg shadow-blue-200 disabled:opacity-50"
            >
              Next
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>

        {error && (
          <div className="mt-6 p-4 bg-red-50 border-2 border-red-200 rounded-xl">
            <p className="text-red-600 text-sm font-medium">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};
