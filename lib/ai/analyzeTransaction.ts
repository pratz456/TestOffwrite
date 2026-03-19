import OpenAI from 'openai';
import { z } from 'zod';
import { aiLearningEngine } from './learning-engine';

function getOpenAIOrThrow() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI is not configured (missing OPENAI_API_KEY)');
  }
  return new OpenAI({ apiKey });
}

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
  
  account_usage_type?: 'business' | 'personal' | 'mixed' | 'unknown';
  counterparties?: any[];
  merchant_entity_id?: string;
  is_recurring?: boolean;

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

// ── Known merchant sets for pre-classification heuristics ───────────────
const KNOWN_BUSINESS_MERCHANTS = new Set([
  'aws', 'amazon web services', 'google cloud', 'google workspace', 'microsoft azure',
  'microsoft 365', 'adobe', 'canva', 'figma', 'notion', 'slack', 'zoom',
  'quickbooks', 'freshbooks', 'gusto', 'stripe', 'square',
  'mailchimp', 'hubspot', 'squarespace', 'shopify', 'wix',
  'godaddy', 'namecheap', 'cloudflare', 'vercel', 'netlify', 'heroku',
  'github', 'gitlab', 'bitbucket', 'atlassian', 'jira',
  'dropbox business', 'google ads', 'meta ads', 'facebook ads',
  'linkedin premium', 'semrush', 'ahrefs', 'hootsuite',
  'staples', 'office depot', 'vistaprint',
  'usps', 'ups store', 'fedex office',
]);

const KNOWN_PERSONAL_MERCHANTS = new Set([
  'netflix', 'hulu', 'disney+', 'disney plus', 'hbo max', 'paramount+',
  'spotify', 'apple music', 'pandora', 'tidal',
  'planet fitness', 'la fitness', 'equinox', '24 hour fitness', 'anytime fitness',
  'whole foods', 'trader joes', 'kroger', 'safeway', 'publix', 'aldi',
  'walmart', 'target', 'costco', 'sams club',
  'starbucks', 'dunkin', 'mcdonalds', 'chick-fil-a', 'chipotle',
  'amazon prime', 'amazon.com',
]);

// Gig platforms whose negative amounts are 1099 income, not expenses
const GIG_INCOME_PLATFORMS = new Set([
  'uber', 'lyft', 'doordash', 'grubhub', 'instacart', 'shipt',
  'fiverr', 'upwork', 'toptal', 'etsy', 'ebay',
  'airbnb', 'turo', 'rover', 'taskrabbit', 'thumbtack',
  'postmates', 'gopuff', 'spark driver', 'amazon flex',
]);

// Professions where "personal" merchants can be business-deductible
const PROFESSION_AMBIGUOUS_MERCHANTS: Record<string, Set<string>> = {
  'content_creator': new Set(['netflix', 'hulu', 'disney+', 'disney plus', 'hbo max', 'paramount+', 'spotify', 'amazon prime', 'amazon.com']),
  'youtuber': new Set(['netflix', 'hulu', 'disney+', 'disney plus', 'hbo max', 'paramount+', 'spotify', 'amazon.com']),
  'streamer': new Set(['netflix', 'hulu', 'disney+', 'disney plus', 'hbo max', 'paramount+', 'spotify', 'amazon.com']),
  'photographer': new Set(['amazon.com', 'target']),
  'food_blogger': new Set(['starbucks', 'dunkin', 'mcdonalds', 'chick-fil-a', 'chipotle', 'whole foods', 'trader joes']),
  'personal_trainer': new Set(['planet fitness', 'la fitness', 'equinox', '24 hour fitness', 'anytime fitness']),
  'fitness_trainer': new Set(['planet fitness', 'la fitness', 'equinox', '24 hour fitness', 'anytime fitness']),
};

// Profession-aware hint map for better categorization
const PROFESSION_HINTS: Record<string, string> = {
  // ── Gig workers ──
  'rideshare': 'vehicle_expense (mileage, gas, maintenance, insurance), phone/data plan, car washes, tolls, parking; track active vs deadhead miles; meals on shift 50%',
  'delivery': 'vehicle_expense (mileage, gas, maintenance), phone/data, insulated bags, parking; active delivery miles only; meals on shift 50%',
  'uber_driver': 'vehicle_expense (mileage, gas, maintenance, insurance), phone/data plan, car washes, tolls, parking; track active vs deadhead miles; meals on shift 50%',
  'lyft_driver': 'vehicle_expense (mileage, gas, maintenance, insurance), phone/data, car washes, tolls; passenger miles + repositioning',
  'doordash_driver': 'vehicle_expense (mileage, gas, maintenance), phone/data, insulated bags/hot bags, parking; active delivery miles only',
  'instacart_shopper': 'vehicle_expense (mileage, gas), phone/data, insulated bags; shopping time miles count',
  'taskrabbit': 'tools/equipment, vehicle_expense, phone/data, supplies, insurance; varies by task type',

  // ── Creators ──
  'content_creator': 'software_subscriptions (editing, analytics), equipment (camera, mic, lighting), supplies_small_tools, travel (client shoots, conferences); meals 50%; home_office (studio)',
  'youtuber': 'equipment (camera, lighting, audio, PC), software (editing, thumbnail), internet (high-speed upload), home_office (studio), travel (content trips), meals 50%',
  'streamer': 'equipment (PC, peripherals, camera, capture card), software (streaming tools, overlays), internet (high-speed), home_office, subscriptions (platform tools)',
  'photographer': 'software_subscriptions (Lightroom, Photoshop), equipment (camera, lenses, lighting), supplies_small_tools, travel (client shoots, workshops); meals 50%; home_office if applicable',
  'food_blogger': 'meals 50% (recipe testing, restaurant reviews), equipment (camera), software (editing), kitchen supplies, travel (food events)',

  // ── Freelancers ──
  'freelance_writer': 'software_subscriptions (writing tools, Grammarly, research databases), home_office, education (courses, books), internet, professional memberships',
  'freelance_developer': 'software_subscriptions (IDE, hosting), cloud hosting (AWS/GCP/Azure), equipment (computer, monitors), home_office, internet, education/certifications',
  'graphic_designer': 'software (Adobe, Figma, Sketch), equipment (tablet, display, calibrator), fonts/stock images, education, home_office, client travel',
  'designer': 'software_subscriptions (Adobe, Figma), utilities_phone_internet share, home_office, education_training (skill maintenance), travel (client meetings)',
  'web_developer': 'software_subscriptions, cloud hosting, domain registrations, equipment (computer), home_office, internet, education/certifications',

  // ── Consultants / professionals ──
  'consultant': 'travel (client sites, conferences), home_office, software (project mgmt, CRM), professional development, meals (client entertainment) 50%, dues/memberships',
  'business_coach': 'travel (client meetings, conferences, speaking engagements), software_subscriptions, home_office, education_training; meals 50%',
  'software_consultant': 'software_subscriptions, utilities_phone_internet share, home_office, education_training (skill maintenance), travel (client sites)',
  'real_estate_agent': 'vehicle_expense (showing properties, client drives), advertising (signs, listings), MLS fees, lockboxes, staging supplies, client entertainment 50%, continuing education, phone',
  'insurance_agent': 'vehicle_expense, phone, advertising, licensing fees, continuing education, client meals 50%, office supplies',

  // ── Small business / trades ──
  'handyman': 'equipment & supplies (tools, parts), local travel mileage, specialized apparel/gear (not everyday clothing), vehicle_expense',
  'cleaner': 'supplies (cleaning products, chemicals), equipment (vacuum, mop, steamer), vehicle_expense (travel to clients), insurance, advertising',
  'personal_trainer': 'equipment (bands, weights), certifications/continuing education, liability insurance, gym membership (if required for work), travel to clients, specialized clothing',
  'fitness_trainer': 'equipment (bands, weights), certifications/continuing education, liability insurance, gym membership (if required), travel to clients, specialized clothing',
  'tutor': 'supplies (books, materials), software (video conferencing, whiteboard), home_office, travel (student homes, libraries)',
  'musician': 'equipment (instruments, cables, accessories), supplies (strings, reeds), local travel mileage, travel (gigs, rehearsals), studio rent, recording costs',
  'dog_walker': 'vehicle_expense (travel to clients), supplies (leashes, treats, poop bags), insurance, pet first aid certification, phone',
  'landscaper': 'equipment (mower, trimmer, blower), supplies (fertilizer, seeds), vehicle_expense (truck, trailer), fuel, insurance',
  'electrician': 'tools/equipment, supplies (wire, fixtures), vehicle_expense, licensing fees, insurance, continuing education',
  'plumber': 'tools/equipment, supplies (pipe, fittings), vehicle_expense, licensing fees, insurance, continuing education',

  // ── W2 + side income ──
  'w2_side_hustle': 'ONLY side-business expenses deductible on Schedule C; W2 job commuting/meals NOT deductible; separate business from employment expenses strictly',
  'side_hustle': 'ONLY side-business expenses deductible on Schedule C; W2 employer-related expenses NOT deductible; keep clear business/personal boundary',

  // ── Etsy / e-commerce ──
  'etsy_seller': 'supplies (materials, packaging, labels), shipping, equipment (tools, machines, printer), software (shop management), advertising (Etsy ads), home_office',
  'ebay_seller': 'supplies (packaging, labels), shipping, inventory costs, software (listing tools), advertising, home_office, mileage (sourcing trips)',
  'shopify_seller': 'software (Shopify plan, apps), advertising (Google/Meta ads), supplies (packaging), shipping, inventory, home_office',
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
  
  // Schedule C / 1099 / Self-Employment Essentials
  'estimated_taxes': ['IRS Pub 505 (Tax Withholding and Estimated Tax)', 'IRS Pub 535 (Business Expenses)'],
  'self_employment_tax': ['IRS Pub 334 (Tax Guide for Small Business)', 'IRS Pub 535 (Business Expenses)'],
  'recordkeeping': ['IRS Pub 583 (Starting a Business and Keeping Records)', 'IRS Pub 535 (Business Expenses)'],
  'worker_classification': ['IRS Pub 1779 (Independent Contractor or Employee?)', 'IRS Pub 15-A (Employer\'s Supplemental Tax Guide)'],
  'accounting_methods': ['IRS Pub 538 (Accounting Periods and Methods)', 'IRS Pub 535 (Business Expenses)'],
  'asset_basis': ['IRS Pub 551 (Basis of Assets)', 'IRS Pub 946 (How to Depreciate Property)'],
  'asset_sales': ['IRS Pub 544 (Sales and Other Dispositions of Assets)', 'IRS Pub 551 (Basis of Assets)'],
  'canceled_debt': ['IRS Pub 4681 (Canceled Debts, Foreclosures, Repossessions, and Abandonments)', 'IRS Pub 17 (Your Federal Income Tax)'],
  'partnerships': ['IRS Pub 541 (Partnerships)', 'IRS Pub 535 (Business Expenses)'],
  'corporations': ['IRS Pub 542 (Corporations)', 'IRS Pub 535 (Business Expenses)'],
  'cryptocurrency': ['IRS Pub 544 (Sales and Other Dispositions of Assets)', 'IRS Notice 2014-21 (Virtual Currency Guidance)'],
  'contract_labor': ['IRS Pub 1779 (Independent Contractor or Employee?)', 'IRS Pub 535 (Business Expenses)'],
  'cost_of_goods_sold': ['IRS Pub 334 (Tax Guide for Small Business)', 'IRS Pub 535 (Business Expenses)'],
  'net_operating_loss': ['IRS Pub 536 (Net Operating Losses)', 'IRS Pub 535 (Business Expenses)'],

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

function formatDisplayName(transaction: TransactionInput): string {
  return transaction.merchant || transaction.merchant_name || 'this merchant';
}

function formatAmount(amount: number): string {
  return `$${Math.abs(amount).toFixed(2)}`;
}

function professionLabel(professions: string[]): string {
  if (!professions.length) return 'your business';
  return professions
    .map(p => p.replace(/_/g, ' '))
    .join(' / ');
}

function businessMerchantCategory(merchant: string): { category: OutputType['category']; schedCLine: string; label: string } {
  const m = merchant.toLowerCase();
  if (['aws', 'amazon web services', 'google cloud', 'microsoft azure', 'heroku', 'vercel', 'netlify', 'cloudflare'].some(k => m.includes(k)))
    return { category: 'software_subscriptions', schedCLine: '18', label: 'cloud/hosting service' };
  if (['adobe', 'canva', 'figma', 'notion', 'slack', 'zoom', 'microsoft 365', 'google workspace', 'github', 'gitlab', 'bitbucket', 'atlassian', 'jira', 'dropbox business'].some(k => m.includes(k)))
    return { category: 'software_subscriptions', schedCLine: '18', label: 'software subscription' };
  if (['quickbooks', 'freshbooks', 'gusto'].some(k => m.includes(k)))
    return { category: 'software_subscriptions', schedCLine: '17', label: 'accounting/payroll service' };
  if (['stripe', 'square'].some(k => m.includes(k)))
    return { category: 'bank_and_payment_fees', schedCLine: '10', label: 'payment processing' };
  if (['google ads', 'meta ads', 'facebook ads', 'linkedin premium', 'semrush', 'ahrefs', 'hootsuite', 'mailchimp', 'hubspot'].some(k => m.includes(k)))
    return { category: 'advertising_marketing', schedCLine: '8', label: 'marketing/advertising tool' };
  if (['squarespace', 'shopify', 'wix', 'godaddy', 'namecheap'].some(k => m.includes(k)))
    return { category: 'software_subscriptions', schedCLine: '18', label: 'website/e-commerce platform' };
  if (['staples', 'office depot', 'vistaprint'].some(k => m.includes(k)))
    return { category: 'supplies_small_tools', schedCLine: '22', label: 'office supplies' };
  if (['usps', 'ups store', 'fedex office'].some(k => m.includes(k)))
    return { category: 'supplies_small_tools', schedCLine: '22', label: 'shipping/postage' };
  return { category: 'software_subscriptions', schedCLine: '18', label: 'business service' };
}

function applyMinimalHeuristics(transaction: TransactionInput, userContext?: UserContext): OutputType | null {
  const merchant = (transaction.merchant || transaction.merchant_name || '').toLowerCase().trim();
  const note = (transaction.note || transaction.notes || transaction.description || '').toLowerCase();
  const category = transaction.personal_finance_category?.detailed || transaction.category || '';
  const amount = transaction.amount_usd || transaction.amount || 0;
  const professions = (userContext as UserContext)?.profession || [];
  const professionsLower = professions.map(p => p.toLowerCase());
  const displayName = formatDisplayName(transaction);
  const profLabel = professionLabel(professions);

  const { CATEGORY_MAP } = require('@/lib/schedule-c/aggregate');

  // ── 1. Refunds / credits (negative amount) ──────────────────────────
  if (amount < 0) {
    const isLikelyBusinessRefund =
      CATEGORY_MAP[category] != null ||
      KNOWN_BUSINESS_MERCHANTS.has(merchant) ||
      [...KNOWN_BUSINESS_MERCHANTS].some(bm => merchant.includes(bm));

    if (isLikelyBusinessRefund) {
      return null; // Let GPT analyze — business refund reduces expenses
    }

    if ([...GIG_INCOME_PLATFORMS].some(gp => merchant.includes(gp))) {
      return {
        status: 'ok',
        is_deductible: false,
        expense_type: 'personal',
        category: 'other',
        key_analysis_factor: `This ${formatAmount(amount)} deposit from ${displayName} is gig platform income, not an expense. It should be reported as income (1099-K or 1099-NEC) on your return, not claimed as a deduction.`,
        customized_reason: `${formatAmount(amount)} from ${displayName} is a gig platform payout - this is taxable income, not a business expense. Report it on Schedule C as gross receipts (Line 1). You should receive a 1099-K or 1099-NEC for this.`,
        irs_refs: getIRSReferences('general_business', merchant, transaction.mcc),
        audit_risk: 'low',
        confidence: 0.95,
        reason_hash: generateReasonHash(transaction),
      };
    }

    return {
      status: 'ok',
      is_deductible: false,
      expense_type: 'personal',
      category: 'other',
      key_analysis_factor: `This ${formatAmount(amount)} refund from ${displayName} is a personal credit. It does not affect your business deductions.`,
      customized_reason: `${formatAmount(amount)} refund from ${displayName} - this is a personal refund and not a business deduction. No action needed on your taxes.`,
      irs_refs: getIRSReferences('general_business', merchant, transaction.mcc),
      audit_risk: 'low',
      confidence: 0.90,
      reason_hash: generateReasonHash(transaction),
    };
  }

  // ── 2. Internal transfers ────────────────────────────────────────────
  const transferPatterns = ['transfer', 'zelle', 'venmo', 'paypal', 'cash app', 'cashapp'];
  if (transferPatterns.some(p => merchant.includes(p)) && !note) {
    return {
      status: 'needs_more_info',
      missing_fields: ['transfer_type'],
      questions: [
        `Was this ${formatAmount(amount)} ${displayName} payment to a contractor or freelancer for ${profLabel} work? If so, add a note with their name and the service provided.`
      ],
      reason_hash: generateReasonHash(transaction),
    };
  }

  // ── 3. Known personal merchants (skip GPT) ───────────────────────────
  if (KNOWN_PERSONAL_MERCHANTS.has(merchant) || [...KNOWN_PERSONAL_MERCHANTS].some(pm => merchant.includes(pm))) {
    const isAmbiguousForProfession = professionsLower.some(prof => {
      const ambiguousSet = PROFESSION_AMBIGUOUS_MERCHANTS[prof];
      return ambiguousSet && ([...ambiguousSet].some(am => merchant.includes(am)));
    });

    if (isAmbiguousForProfession) {
      return null; // Let GPT decide — ambiguous for this profession
    }

    const matchedMerchant = [...KNOWN_PERSONAL_MERCHANTS].find(pm => merchant.includes(pm)) || merchant;
    const isStreaming = ['netflix', 'hulu', 'disney', 'hbo', 'paramount', 'spotify', 'apple music', 'pandora', 'tidal'].some(s => merchant.includes(s));
    const isGym = ['fitness', 'equinox', 'gym'].some(s => merchant.includes(s));
    const isGrocery = ['whole foods', 'trader joes', 'kroger', 'safeway', 'publix', 'aldi', 'walmart', 'target', 'costco', 'sams club'].some(s => merchant.includes(s));
    const isFastFood = ['starbucks', 'dunkin', 'mcdonalds', 'chick-fil-a', 'chipotle'].some(s => merchant.includes(s));

    let reason: string;
    if (isStreaming) {
      reason = `${formatAmount(amount)} at ${displayName} is a personal entertainment subscription - not deductible for ${profLabel}. If you use this specifically for business research or content creation, mark it as business and note the business purpose.`;
    } else if (isGym) {
      reason = `${formatAmount(amount)} at ${displayName} is a personal fitness expense. Gym memberships are generally not deductible unless required by your employer or directly tied to your business (e.g., personal training certification).`;
    } else if (isGrocery) {
      reason = `${formatAmount(amount)} at ${displayName} is a personal grocery/retail purchase. Groceries are not business-deductible. If this was supplies for ${profLabel}, mark it as business and note what you purchased.`;
    } else if (isFastFood) {
      reason = `${formatAmount(amount)} at ${displayName} looks like a personal meal. To deduct meals, you need a business purpose - like meeting a client or traveling for work. If this was a business meal, mark it as business, note who you met with, and save the receipt.`;
    } else {
      reason = `${formatAmount(amount)} at ${displayName} is a personal expense and not deductible on Schedule C. If you believe this is business-related for ${profLabel}, mark it as business and add a note explaining the connection.`;
    }

    return {
      status: 'ok',
      is_deductible: false,
      expense_type: 'personal',
      category: 'other',
      key_analysis_factor: reason,
      customized_reason: reason,
      irs_refs: ['IRS Pub 535 (Business Expenses)'],
      audit_risk: 'low',
      confidence: 0.90,
      reason_hash: generateReasonHash(transaction),
    };
  }

  // ── 4. Known business merchants (skip GPT) ───────────────────────────
  if (KNOWN_BUSINESS_MERCHANTS.has(merchant) || [...KNOWN_BUSINESS_MERCHANTS].some(bm => merchant.includes(bm))) {
    const { category: bizCategory, schedCLine, label } = businessMerchantCategory(merchant);

    const reason = `${formatAmount(amount)} at ${displayName} - this is a ${label} commonly used by ${profLabel}. Deductible on Schedule C Line ${schedCLine}. Save your receipt or invoice.`;

    return {
      status: 'ok',
      is_deductible: true,
      expense_type: 'business',
      category: bizCategory,
      key_analysis_factor: reason,
      customized_reason: reason,
      irs_refs: ['IRS Pub 535 (Business Expenses)'],
      audit_risk: 'low',
      confidence: 0.85,
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
  const ctx = userContext || {};

  // Apply minimal heuristics first (cheap wins — skips GPT for obvious cases)
  const heuristicResult = applyMinimalHeuristics(transaction, userContext);
  if (heuristicResult) {
    return { success: true, result: heuristicResult };
  }

  // Get learning context from user's correction history
  let learningContext = null;
  if ((ctx as UserContext).user_id) {
    try {
      learningContext = await aiLearningEngine.getLearningContext((ctx as UserContext).user_id, transaction);
    } catch (error) {
      console.warn('⚠️ [AI Analysis] Could not get learning context:', error);
    }
  }

  // Extract time from datetime if available
  const extractedTime = extractTimeFromDatetime(transaction.datetime_iso || transaction.datetime);
  const timeToUse = transaction.time_24h || extractedTime;

  // Build enhanced prompt with profession hints
  const professionHints = getProfessionHints((ctx as UserContext).profession || []);
  
  const systemPrompt = `You are a U.S. small-business tax analyst. The user is self-employed. Your output is shown directly to them - write in plain, specific English and always tell them what to do next.

OUTPUT: Return ONLY valid JSON (no markdown, no text outside the JSON). Required fields:
- status: "ok" or "needs_more_info"
- is_deductible: boolean
- expense_type: "business" or "personal" (must align with is_deductible; default to "personal" if uncertain)
- category: one of: advertising_marketing, supplies_small_tools, software_subscriptions, contract_labor, equipment, vehicle_expense, travel, meals_50, home_office, utilities_phone_internet, education_training, dues_and_memberships, bank_and_payment_fees, rent, other
- customized_reason: 2-3 plain-English sentences the user will read. Sentence 1: whether this is deductible and why, specific to their profession. Sentence 2: what they should do (save receipt, note attendees, track mileage, etc.). Never use filler like "commonly deductible for businesses."
- key_analysis_factor: one-sentence summary for the UI card (<=400 chars)
- reasoning_summary: brief note mentioning their profession and relevant context. No rigid formula - write naturally.
- confidence: 0-1
- audit_risk: "low", "medium", or "high"
- irs_refs: array of up to 3 IRS publications (e.g. "IRS Pub 535", "IRS Pub 463")

Optional fields: deductible_percent (for mixed-use or meals), documentation_required (array), questions (if needs_more_info).

KEY RULES:
- Meals: 50% deductible. Set deductible_percent: 50 and category: "meals_50". Must have a business purpose (client meeting, work travel). Tell user to note who they met with.
- Commuting to a regular workplace: NOT deductible. Travel from home office to client: deductible.
- Mixed-use (phone, internet, vehicle): suggest a deductible_percent and explain the split.
- If learning_context has merchantPreference, factor it in: "Based on your previous corrections..."
- Use exact date from date_iso. Reference time_24h if available (timing distinguishes business vs personal meals).
- Cite IRS pubs by name only (e.g. "IRS Pub 463"). Do not invent section numbers.
- Refunds/credits (negative amounts): not deductible; they reduce prior expenses.
- If info is insufficient: status="needs_more_info" with up to 3 specific questions.
- account_usage_type: if "personal", this account is personal-only - expenses are likely personal unless user overrides. If "business", assume business-related. If "mixed", evaluate each tx individually. If "unknown", no signal.
- is_recurring: if true, this is a recurring subscription/payment detected by Plaid. Recurring business subscriptions (software, SaaS, professional memberships) are typically fully deductible. Recurring personal subscriptions (streaming, gym) are not.
- NEVER use generic phrases like "Travel expenses are generally deductible" or "commonly deductible for freelancer businesses". Be specific to this person and this transaction.`;

  // Build user income type context for the prompt
  const professionsLower = ((ctx as UserContext).profession || []).map(p => p.toLowerCase());
  const w2Income = (ctx as UserContext).w2_income || (ctx as UserContext).income_breakdown?.w2_income || 0;
  const bizIncome = (ctx as UserContext).business_income || (ctx as UserContext).income_breakdown?.business_income || 0;
  let incomeTypeContext = '';
  if (w2Income > 0 && bizIncome > 0) {
    incomeTypeContext = `\nUSER INCOME TYPE: W2 + Side Business. This user has BOTH W2 employment income ($${w2Income.toLocaleString()}) AND business income ($${bizIncome.toLocaleString()}). ONLY classify expenses related to their SIDE BUSINESS as deductible on Schedule C. W2 job-related expenses (commuting to employer, office clothes for W2 job, desk lunch at W2 office) are NOT Schedule C deductible.`;
  } else if (professionsLower.some(p => GIG_INCOME_PLATFORMS.has(p) || p.includes('driver') || p.includes('delivery'))) {
    incomeTypeContext = `\nUSER INCOME TYPE: Gig Worker. Focus on vehicle expenses (mileage is primary deduction), phone/data, and platform-specific supplies. Track active work miles vs personal/commuting miles carefully.`;
  } else {
    incomeTypeContext = `\nUSER INCOME TYPE: Self-employed / 1099 / Freelancer. All legitimate, ordinary, and necessary business expenses qualify for Schedule C deduction.`;
  }

  const userPrompt = `Classify this transaction for the user described below.${incomeTypeContext}

CONTEXT:
{
  "profile": {
    "profession": ${JSON.stringify((ctx as UserContext).profession || [])},
    "age": ${(ctx as UserContext).age || 30},
    "annual_income": ${(ctx as UserContext).annual_gross_income_usd || 50000},
    "state": "${(ctx as UserContext).filing_state || (ctx as UserContext).state || ''}",
    "entity_type": "${(ctx as UserContext).business_entity || 'sole_proprietor'}",
    "office_location": "${(ctx as UserContext).office_location || 'Not specified'}",
    "work_travel": "${(ctx as UserContext).work_related_travel || 'none'}",
    "business_purpose": "${(ctx as UserContext).business_purpose || 'Not specified'}",
    "home_office_sqft": ${(ctx as UserContext).home_office_sqft || 0},
    "vehicle_business_use_pct": ${(ctx as UserContext).vehicle_business_use_percentage || 0},
    "w2_income": ${(ctx as UserContext).w2_income || 0},
    "business_income": ${(ctx as UserContext).business_income || 0}
  },
  "learning_context": ${JSON.stringify(learningContext || {})},
  "tx": {
    "merchant": "${transaction.merchant || transaction.merchant_name || ''}",
    "amount_usd": ${transaction.amount_usd || transaction.amount || 0},
    "date_iso": "${transaction.date_iso || transaction.date || ''}",
    "authorized_date": "${transaction.authorized_date || ''}",
    "time_24h": "${timeToUse || ''}",
    "city": "${transaction.location?.city || transaction.city || ''}",
    "state": "${transaction.location?.state || transaction.state || ''}",
    "address": "${transaction.location?.address || ''}",
    "mcc": "${transaction.mcc || transaction.merchant_category_code || ''}",
    "category": ${JSON.stringify(transaction.personal_finance_category || {})},
    "payment_channel": "${transaction.payment_channel || ''}",
    "account_usage_type": "${transaction.account_usage_type || 'unknown'}",
    "counterparties": ${JSON.stringify(transaction.counterparties || [])},
    "merchant_entity_id": "${transaction.merchant_entity_id || ''}",
    "is_recurring": ${transaction.is_recurring ? 'true' : 'false'},
    "note": "${transaction.note || transaction.notes || transaction.description || ''}",
    "business_purpose": "${transaction.business_purpose || ''}",
    "attendees": ${JSON.stringify(transaction.attendees || [])}
  }
}

${professionHints}

Good example of customized_reason for a meal:
"This dinner at Semolina Kitchen could be deductible as a business meal (50%) if you were meeting a client or discussing work. Note who you dined with and the business topic - without that, the IRS would consider this personal."

Good example for a software subscription:
"Figma is a design tool directly used in your freelance graphic design work. Fully deductible on Schedule C Line 18. Keep the invoice or billing confirmation."

Bad example (never write this):
"Restaurant expenses are commonly deductible for freelancer/creator businesses. Keep detailed records."`;

  try {
    const openai = getOpenAIOrThrow();
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