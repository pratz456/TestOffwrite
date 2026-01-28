import OpenAI from 'openai';
import { z } from 'zod';
import { aiLearningEngine } from './learning-engine';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const OutputSchema = z.object({
  status: z.enum(['ok', 'needs_more_info', 'blocked']),
  is_deductible: z.boolean().optional(),
  expense_type: z.enum(['business', 'personal']).optional(), // Explicit classification: business or personal expense
  category: z.enum([
    'advertising_marketing',
    'supplies_small_tools',
    'software_subscriptions',
    'contract_labor',
    'equipment',
    'vehicle_expense',
    'travel',
    'meals_50',
    'home_office',
    'utilities_phone_internet',
    'education_training',
    'dues_and_memberships',
    'bank_and_payment_fees',
    'rent',
    'other'
  ]).optional(),
  deductible_percent: z.number().min(0).max(100).optional(),
  key_analysis_factor: z.string().max(400).optional(),
  customized_reason: z.string().optional(),
  reasoning_summary: z.string().optional(), // New field for profile-aware reasoning
  irs_refs: z.array(z.string()).max(3).optional(),
  audit_risk: z.enum(['low', 'medium', 'high']).optional(),
  audit_risk_rationale: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  missing_fields: z.array(z.string()).optional(),
  questions: z.array(z.string()).max(3).optional(),
  documentation_required: z.array(z.string()).max(5).optional(), // New field for required docs
  reason: z.string().optional(),
  reason_hash: z.string().optional(),
});

export type OutputType = z.infer<typeof OutputSchema>;

export interface TransactionInput {
  tx_id: string;
  merchant: string;
  mcc?: string;
  amount_usd: number;
  date_iso: string;
  datetime_iso?: string; // Full datetime from Plaid (ISO format)
  time_24h?: string;
  
  // Transaction-Specific Context Fields
  business_purpose?: string;
  attendees?: string[];
  travel_destination?: string;
  equipment_details?: {
    make?: string;
    model?: string;
    year?: number;
    business_use_percentage?: number;
    depreciation_method?: 'straight_line' | 'declining_balance' | 'section_179';
  };
  client_project?: string;
  documentation_status?: 'complete' | 'partial' | 'missing';
  meeting_notes?: string;
  mileage_details?: {
    start_location?: string;
    end_location?: string;
    miles?: number;
    business_purpose?: string;
  };
  city?: string;
  state?: string;
  channel?: string;
  note?: string;
  
  // Additional Plaid Transaction Fields
  location?: {
    address?: string;
    city?: string;
    state?: string;
    lat?: number;
    lon?: number;
  };
  payment_channel?: 'in_store' | 'online' | 'other';
  authorized_date?: string;
  iso_currency_code?: string;
  unofficial_currency_code?: string;
  personal_finance_category?: {
    primary?: string;
    detailed?: string;
    confidence?: string;
  };
  pending?: boolean;
  pending_transaction_id?: string;
  account_owner?: string;
  transaction_code?: string;
  merchant_category_code?: string;
  
  // Legacy fields for backward compatibility
  merchant_name?: string;
  amount?: number;
  category?: string;
  date?: string;
  datetime?: string; // Legacy datetime field
  account_id?: string;
  description?: string;
  notes?: string;
}

export interface UserContext {
  user_id: string;
  age: number;
  profession: string[]; // Array of professions
  annual_gross_income_usd: number;
  filing_state: string;
  // Optional but valuable fields
  business_entity?: 'sole_proprietor' | 'single_member_llc' | 's_corporation' | 'c_corporation' | 'partnership' | 'nonprofit';
  office_location?: string; // city/zip
  work_related_travel?: 'none' | 'occasional' | 'frequent';
  // Legacy fields for backward compatibility
  income?: string;
  state?: string;
  filing_status?: string;
  business_structure?: string;
  itemized?: boolean;
  prior_deductions_used?: string[];
  mixed_use_flag?: boolean;
  annual_income_scale?: string;
  
  // Phase 1: High Impact Fields
  itemization_status?: 'itemize' | 'standard';
  business_start_date?: string;
  years_in_business?: number; // Computed from business_start_date
  home_office_sqft?: number;
  total_home_sqft?: number;
  home_office_method?: 'simplified' | 'actual';
  vehicle_business_use_percentage?: number;
  vehicle_deduction_method?: 'standard_mileage' | 'actual_expense';
  
  // Phase 2: Medium Impact Fields
  naics_code?: string;
  business_purpose?: string;
  ein?: string;
  w2_income?: number;
  business_income?: number;
  other_income?: number;
  tax_bracket?: number;
  professional_licenses?: string[];
  
  // Phase 3: Advanced Fields
  prior_year_deductions?: string[];
  audit_history?: 'none' | 'minor' | 'major';
  tax_professional?: boolean;
  documentation_habits?: 'minimal' | 'moderate' | 'detailed';
  business_seasonality?: 'year_round' | 'seasonal' | 'project_based';
  multiple_locations?: boolean;
  international_business?: boolean;
  
  // Vehicle Details
  business_vehicle?: {
    make?: string;
    model?: string;
    year?: number;
    business_use_percentage?: number;
    deduction_method?: 'standard_mileage' | 'actual_expense';
  };
  
  // Home Office Details
  home_office_details?: {
    sqft?: number;
    total_home_sqft?: number;
    method?: 'simplified' | 'actual';
    exclusive_use?: boolean;
    start_date?: string;
  };
  
  // Income Breakdown
  income_breakdown?: {
    w2_income?: number;
    business_income?: number;
    other_income?: number;
    quarterly_estimates?: number[];
  };
}

const REQUIRED_USER_FIELDS: Array<keyof UserContext> = [
  'profession',
  'age',
  'annual_gross_income_usd',
  'filing_state',
];

// Helper function to extract time from datetime
function extractTimeFromDatetime(datetime?: string): string | undefined {
  if (!datetime) return undefined;
  try {
    const date = new Date(datetime);
    return date.toTimeString().split(' ')[0].substring(0, 5); // HH:MM format
  } catch {
    return undefined;
  }
}

export function findMissingUserFields(ctx?: UserContext) {
  if (!ctx) return REQUIRED_USER_FIELDS.map(String);
  return REQUIRED_USER_FIELDS.filter((f) => ctx[f] === undefined || ctx[f] === null).map(String);
}

// Profession-aware hint map for better categorization
const PROFESSION_HINTS: Record<string, string> = {
  'rideshare': 'vehicle_expense, phone/internet share, tolls/parking, car washes; commuting vs active-gig time',
  'delivery': 'vehicle_expense, phone/internet share, tolls/parking, car washes; commuting vs active-gig time',
  'content_creator': 'software_subscriptions, equipment, supplies_small_tools, travel (client shoots, conferences, networking); meals 50%; home_office if applicable',
  'photographer': 'software_subscriptions, equipment, supplies_small_tools, travel (client shoots, workshops, equipment purchases); meals 50%; home_office if applicable',
  'business_coach': 'travel (client meetings, conferences, speaking engagements), software_subscriptions, home_office, education_training; meals 50%',
  'software_consultant': 'software_subscriptions, utilities_phone_internet share, home_office, education_training (skill maintenance), travel (client sites)',
  'designer': 'software_subscriptions, utilities_phone_internet share, home_office, education_training (skill maintenance), travel (client meetings)',
  'handyman': 'equipment & supplies, local travel mileage, specialized apparel/gear (not everyday clothing)',
  'fitness_trainer': 'equipment & supplies, local travel mileage, specialized apparel/gear (not everyday clothing), travel (client homes, gyms)',
  'tutor': 'equipment & supplies, local travel mileage, specialized apparel/gear (not everyday clothing), travel (student homes, libraries)',
  'musician': 'equipment & supplies, local travel mileage, specialized apparel/gear (not everyday clothing), travel (gigs, rehearsals, lessons)',
};

// Helper function to get profession hints
function getProfessionHints(professions: string[]): string {
  const hints = professions
    .map(p => PROFESSION_HINTS[p.toLowerCase()])
    .filter(Boolean)
    .join('; ');
  return hints ? `Profession hints: ${hints}` : '';
}

// Helper function to calculate age from year of birth
function calculateAge(yearOfBirth: string): number {
  const birthYear = parseInt(yearOfBirth);
  const currentYear = new Date().getFullYear();
  return currentYear - birthYear;
}

// Helper function to convert income range to number
function convertIncomeToNumber(incomeRange: string): number {
  const ranges: Record<string, number> = {
    'Under $11,600': 10000,
    '$11,600 - $47,150': 30000,
    '$47,150 - $100,525': 75000,
    '$100,525 - $191,950': 150000,
    '$191,950 - $243,725': 220000,
    '$243,725 - $609,350': 400000,
    'Over $609,350': 800000,
  };
  return ranges[incomeRange] || 50000; // Default to middle range
}

// Helper function to calculate years in business from start date
function calculateYearsInBusiness(businessStartDate?: string): number | undefined {
  if (!businessStartDate) return undefined;
  try {
    const startDate = new Date(businessStartDate);
    const currentDate = new Date();
    const years = (currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    return Math.floor(years);
  } catch {
    return undefined;
  }
}

// Helper function to convert user profile to enhanced context
export function convertToEnhancedContext(userProfile: any, transactionDate: string): UserContext {
  const professions = userProfile.profession ? userProfile.profession.split(',').map((p: string) => p.trim()) : [];
  const age = userProfile.year_of_birth ? calculateAge(userProfile.year_of_birth) : 30; // Default age
  const income = userProfile.income ? convertIncomeToNumber(userProfile.income) : 50000;
  const yearsInBusiness = calculateYearsInBusiness(userProfile.business_start_date);
  
  return {
    user_id: userProfile.id || '',
    age,
    profession: professions,
    annual_gross_income_usd: income,
    filing_state: userProfile.state || '',
    business_entity: userProfile.business_entity_type?.toLowerCase().replace(/\s+/g, '_') as any,
    office_location: userProfile.primary_work_location,
    work_related_travel: userProfile.work_related_travel_pattern?.toLowerCase().includes('frequent') ? 'frequent' : 
                        userProfile.work_related_travel_pattern?.toLowerCase().includes('occasional') ? 'occasional' : 'none',
    // Legacy fields for backward compatibility
    income: userProfile.income,
    state: userProfile.state,
    filing_status: userProfile.filing_status,
    business_structure: userProfile.business_structure,
    itemized: userProfile.itemized,
    prior_deductions_used: userProfile.prior_deductions_used,
    mixed_use_flag: userProfile.mixed_use_flag,
    annual_income_scale: userProfile.annual_income_scale,
    
    // Phase 1: High Impact Fields
    itemization_status: userProfile.itemization_status,
    business_start_date: userProfile.business_start_date,
    years_in_business: yearsInBusiness,
    home_office_sqft: userProfile.home_office_sqft,
    total_home_sqft: userProfile.total_home_sqft,
    home_office_method: userProfile.home_office_method,
    vehicle_business_use_percentage: userProfile.vehicle_business_use_percentage,
    vehicle_deduction_method: userProfile.vehicle_deduction_method,
    
    // Phase 2: Medium Impact Fields
    naics_code: userProfile.naics_code,
    business_purpose: userProfile.business_purpose,
    ein: userProfile.ein,
    w2_income: userProfile.w2_income,
    business_income: userProfile.business_income,
    other_income: userProfile.other_income,
    tax_bracket: userProfile.tax_bracket,
    professional_licenses: userProfile.professional_licenses || [],
    
    // Phase 3: Advanced Fields
    prior_year_deductions: userProfile.prior_year_deductions || [],
    audit_history: userProfile.audit_history || 'none',
    tax_professional: userProfile.tax_professional || false,
    documentation_habits: userProfile.documentation_habits || 'moderate',
    business_seasonality: userProfile.business_seasonality || 'year_round',
    multiple_locations: userProfile.multiple_locations || false,
    international_business: userProfile.international_business || false,
    
    // Vehicle Details
    business_vehicle: userProfile.business_vehicle || {
      make: '',
      model: '',
      year: undefined,
      business_use_percentage: undefined,
      deduction_method: undefined
    },
    
    // Home Office Details
    home_office_details: userProfile.home_office_details || {
      sqft: undefined,
      total_home_sqft: undefined,
      method: undefined,
      exclusive_use: false,
      start_date: ''
    },
    
    // Income Breakdown
    income_breakdown: userProfile.income_breakdown || {
      w2_income: undefined,
      business_income: undefined,
      other_income: undefined,
      quarterly_estimates: []
    }
  };
}

// Minimal heuristics before model call (cheap wins)
// Comprehensive IRS Publication mapping for different expense types
const IRS_PUBLICATIONS = {
  // Business Expenses (General)
  'general_business': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 334 (Tax Guide for Small Business)', 'IRS Pub 17 (Your Federal Income Tax)'],
  
  // Travel & Transportation
  'travel': ['IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses)', 'IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'transportation': ['IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses)', 'IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'vehicle': ['IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses)', 'IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'mileage': ['IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  
  // Meals & Entertainment
  'meals': ['IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses)', 'IRS Pub 535 (Business Expenses)'],
  'entertainment': ['IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses)', 'IRS Pub 535 (Business Expenses)'],
  'client_meals': ['IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses)'],
  
  // Home Office
  'home_office': ['IRS Pub 587 (Business Use of Your Home)', 'IRS Pub 535 (Business Expenses)'],
  'utilities': ['IRS Pub 587 (Business Use of Your Home)', 'IRS Pub 535 (Business Expenses)'],
  'rent': ['IRS Pub 587 (Business Use of Your Home)', 'IRS Pub 535 (Business Expenses)'],
  
  // Equipment & Depreciation
  'equipment': ['IRS Pub 946 (How to Depreciate Property)', 'IRS Pub 535 (Business Expenses)'],
  'computers': ['IRS Pub 946 (How to Depreciate Property)', 'IRS Pub 535 (Business Expenses)'],
  'software': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 946 (How to Depreciate Property)'],
  'office_supplies': ['IRS Pub 535 (Business Expenses)'],
  
  // Professional Services
  'legal': ['IRS Pub 535 (Business Expenses)'],
  'accounting': ['IRS Pub 535 (Business Expenses)'],
  'consulting': ['IRS Pub 535 (Business Expenses)'],
  'professional_services': ['IRS Pub 535 (Business Expenses)'],
  
  // Marketing & Advertising
  'advertising': ['IRS Pub 535 (Business Expenses)'],
  'marketing': ['IRS Pub 535 (Business Expenses)'],
  'website': ['IRS Pub 535 (Business Expenses)'],
  'social_media': ['IRS Pub 535 (Business Expenses)'],
  
  // Education & Training
  'education': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 970 (Tax Benefits for Education)'],
  'training': ['IRS Pub 535 (Business Expenses)'],
  'conferences': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses)'],
  'seminars': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses)'],
  
  // Insurance & Benefits
  'insurance': ['IRS Pub 535 (Business Expenses)'],
  'health_insurance': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 974 (Premium Tax Credit)'],
  'liability_insurance': ['IRS Pub 535 (Business Expenses)'],
  
  // Communication
  'phone': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 587 (Business Use of Your Home)'],
  'internet': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 587 (Business Use of Your Home)'],
  'postage': ['IRS Pub 535 (Business Expenses)'],
  
  // Banking & Finance
  'bank_fees': ['IRS Pub 535 (Business Expenses)'],
  'interest': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 936 (Home Mortgage Interest Deduction)'],
  'loan_fees': ['IRS Pub 535 (Business Expenses)'],
  
  // Industry-Specific
  'medical': ['IRS Pub 502 (Medical and Dental Expenses)', 'IRS Pub 535 (Business Expenses)'],
  'research': ['IRS Pub 535 (Business Expenses)'],
  'royalties': ['IRS Pub 535 (Business Expenses)'],
  'licenses': ['IRS Pub 535 (Business Expenses)'],
  'permits': ['IRS Pub 535 (Business Expenses)'],
  
  // Miscellaneous
  'dues': ['IRS Pub 535 (Business Expenses)'],
  'subscriptions': ['IRS Pub 535 (Business Expenses)'],
  'publications': ['IRS Pub 535 (Business Expenses)'],
  'gifts': ['IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses)'],
  
  // Employee Benefits
  'employee_benefits': ['IRS Pub 15-B (Employer\'s Tax Guide to Fringe Benefits)', 'IRS Pub 535 (Business Expenses)'],
  'retirement': ['IRS Pub 560 (Retirement Plans for Small Business)', 'IRS Pub 535 (Business Expenses)'],
  
  // Special Situations
  'startup_costs': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'organization_costs': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'bad_debts': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'casualty_losses': ['IRS Pub 547 (Casualties, Disasters, and Thefts)', 'IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  
  // Industry-Specific Publications
  'farming': ['IRS Pub 225 (Farmer\'s Tax Guide)', 'IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'rental_property': ['IRS Pub 527 (Residential Rental Property)', 'IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'real_estate': ['IRS Pub 527 (Residential Rental Property)', 'IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'construction': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)', 'IRS Pub 334 (Tax Guide for Small Business)'],
  'retail': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)', 'IRS Pub 334 (Tax Guide for Small Business)'],
  'technology': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)', 'IRS Pub 334 (Tax Guide for Small Business)'],
  'healthcare': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)', 'IRS Pub 334 (Tax Guide for Small Business)'],
  
  // Additional Specialized Deductions
  'research_development': ['IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)', 'IRS Pub 334 (Tax Guide for Small Business)'],
  'charitable_contributions': ['IRS Pub 526 (Charitable Contributions)', 'IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'miscellaneous_deductions': ['IRS Pub 529 (Miscellaneous Deductions)', 'IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'home_mortgage_interest': ['IRS Pub 936 (Home Mortgage Interest Deduction)', 'IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'retirement_plans': ['IRS Pub 560 (Retirement Plans for Small Business)', 'IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'fringe_benefits': ['IRS Pub 15-B (Employer\'s Tax Guide to Fringe Benefits)', 'IRS Pub 535 (Business Expenses)', 'IRS Pub 17 (Your Federal Income Tax)'],
  
  // State-Specific (Major States)
  'california': ['IRS Pub 535 (Business Expenses)', 'California FTB Pub 1001 (Supplemental Guidelines to California Adjustments)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'new_york': ['IRS Pub 535 (Business Expenses)', 'New York State Tax Guide for Small Business', 'IRS Pub 17 (Your Federal Income Tax)'],
  'texas': ['IRS Pub 535 (Business Expenses)', 'Texas Comptroller Tax Guide', 'IRS Pub 17 (Your Federal Income Tax)'],
  'florida': ['IRS Pub 535 (Business Expenses)', 'Florida Department of Revenue Tax Guide', 'IRS Pub 17 (Your Federal Income Tax)'],
  'illinois': ['IRS Pub 535 (Business Expenses)', 'Illinois Department of Revenue Tax Guide', 'IRS Pub 17 (Your Federal Income Tax)']
};

// Function to get appropriate IRS publications based on expense category and context
function getIRSReferences(category: string, merchant: string, mcc?: string): string[] {
  const merchantLower = merchant.toLowerCase();
  const categoryLower = category.toLowerCase();
  
  // MCC-based mapping
  if (mcc) {
    switch (mcc) {
      case '5812': // Restaurants
      case '5814': // Fast Food
        return IRS_PUBLICATIONS.meals;
      case '4121': // Taxicabs
        return IRS_PUBLICATIONS.transportation;
      case '7991': // Tourist Attractions
      case '7996': // Amusement Parks
        return IRS_PUBLICATIONS.entertainment;
      case '5941': // Sporting Goods
      case '5945': // Hobby Shops
        return IRS_PUBLICATIONS.equipment;
      case '5732': // Electronics
      case '5734': // Computer Software
        return IRS_PUBLICATIONS.computers;
      case '5999': // Miscellaneous Retail
        return IRS_PUBLICATIONS.general_business;
    }
  }
  
  // Merchant name-based mapping
  if (merchantLower.includes('uber') || merchantLower.includes('lyft') || merchantLower.includes('taxi')) {
    return IRS_PUBLICATIONS.transportation;
  }
  if (merchantLower.includes('restaurant') || merchantLower.includes('food') || merchantLower.includes('coffee')) {
    return IRS_PUBLICATIONS.meals;
  }
  if (merchantLower.includes('hotel') || merchantLower.includes('airbnb') || merchantLower.includes('travel')) {
    return IRS_PUBLICATIONS.travel;
  }
  if (merchantLower.includes('office') || merchantLower.includes('coworking') || merchantLower.includes('weWork')) {
    return IRS_PUBLICATIONS.general_business;
  }
  if (merchantLower.includes('software') || merchantLower.includes('saas') || merchantLower.includes('subscription')) {
    return IRS_PUBLICATIONS.software;
  }
  if (merchantLower.includes('legal') || merchantLower.includes('attorney') || merchantLower.includes('lawyer')) {
    return IRS_PUBLICATIONS.legal;
  }
  if (merchantLower.includes('accounting') || merchantLower.includes('cpa') || merchantLower.includes('bookkeeping')) {
    return IRS_PUBLICATIONS.accounting;
  }
  if (merchantLower.includes('marketing') || merchantLower.includes('advertising') || merchantLower.includes('google ads')) {
    return IRS_PUBLICATIONS.advertising;
  }
  if (merchantLower.includes('construction') || merchantLower.includes('contractor') || merchantLower.includes('building')) {
    return IRS_PUBLICATIONS.construction;
  }
  if (merchantLower.includes('real estate') || merchantLower.includes('realtor') || merchantLower.includes('property')) {
    return IRS_PUBLICATIONS.real_estate;
  }
  if (merchantLower.includes('farm') || merchantLower.includes('agriculture') || merchantLower.includes('crop')) {
    return IRS_PUBLICATIONS.farming;
  }
  if (merchantLower.includes('health') || merchantLower.includes('medical') || merchantLower.includes('clinic')) {
    return IRS_PUBLICATIONS.healthcare;
  }
  if (merchantLower.includes('tech') || merchantLower.includes('computer') || merchantLower.includes('digital')) {
    return IRS_PUBLICATIONS.technology;
  }
  if (merchantLower.includes('retail') || merchantLower.includes('store') || merchantLower.includes('shop')) {
    return IRS_PUBLICATIONS.retail;
  }
  if (merchantLower.includes('phone') || merchantLower.includes('verizon') || merchantLower.includes('att')) {
    return IRS_PUBLICATIONS.phone;
  }
  if (merchantLower.includes('internet') || merchantLower.includes('comcast') || merchantLower.includes('spectrum')) {
    return IRS_PUBLICATIONS.internet;
  }
  if (merchantLower.includes('insurance')) {
    return IRS_PUBLICATIONS.insurance;
  }
  if (merchantLower.includes('bank') || merchantLower.includes('chase') || merchantLower.includes('wells fargo')) {
    return IRS_PUBLICATIONS.bank_fees;
  }
  if (merchantLower.includes('education') || merchantLower.includes('training') || merchantLower.includes('course')) {
    return IRS_PUBLICATIONS.education;
  }
  if (merchantLower.includes('conference') || merchantLower.includes('seminar') || merchantLower.includes('workshop')) {
    return IRS_PUBLICATIONS.conferences;
  }
  
  // Category-based mapping
  if (categoryLower.includes('travel') || categoryLower.includes('transportation')) {
    return IRS_PUBLICATIONS.travel;
  }
  if (categoryLower.includes('meals') || categoryLower.includes('food')) {
    return IRS_PUBLICATIONS.meals;
  }
  if (categoryLower.includes('entertainment')) {
    return IRS_PUBLICATIONS.entertainment;
  }
  if (categoryLower.includes('office') || categoryLower.includes('supplies')) {
    return IRS_PUBLICATIONS.office_supplies;
  }
  if (categoryLower.includes('equipment') || categoryLower.includes('computer')) {
    return IRS_PUBLICATIONS.equipment;
  }
  if (categoryLower.includes('professional') || categoryLower.includes('services')) {
    return IRS_PUBLICATIONS.professional_services;
  }
  if (categoryLower.includes('advertising') || categoryLower.includes('marketing')) {
    return IRS_PUBLICATIONS.advertising;
  }
  if (categoryLower.includes('utilities') || categoryLower.includes('phone') || categoryLower.includes('internet')) {
    return IRS_PUBLICATIONS.utilities;
  }
  if (categoryLower.includes('insurance')) {
    return IRS_PUBLICATIONS.insurance;
  }
  if (categoryLower.includes('education') || categoryLower.includes('training')) {
    return IRS_PUBLICATIONS.education;
  }
  if (categoryLower.includes('bank') || categoryLower.includes('financial')) {
    return IRS_PUBLICATIONS.bank_fees;
  }
  
  // Default fallback
  return IRS_PUBLICATIONS.general_business;
}

function applyMinimalHeuristics(transaction: TransactionInput): OutputType | null {
  // Refunds (negative amount)
  if (transaction.amount_usd < 0 || (transaction.amount && transaction.amount < 0)) {
    return {
      status: 'ok',
      is_deductible: false,
      expense_type: 'personal', // Refunds are personal (reduce expenses but not deductible themselves)
      category: 'other',
      key_analysis_factor: 'Negative amount indicates a refund or credit transaction. Refunds are not deductible business expenses.',
      customized_reason: `This is a refund of $${Math.abs(transaction.amount_usd || transaction.amount || 0)} from ${transaction.merchant || transaction.merchant_name}. Refunds reduce your business expenses but are not themselves deductible.`,
      irs_refs: getIRSReferences('general_business', transaction.merchant || transaction.merchant_name || '', transaction.mcc),
      audit_risk: 'low',
      audit_risk_rationale: 'Refunds are straightforward and well-documented.',
      confidence: 0.95,
      reason_hash: generateReasonHash(transaction),
    };
  }

  // Likely internal transfers (merchant ~ transfer/zelle/venmo + no note)
  const merchant = (transaction.merchant || transaction.merchant_name || '').toLowerCase();
  const note = (transaction.note || transaction.notes || transaction.description || '').toLowerCase();
  
  if ((merchant.includes('transfer') || merchant.includes('zelle') || merchant.includes('venmo')) && !note) {
    return {
      status: 'needs_more_info',
      missing_fields: ['transfer_type'],
      questions: [
        'Is this a transfer between your own accounts or a payment to a contractor? If contractor, what service did they provide?'
      ],
      reason_hash: generateReasonHash(transaction),
    };
  }

  return null; // No heuristic match, proceed to model
}

// Helper function to generate reason hash
function generateReasonHash(transaction: TransactionInput): string {
  const crypto = require('crypto');
  const data = `${transaction.tx_id || transaction.merchant || ''}|${transaction.merchant || transaction.merchant_name || ''}|${transaction.amount_usd || transaction.amount || 0}|${transaction.date_iso || transaction.date || ''}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

export async function analyzeTransaction(
  transaction: TransactionInput,
  userContext?: UserContext
): Promise<{ success: true; result: OutputType } | { success: false; error: string }> {
  // Apply minimal heuristics first (cheap wins)
  const heuristicResult = applyMinimalHeuristics(transaction);
  if (heuristicResult) {
    return { success: true, result: heuristicResult };
  }

  const ctx = userContext || {};

  // Get learning context from user's correction history
  let learningContext = null;
  if (ctx.user_id) {
    try {
      learningContext = await aiLearningEngine.getLearningContext(ctx.user_id, transaction);
    } catch (error) {
      console.warn('⚠️ [AI Analysis] Could not get learning context:', error);
    }
  }

  // Extract time from datetime if available
  const extractedTime = extractTimeFromDatetime(transaction.datetime_iso || transaction.datetime);
  const timeToUse = transaction.time_24h || extractedTime;

  // Build enhanced prompt with profession hints
  const professionHints = getProfessionHints((ctx as UserContext).profession || []);
  
  const systemPrompt = `You are a meticulous U.S. small-business tax analyst. Your job is to classify a single bank/credit transaction for deductibility and produce a SPECIFIC, PROFILE-AWARE explanation tied to the user's profession, entity type, travel pattern, and state.

CRITICAL CLASSIFICATION REQUIREMENT:
- You MUST explicitly classify each transaction as either "business" or "personal" in the expense_type field
- "business" = expense is related to the user's business/profession and may be tax-deductible
- "personal" = expense is for personal use and is NOT tax-deductible
- Use ALL available context (merchant, location, time, user profile, transaction details) to make this determination
- If uncertain, err on the side of "personal" to be conservative
- The expense_type field should align with is_deductible (business = true, personal = false)

Strict rules:
- Be precise and user-specific. Always mention the user's profession and relevant profile attributes inside the reasoning_summary.
- Cite only IRS primary sources by publication name/number (e.g., IRS Pub 535, IRS Pub 463). Do not invent sections. If a section is unknown, set section=null.
- Refunds/credits are NOT deductible; they reduce prior expenses. Adjust guidance accordingly.
- If facts are insufficient, choose the safest determination and list exactly which docs would resolve uncertainty in documentation_required.
- Keep "audit_risk" as "low" | "medium" | "high" based on ambiguity and typical IRS scrutiny.
- DO NOT output chain-of-thought. Output only the final JSON fields described in the schema.
- No two transactions in the same batch should reuse an identical reasoning_summary. Vary phrasing while keeping facts constant.
- Never claim legal/tax advice; present as guidance based on IRS rules.

CRITICAL JSON FORMAT REQUIREMENTS:
- You MUST return ONLY valid JSON that matches the exact schema provided
- ALWAYS include the "status" field with value "ok" or "needs_more_info"
- Use EXACT category enum values (e.g., "meals_50" not "Meals and Entertainment")
- Do not include any text before or after the JSON
- Do not include markdown formatting or code blocks

ANALYSIS RULES:
- "No two reasons alike": write a customized_reason that is unique for this specific user and transaction.
- Key Analysis Factor (KAF) must be EXACTLY THREE DISTINCT sentences, ≤ 400 characters total, tailored to the user's profession(s).
- NEVER use generic reasoning like "Travel expenses for business purposes are generally deductible."
- ALWAYS explain WHY the expense is necessary for the user's specific profession(s).
- Use ALL available transaction context: time_24h, city/state, location (address, lat/lon), payment_channel, authorized_date, work_related_travel pattern, office_location, business_purpose, attendees, travel_destination, equipment_details, client_project, documentation_status, meeting_notes, mileage_details, personal_finance_category, pending status, currency codes, etc.
- Use ALL available user context: age, income, business_entity, work_related_travel frequency, documentation_habits, business_purpose, home_office_sqft, vehicle_business_use_percentage, audit_history, tax_professional, business_seasonality, multiple_locations, international_business, professional_licenses, prior_year_deductions, etc.
- Consider age and income for expense reasonableness (e.g., $50 meal for $30k income vs $100k income).
- Use business_entity to determine deduction rules (LLC vs Corporation vs Sole Proprietor).
- Use office_location to distinguish home office travel (deductible) vs regular office commuting (not deductible).
- LEARNING CONTEXT: If learning_context is provided, use it to inform your analysis:
  - If merchantPreference exists, consider the user's historical preference for this merchant
  - If categoryPreference exists, consider the user's historical preference for this category
  - If mccPreference exists, consider the user's historical preference for this MCC
  - If amountPreference exists, consider the user's historical preference for this amount range
  - Adjust confidence based on overallConfidence from learning context
  - Mention in reasoning if you're using learned preferences: "Based on your previous corrections for similar transactions..."
- Use work_related_travel frequency to assess if travel expense is consistent with user's pattern.
- Use documentation_habits to suggest appropriate documentation requirements.
- Use business_purpose and naics_code to understand the nature of the business for better categorization.
- Use home_office_sqft and vehicle_business_use_percentage for mixed-use calculations.
- Use audit_history and tax_professional to adjust risk tolerance and recommendation confidence.
- Use business_seasonality to understand if expenses align with business patterns.
- Use multiple_locations and international_business to consider travel and location-based deductions.
- Use professional_licenses to understand industry-specific deduction opportunities.
- Use prior_year_deductions to avoid recommending duplicate or conflicting deductions.
- Respect the 50% meals limitation.
- Distinguish commuting (non‑deductible) from business travel (deductible under rules).
- For mixed‑use items (phone/internet/vehicle/software), recommend a deductible_percent with a brief rationale.
- If critical info is missing, return status="needs_more_info" with up to 3 short questions.
- Use clean, user-friendly IRS references (e.g., "IRS Pub 463" not "IRS Publication 535, Section Section 162").`;

  const userPrompt = `TASK: Classify a single transaction for a freelancer/gig/1099 user. 

REQUIRED JSON OUTPUT FORMAT:
{
  "status": "ok",
  "is_deductible": true,
  "expense_type": "business",
  "category": "meals_50",
  "deductible_percent": 50,
  "key_analysis_factor": "First sentence explains profession-specific need. Second sentence considers timing context. Third sentence provides tax rule context.",
  "customized_reason": "Unique explanation for this specific user and transaction.",
  "reasoning_summary": "As a 28-year-old Virtual Assistant earning $45k annually in California, operating as an LLC with a home office and occasional work-related travel, this $12 Uber expense for client meetings is reasonable (0.03% of annual income) and deductible under IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses) for business travel from your home office, consistent with your occasional travel pattern",
  "audit_risk": "low",
  "audit_risk_rationale": "Brief explanation of audit risk level based on ambiguity and typical IRS scrutiny.",
  "confidence": 0.85,
  "irs_refs": ["IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses)", "IRS Pub 535 (Business Expenses)"],
  "documentation_required": ["Receipt showing business purpose", "Client meeting documentation"]
}

VALID CATEGORIES (use EXACTLY these values):
- advertising_marketing
- supplies_small_tools  
- software_subscriptions
- contract_labor
- equipment
- vehicle_expense
- travel
- meals_50 (for all meal/restaurant expenses)
- home_office
- utilities_phone_internet
- education_training
- dues_and_memberships
- bank_and_payment_fees
- rent
- other

CONTEXT (JSON):
{
  "profile": {
    "user_id": "${(ctx as UserContext).user_id || ''}",
    "age": ${(ctx as UserContext).age || 30},
    "profession": ${JSON.stringify((ctx as UserContext).profession || [])},
    "annual_gross_income_usd": ${(ctx as UserContext).annual_gross_income_usd || 50000},
    "filing_state": "${(ctx as UserContext).filing_state || (ctx as UserContext).state || ''}",
    "business_entity": "${(ctx as UserContext).business_entity || 'sole_proprietor'}",
    "office_location": "${(ctx as UserContext).office_location || 'Not specified'}",
    "work_related_travel": "${(ctx as UserContext).work_related_travel || 'none'}",
    
    "itemization_status": "${(ctx as UserContext).itemization_status || 'Not specified'}",
    "business_start_date": "${(ctx as UserContext).business_start_date || 'Not specified'}",
    "years_in_business": ${(ctx as UserContext).years_in_business !== undefined ? (ctx as UserContext).years_in_business : 'null'},
    "home_office_sqft": ${(ctx as UserContext).home_office_sqft || 0},
    "total_home_sqft": ${(ctx as UserContext).total_home_sqft || 0},
    "home_office_method": "${(ctx as UserContext).home_office_method || 'Not specified'}",
    "vehicle_business_use_percentage": ${(ctx as UserContext).vehicle_business_use_percentage || 0},
    "vehicle_deduction_method": "${(ctx as UserContext).vehicle_deduction_method || 'Not specified'}",
    
    "naics_code": "${(ctx as UserContext).naics_code || 'Not specified'}",
    "business_purpose": "${(ctx as UserContext).business_purpose || 'Not specified'}",
    "ein": "${(ctx as UserContext).ein || 'Not specified'}",
    "w2_income": ${(ctx as UserContext).w2_income || 0},
    "business_income": ${(ctx as UserContext).business_income || 0},
    "other_income": ${(ctx as UserContext).other_income || 0},
    "tax_bracket": ${(ctx as UserContext).tax_bracket || 0},
    "professional_licenses": ${JSON.stringify((ctx as UserContext).professional_licenses || [])},
    
    "prior_year_deductions": ${JSON.stringify((ctx as UserContext).prior_year_deductions || [])},
    "audit_history": "${(ctx as UserContext).audit_history || 'none'}",
    "tax_professional": ${(ctx as UserContext).tax_professional || false},
    "documentation_habits": "${(ctx as UserContext).documentation_habits || 'moderate'}",
    "business_seasonality": "${(ctx as UserContext).business_seasonality || 'year_round'}",
    "multiple_locations": ${(ctx as UserContext).multiple_locations || false},
    "international_business": ${(ctx as UserContext).international_business || false}
  },
  "learning_context": ${JSON.stringify(learningContext || {})},
  "tx": {
    "tx_id": "${transaction.tx_id || ''}",
    "merchant": "${transaction.merchant || transaction.merchant_name || ''}",
    "mcc": "${transaction.mcc || transaction.merchant_category_code || ''}",
    "amount_usd": ${transaction.amount_usd || transaction.amount || 0},
    "date_iso": "${transaction.date_iso || transaction.date || ''}",
    "time_24h": "${timeToUse || ''}",
    "city": "${transaction.location?.city || transaction.city || ''}",
    "state": "${transaction.location?.state || transaction.state || ''}",
    "channel": "${transaction.channel || ''}",
    "note": "${transaction.note || transaction.notes || transaction.description || ''}",
    "location": ${JSON.stringify(transaction.location || {})},
    "payment_channel": "${transaction.payment_channel || ''}",
    "authorized_date": "${transaction.authorized_date || ''}",
    "iso_currency_code": "${transaction.iso_currency_code || 'USD'}",
    "unofficial_currency_code": "${transaction.unofficial_currency_code || ''}",
    "personal_finance_category": ${JSON.stringify(transaction.personal_finance_category || {})},
    "pending": ${transaction.pending || false},
    "pending_transaction_id": "${transaction.pending_transaction_id || ''}",
    "account_owner": "${transaction.account_owner || ''}",
    "transaction_code": "${transaction.transaction_code || ''}",
    "business_purpose": "${transaction.business_purpose || ''}",
    "attendees": ${JSON.stringify(transaction.attendees || [])},
    "travel_destination": "${transaction.travel_destination || ''}",
    "equipment_details": ${JSON.stringify(transaction.equipment_details || {})},
    "client_project": "${transaction.client_project || ''}",
    "documentation_status": "${transaction.documentation_status || 'missing'}",
    "meeting_notes": "${transaction.meeting_notes || ''}",
    "mileage_details": ${JSON.stringify(transaction.mileage_details || {})}
  }
}

${professionHints}

CRITICAL RULES:
1. ALWAYS include "status": "ok" in your response
2. ALWAYS include "expense_type": "business" or "expense_type": "personal" to explicitly classify the transaction
   - "business" = expense is related to the user's business/profession (may be tax-deductible)
   - "personal" = expense is for personal use (NOT tax-deductible)
   - Use ALL available context (merchant, location, time, user profile, transaction details, personal_finance_category) to determine this
   - Consider merchant name, MCC code, location, time of day, user's profession, and transaction context
   - If uncertain, err on the side of "personal" to be conservative
   - expense_type should align with is_deductible (business = true, personal = false)
   - The expense_type field is REQUIRED and must be explicitly set for every transaction
3. Use EXACT category values from the list above (e.g., "meals_50" not "Meals and Entertainment")
4. For travel expenses: Explain WHY travel is necessary for the user's specific profession(s)
4. Use ALL transaction context: Consider time_24h, city/state, location (address, lat/lon), payment_channel, authorized_date, work_related_travel pattern, office_location
5. Distinguish commuting vs business travel: Commuting to regular workplace is NOT deductible
6. KAF must be THREE distinct sentences: (1) profession-specific need, (2) timing context, (3) tax rule context
7. ALWAYS mention the time_24h in your analysis if available - timing matters for tax deductions
8. For meals: Consider if it's during business hours, client meetings, or work-related travel
   - Example: "Purchased at 2:30 PM during business hours for client meeting"
   - Example: "Late night meal at 11:45 PM may indicate personal use"
   - Example: "Breakfast at 8:00 AM before client presentation is business-related"
9. CRITICAL: Use the EXACT date from date_iso field - do NOT change or interpret the date
   - If date_iso is "2025-09-12", use "September 12" not "September 13"
   - If date_iso is "2025-09-13", use "September 13" not "September 12"
   - Always match the exact date provided by Plaid
10. Use location data (address, lat/lon) for travel deduction analysis:
    - Location coordinates help verify business travel distance and purpose
    - Address helps identify if transaction is at business location vs personal location
    - Use location.city and location.state if available, otherwise fall back to city/state fields
11. Use payment_channel to understand transaction context:
    - "in_store" may indicate physical business purchases
    - "online" may indicate software subscriptions or remote services
    - Consider payment method when determining business purpose
12. Use authorized_date vs date_iso for timing analysis:
    - authorized_date is when transaction was authorized (may differ from posted date)
    - Use date_iso for tax year determination
    - Consider timing differences for expense timing rules
13. Use personal_finance_category for better categorization:
    - primary: High-level category (e.g., "GENERAL_MERCHANDISE")
    - detailed: Specific category (e.g., "GENERAL_MERCHANDISE_OFFICE_SUPPLIES")
    - confidence: How confident Plaid is in the categorization
14. Use pending status for transaction timing:
    - Pending transactions may not be finalized
    - Consider pending status when determining tax year
15. Use currency codes for international transactions:
    - iso_currency_code: Standard currency (e.g., "USD", "EUR")
    - unofficial_currency_code: Non-standard currency if applicable
    - International transactions may have different deduction rules
16. Consider user's age and income level for reasonableness of expenses
17. Use business_entity type to determine appropriate deduction rules (e.g., LLC vs Corporation)
18. Consider office_location for travel deductions (home office vs external office)
19. Use work_related_travel frequency to assess travel expense reasonableness
20. Customized_reason should be unique to this user's profession and transaction context
21. Use comprehensive IRS references based on expense type:
    - Travel/Transportation: "IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses)"
    - Meals/Entertainment: "IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses)"
    - Home Office: "IRS Pub 587 (Business Use of Your Home)"
    - Equipment/Depreciation: "IRS Pub 946 (How to Depreciate Property)"
    - Education/Training: "IRS Pub 970 (Tax Benefits for Education)"
    - Health Insurance: "IRS Pub 974 (Premium Tax Credit)"
    - Employee Benefits: "IRS Pub 15-B (Employer's Tax Guide to Fringe Benefits)"
    - Retirement Plans: "IRS Pub 560 (Retirement Plans for Small Business)"
    - Medical Expenses: "IRS Pub 502 (Medical and Dental Expenses)"
    - Casualty Losses: "IRS Pub 547 (Casualties, Disasters, and Thefts)"
    - General Business: "IRS Pub 535 (Business Expenses)", "IRS Pub 334 (Tax Guide for Small Business)"
    - NEVER use "Publication IRS Pub" or "Section Section" - these are typos
    - Always include the full publication name in parentheses
16. NEW REQUIREMENT: reasoning_summary must be SPECIFIC and PROFILE-AWARE
    - ALWAYS mention the user's profession in the reasoning_summary
    - ALWAYS mention relevant profile attributes (entity type, travel pattern, state)
    - ALWAYS consider income level for expense reasonableness
    - ALWAYS consider age for business context
    - ALWAYS consider state for tax implications
    - Be precise and user-specific, not generic
    - Example: "As a 28-year-old Virtual Assistant earning $45k annually in California, this $12 Uber expense for client meetings is reasonable and deductible under IRS Pub 463 (Travel, Entertainment, Gift, and Car Expenses) for business travel from your home office"
17. NEW REQUIREMENT: Cite only IRS primary sources by publication name/number
    - Use format: "IRS Pub 535", "IRS Pub 463", "IRS Pub 529"
    - Do not invent sections - if unknown, set section=null
    - Do not use "IRS Publication 535, Section 162" format
18. NEW REQUIREMENT: Refunds/credits are NOT deductible
    - They reduce prior expenses but are not themselves deductible
    - Adjust guidance accordingly for negative amounts
19. NEW REQUIREMENT: If facts are insufficient, choose safest determination
    - List exactly which docs would resolve uncertainty in documentation_required
    - Be conservative in your assessment
20. NEW REQUIREMENT: No two transactions should reuse identical reasoning_summary
    - Vary phrasing while keeping facts constant
    - Make each analysis unique to the specific transaction

EXAMPLES OF USING CONTEXT FOR REASONING_SUMMARY:

INCOME-BASED REASONING:
- Age 25, income $30k: "As a 25-year-old Virtual Assistant earning $30k annually, this $15 meal expense represents 0.05% of your annual income, which is reasonable for client meetings in your early career stage"
- Age 45, income $100k: "As an established 45-year-old Virtual Assistant earning $100k annually, this $25 meal expense is well within reasonable business expense limits for client relationship building"

ENTITY-BASED REASONING:
- LLC entity: "As a Virtual Assistant operating as an LLC in California, this business expense is deductible under IRS Pub 535 for business entities"
- Sole proprietor: "As a sole proprietor Virtual Assistant, this expense qualifies as a Schedule C business deduction under IRS Pub 535"
- Corporation: "As a Virtual Assistant operating as a corporation, this expense may require corporate expense policy compliance and proper documentation"

LOCATION-BASED REASONING:
- Home office: "As a Virtual Assistant with a home office in California, this Uber expense from your home to client location is deductible business travel under IRS Pub 463"
- External office: "As a Virtual Assistant with an external office in California, this Uber expense appears to be commuting to your regular workplace, which is NOT deductible under IRS Pub 463"
- No office specified: "As a Virtual Assistant in California, verify this Uber expense is for business travel rather than personal commuting"

TRAVEL PATTERN REASONING:
- Frequent travel: "As a Virtual Assistant with frequent work-related travel, this expense is consistent with your established travel pattern and deductible under IRS Pub 463"
- Occasional travel: "As a Virtual Assistant with occasional work-related travel, verify the business purpose of this expense as it's outside your typical travel pattern"
- No travel: "As a Virtual Assistant with no work-related travel pattern, this travel expense requires clear business purpose documentation"

STATE-SPECIFIC REASONING:
- California: "In California, this business expense is deductible under federal tax law and may also qualify for state business deductions"
- Texas: "In Texas, this business expense is deductible under federal tax law with no state income tax implications"
- New York: "In New York, this business expense is deductible under federal tax law and may qualify for state business deductions"

COMPREHENSIVE EXAMPLE:
"As a 32-year-old Virtual Assistant earning $65k annually in California, operating as an LLC with a home office and occasional work-related travel, this $18 Uber expense for client meetings is reasonable (0.03% of annual income) and deductible under IRS Pub 463 for business travel from your home office, consistent with your occasional travel pattern"

MANDATORY PROFILE DATA USAGE:
Your reasoning_summary MUST include:
1. PROFESSION: Always mention the user's specific profession(s)
2. AGE: Reference the user's age for business context and career stage
3. INCOME: Calculate expense as percentage of annual income for reasonableness
4. STATE: Mention the state for tax law context
5. ENTITY TYPE: Reference business entity (sole proprietor, LLC, corporation, etc.)
6. OFFICE LOCATION: Use office location to determine travel deductibility
7. TRAVEL PATTERN: Reference work-related travel frequency for consistency
8. TRANSACTION CONTEXT: Include transaction amount, date, time, and location

FORMULA FOR REASONING_SUMMARY:
"As a [AGE]-year-old [PROFESSION] earning $[INCOME]k annually in [STATE], operating as [ENTITY_TYPE] with [OFFICE_LOCATION] and [TRAVEL_PATTERN] work-related travel, this $[AMOUNT] [TRANSACTION_TYPE] is [REASONABLENESS_ASSESSMENT] and [DEDUCTIBILITY_STATUS] under [IRS_REFERENCE] for [SPECIFIC_BUSINESS_PURPOSE], [CONSISTENCY_WITH_PATTERN]"

EXPENSE_TYPE CLASSIFICATION GUIDELINES:
- Classify as "business" if:
  * Expense is necessary for the user's profession/business operations
  * Expense is ordinary and necessary for the business
  * Expense is directly related to generating business income
  * Examples: software subscriptions for work, travel to client meetings, business meals, office supplies, professional services
- Classify as "personal" if:
  * Expense is for personal use or enjoyment
  * Expense is not related to business operations
  * Expense is a personal lifestyle choice
  * Examples: personal groceries, personal entertainment, personal clothing, personal travel for vacation
- When uncertain, consider:
  * User's profession and typical business needs
  * Transaction context (time, location, merchant type)
  * User's business entity and work patterns
  * If still uncertain, err on the side of "personal" to be conservative

DATE USAGE EXAMPLES:
- If date_iso is "2025-09-12": "The transaction at Starbucks on September 12 indicates..."
- If date_iso is "2025-09-13": "The transaction at Starbucks on September 13 indicates..."
- NEVER change the date - use exactly what Plaid provides

If information is insufficient, return:
{
  "status": "needs_more_info",
  "questions": ["Question 1", "Question 2", "Question 3"]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 1000,
      seed: 42, // For determinism
    });

    const responseText = completion.choices?.[0]?.message?.content;
    if (!responseText) return { success: false, error: 'No response from OpenAI' };

    console.log('🤖 [AI Analysis] Raw model response:', responseText);

    const jsonMatch = typeof responseText === 'string' ? responseText.match(/\{[\s\S]*\}/) : null;
    const raw = jsonMatch ? jsonMatch[0] : responseText;
    
    console.log('🤖 [AI Analysis] Extracted JSON:', raw);

    let parsed: any;
    try {
      parsed = typeof raw === 'object' ? raw : JSON.parse(String(raw));
    } catch (e) {
      return { success: false, error: 'Invalid JSON from model' };
    }

    // Post-process: clamp % to [0,100], trim KAF to 400 chars, compute reason_hash
    if (parsed.deductible_percent !== undefined) {
      parsed.deductible_percent = Math.max(0, Math.min(100, parsed.deductible_percent));
    }
    if (parsed.key_analysis_factor) {
      parsed.key_analysis_factor = parsed.key_analysis_factor.substring(0, 400);
    }
    if (!parsed.reason_hash) {
      parsed.reason_hash = generateReasonHash(transaction);
    }
    
    // Ensure expense_type is always set (infer from is_deductible if not provided by AI)
    if (!parsed.expense_type && parsed.is_deductible !== undefined) {
      parsed.expense_type = parsed.is_deductible ? 'business' : 'personal';
    } else if (!parsed.expense_type) {
      // Default to personal if neither is set (conservative approach)
      parsed.expense_type = 'personal';
      parsed.is_deductible = false;
    }

    try {
      const validated = OutputSchema.parse(parsed);
      return { success: true, result: validated };
    } catch (err) {
      console.error('Validation error:', err);
      console.error('Raw model response:', responseText);
      console.error('Parsed JSON:', parsed);
      
      // Try to fix common issues
      const fixedParsed = { ...parsed };
      
      // Fix missing status
      if (!fixedParsed.status) {
        fixedParsed.status = 'ok';
      }
      
      // Ensure expense_type is set (infer from is_deductible if needed)
      if (!fixedParsed.expense_type && fixedParsed.is_deductible !== undefined) {
        fixedParsed.expense_type = fixedParsed.is_deductible ? 'business' : 'personal';
      } else if (!fixedParsed.expense_type) {
        fixedParsed.expense_type = 'personal';
        fixedParsed.is_deductible = false;
      }
      
      // Fix invalid category values
      if (fixedParsed.category) {
        const categoryMap: Record<string, string> = {
          'Meals and Entertainment': 'meals_50',
          'Meals & Entertainment': 'meals_50',
          'Food and Beverage': 'meals_50',
          'Restaurant': 'meals_50',
          'Dining': 'meals_50',
          'Meals': 'meals_50',
          'Entertainment': 'meals_50',
          'Business Meals': 'meals_50',
          'Client Meals': 'meals_50',
          'Travel and Entertainment': 'travel',
          'Business Travel': 'travel',
          'Transportation': 'vehicle_expense',
          'Gas': 'vehicle_expense',
          'Fuel': 'vehicle_expense',
          'Office Supplies': 'supplies_small_tools',
          'Software': 'software_subscriptions',
          'Subscription': 'software_subscriptions',
          'Equipment': 'equipment',
          'Tools': 'supplies_small_tools',
          'Marketing': 'advertising_marketing',
          'Advertising': 'advertising_marketing',
          'Professional Services': 'contract_labor',
          'Contractor': 'contract_labor',
          'Consulting': 'contract_labor',
          'Education': 'education_training',
          'Training': 'education_training',
          'Membership': 'dues_and_memberships',
          'Dues': 'dues_and_memberships',
          'Rent': 'rent',
          'Office Rent': 'rent',
          'Home Office': 'home_office',
          'Utilities': 'utilities_phone_internet',
          'Phone': 'utilities_phone_internet',
          'Internet': 'utilities_phone_internet',
          'Bank Fees': 'bank_and_payment_fees',
          'Payment Processing': 'bank_and_payment_fees'
        };
        
        if (categoryMap[fixedParsed.category]) {
          fixedParsed.category = categoryMap[fixedParsed.category];
        } else if (!['advertising_marketing', 'supplies_small_tools', 'software_subscriptions', 'contract_labor', 'equipment', 'vehicle_expense', 'travel', 'meals_50', 'home_office', 'utilities_phone_internet', 'education_training', 'dues_and_memberships', 'bank_and_payment_fees', 'rent', 'other'].includes(fixedParsed.category)) {
          fixedParsed.category = 'other';
        }
      }
      
      // Try validation again with fixes
      try {
        const validatedFixed = OutputSchema.parse(fixedParsed);
        console.log('✅ Fixed validation issues and retried successfully');
        return { success: true, result: validatedFixed };
      } catch (fixErr) {
        console.error('Still failed after fixes:', fixErr);
        return { success: false, error: 'Model returned JSON that failed validation even after fixes' };
      }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function analyzeTransactionWithRetry(
  transaction: TransactionInput,
  userContext?: UserContext,
  maxRetries: number = 2
): Promise<{ success: true; result: OutputType } | { success: false; error: string }> {
  let lastError = '';
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await analyzeTransaction(transaction, userContext);
    if (res.success) return res;
    lastError = (res as any).error || 'Unknown';
    if (attempt < maxRetries) {
      console.log(`Retry attempt ${attempt + 1} after error: ${lastError}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt)); // Exponential backoff
    }
  }
  return { success: false, error: `Failed after ${maxRetries} attempts. Last error: ${lastError}` };
}