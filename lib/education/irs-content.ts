/**
 * Reviewed 2026-09-17 for tax years 2025-2026. Sources:
 *   - Meals: IRC §274(k), (n), (o); IRS Pub 463 (2025) ch. 2 — https://www.irs.gov/publications/p463
 *   - Home office: IRS Pub 587; Rev. Proc. 2013-13 ($5/sq ft, 300 sq ft cap) — https://www.irs.gov/publications/p587
 *   - Mileage: Notice 2025-5 (70¢), Notice 2026-10 (72.5¢), Announcement 2026-11 (76¢ from 7/1/2026) —
 *     https://www.irs.gov/tax-professionals/standard-mileage-rates ; see lib/tax-rules/mileage-rates.ts
 *   - Travel: IRS Pub 463 ch. 1
 *   - Business expenses generally: IRS Pub 334 (Publication 535 was discontinued after 2022) —
 *     https://www.irs.gov/forms-pubs/about-publication-535
 */
export interface IRSContent {
  id: string;
  title: string;
  publication: string;
  /** Primary IRS source for the "View Full Publication" link. */
  url: string;
  section?: string;
  content: string;
  examples: string[];
  keyPoints: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedReadTime: number;
  relatedTopics: string[];
  category: string;
  mccCodes?: string[];
  keywords: string[];
}

export const IRS_CONTENT_DATABASE: Record<string, IRSContent> = {
  'meals_50': {
    id: 'meals_50',
    title: 'Business Meals - 50% Deduction Rule',
    publication: 'IRS Pub 463',
    url: 'https://www.irs.gov/publications/p463',
    section: 'Section 274(n)',
    content: `Business meals are generally deductible at 50% under IRC Section 274(n) for 2025 and 2026. This includes meals with clients or business associates and meals while traveling away from home for business.

Key Requirements:
- Must be ordinary and necessary for your business
- You or an employee must be present
- Cannot be lavish or extravagant
- Must have a clear business purpose and a business contact (client, customer, consultant or similar)

The temporary 100% allowance for restaurant meals applied only to 2021 and 2022 and has expired. Limited exceptions to the 50% cut remain, such as recreational events primarily for rank-and-file employees (for example a company holiday party) and meals sold to customers. Starting in 2026, most employer-provided meals excluded from employees' wages are no longer deductible at all (IRC Section 274(o)).`,
    examples: [
      'Lunch with a client to discuss a project - 50% deductible',
      'Dinner during a business conference away from home - 50% deductible',
      'Coffee meeting with a potential business partner - 50% deductible',
      'Meals during an entertainment event - deductible at 50% only if purchased separately or separately stated on the bill'
    ],
    keyPoints: [
      'Always document the business purpose and attendees',
      'Keep receipts showing date, amount, and business purpose',
      'The 50% rule applies even when you discuss business',
      'Entertainment expenses are not deductible'
    ],
    difficulty: 'beginner',
    estimatedReadTime: 3,
    relatedTopics: ['travel_expenses', 'entertainment', 'business_purpose'],
    category: 'meals_50',
    mccCodes: ['5812', '5814', '5813'],
    keywords: ['restaurant', 'meal', 'lunch', 'dinner', 'coffee', 'food', 'dining']
  },
  'home_office': {
    id: 'home_office',
    title: 'Home Office Deduction',
    publication: 'IRS Pub 587',
    url: 'https://www.irs.gov/publications/p587',
    section: 'Section 280A',
    content: `The home office deduction allows you to deduct expenses for the business use of your home. You can use either the simplified method ($5 per square foot) or the actual expense method.

Requirements:
- Must be used exclusively and regularly for business
- Must be your principal place of business OR a place where you meet clients
- Cannot be used for personal purposes

Simplified Method:
- $5 per square foot (maximum 300 sq ft = $1,500)
- No depreciation or home-related expenses needed
- Easier to calculate and less recordkeeping

Actual Expense Method:
- Calculate percentage of home used for business
- Apply percentage to home expenses (utilities, insurance, etc.)
- Can include depreciation on home
- More complex but potentially higher deduction`,
    examples: [
      '200 sq ft home office = $1,000 deduction (simplified method, $5 per square foot)',
      '15% of home used for business = 15% of utilities, insurance, etc.',
      'Separate structure used regularly and exclusively for business - its expenses are deductible without the principal-place-of-business test'
    ],
    keyPoints: [
      'Exclusive use is required - no personal use allowed',
      'Regular use means consistent business use, not occasional',
      'Principal place of business includes administrative work',
      'Keep records of square footage and home expenses'
    ],
    difficulty: 'intermediate',
    estimatedReadTime: 5,
    relatedTopics: ['utilities', 'depreciation', 'business_use_percentage'],
    category: 'home_office',
    keywords: ['home office', 'office', 'workspace', 'home', 'utilities', 'rent', 'mortgage']
  },
  'vehicle_expense': {
    id: 'vehicle_expense',
    title: 'Vehicle Expenses and Mileage',
    publication: 'IRS Pub 463',
    url: 'https://www.irs.gov/tax-professionals/standard-mileage-rates',
    section: 'Section 162',
    content: `Vehicle expenses for business use are deductible. You can choose between the standard mileage rate or actual expenses.

Standard Mileage Rate (business use; the rate depends on the date driven):
- 2025: 70 cents per mile (IRS Notice 2025-5)
- January 1 - June 30, 2026: 72.5 cents per mile (IRS Notice 2026-10)
- July 1 - December 31, 2026: 76 cents per mile (IRS Announcement 2026-11)
- 2027: not yet announced; the IRS normally publishes the rate in December
- Includes depreciation, gas, insurance, maintenance; parking and tolls are deductible separately
- Must be chosen in the first year the car is used for business to remain available later
- Simpler recordkeeping

Actual Expense Method:
- Depreciation, gas, oil, insurance, repairs, registration
- Calculate business use percentage
- More complex but potentially higher deduction
- Must track all vehicle expenses

Business Use Requirements:
- Must be ordinary and necessary for your business
- Cannot include commuting to regular workplace
- Must document business purpose for each trip
- Keep detailed mileage logs`,
    examples: [
      'Drive 1,000 business miles in 2025 = $700 deduction (standard rate)',
      'Client meeting 50 miles away in March 2026 = $36.25 deduction; the same trip in August 2026 = $38.00',
      'Business trip to conference = deductible mileage'
    ],
    keyPoints: [
      'Commuting to regular workplace is NOT deductible',
      'Keep detailed mileage logs with dates and purposes',
      'Choose method in first year of business use',
      'Business use percentage applies to actual expenses'
    ],
    difficulty: 'beginner',
    estimatedReadTime: 4,
    relatedTopics: ['travel_expenses', 'commuting', 'business_purpose'],
    category: 'vehicle_expense',
    mccCodes: ['4121', '5541', '5542'],
    keywords: ['gas', 'fuel', 'mileage', 'vehicle', 'car', 'uber', 'lyft', 'taxi', 'transportation']
  },
  'travel_expenses': {
    id: 'travel_expenses',
    title: 'Business Travel Expenses',
    publication: 'IRS Pub 463',
    url: 'https://www.irs.gov/publications/p463',
    section: 'Section 162',
    content: `Business travel expenses are deductible when you travel away from your tax home for business purposes. This includes transportation, lodging, meals, and incidental expenses.

Requirements:
- Must be away from your tax home overnight
- Must be primarily for business purposes
- Must be ordinary and necessary for your business

Deductible Expenses:
- Transportation (airfare, train, car rental, gas)
- Lodging (hotel, Airbnb, etc.)
- Meals (50% deductible)
- Incidental expenses (tips, phone calls, etc.)

Non-Deductible:
- Personal expenses during business travel
- Commuting to regular workplace
- Expenses for personal side trips
- Lavish or extravagant expenses`,
    examples: [
      'Flight to client meeting in another city - 100% deductible',
      'Hotel for business conference - 100% deductible',
      'Meals during business travel - 50% deductible',
      'Personal sightseeing during business trip - not deductible'
    ],
    keyPoints: [
      'Tax home is your regular place of business',
      'Overnight stay required for most travel deductions',
      'Document business purpose for each trip',
      'Keep receipts for all travel expenses'
    ],
    difficulty: 'intermediate',
    estimatedReadTime: 4,
    relatedTopics: ['meals_50', 'vehicle_expense', 'business_purpose'],
    category: 'travel',
    keywords: ['travel', 'hotel', 'flight', 'airfare', 'lodging', 'business trip', 'conference']
  },
  'software_subscriptions': {
    id: 'software_subscriptions',
    title: 'Software and Subscription Expenses',
    publication: 'IRS Pub 334',
    url: 'https://www.irs.gov/publications/p334',
    section: 'Section 162',
    content: `Software and subscription expenses are generally deductible as ordinary and necessary business expenses. This includes cloud software, productivity tools, and business-related subscriptions.

Types of Deductible Software:
- Business productivity software (Office 365, Google Workspace)
- Industry-specific software (design tools, accounting software)
- Cloud storage and backup services
- Communication tools (Slack, Zoom)
- Marketing and analytics tools

Requirements:
- Must be used primarily for business purposes
- Must be ordinary and necessary for your business
- Cannot be lavish or extravagant
- Keep records of business use percentage if mixed use`,
    examples: [
      'Adobe Creative Suite for graphic design business - 100% deductible',
      'Zoom Pro for client meetings - 100% deductible',
      'Netflix subscription (personal use) - not deductible',
      'Canva Pro for business marketing - 100% deductible'
    ],
    keyPoints: [
      'Document business purpose for each subscription',
      'Mixed-use subscriptions may require allocation',
      'Keep records of business vs personal use',
      'A prepaid subscription covering more than 12 months may need to be spread over the periods it covers'
    ],
    difficulty: 'beginner',
    estimatedReadTime: 3,
    relatedTopics: ['business_purpose', 'mixed_use', 'documentation'],
    category: 'software_subscriptions',
    keywords: ['software', 'subscription', 'saas', 'cloud', 'app', 'tool', 'platform']
  },
  'utilities_phone_internet': {
    id: 'utilities_phone_internet',
    title: 'Utilities, Phone, and Internet Expenses',
    publication: 'IRS Pub 334',
    url: 'https://www.irs.gov/publications/p334',
    section: 'Section 162',
    content: `Utilities, phone, and internet expenses can be deductible when used for business purposes. The deduction depends on whether the expense is used exclusively for business or mixed use.

Business-Only Expenses:
- Dedicated business phone line - 100% deductible
- Business-only internet connection - 100% deductible
- Utilities for separate business space - 100% deductible

Mixed-Use Expenses:
- Personal phone used for business - allocate business percentage
- Home internet used for business - allocate business percentage
- Home utilities with home office - allocate based on home office percentage

Documentation Requirements:
- Keep detailed records of business vs personal use
- Document business calls and internet usage
- Calculate business use percentage accurately`,
    examples: [
      'Dedicated business phone line - 100% deductible',
      'Home internet: 60% business use = 60% deductible',
      'Cell phone: 40% business calls = 40% deductible',
      'Home office utilities: 15% of home = 15% deductible'
    ],
    keyPoints: [
      'Exclusive business use = 100% deductible',
      'Mixed use requires allocation based on business percentage',
      'Keep detailed records of business usage',
      'Home office percentage applies to home utilities'
    ],
    difficulty: 'intermediate',
    estimatedReadTime: 4,
    relatedTopics: ['home_office', 'mixed_use', 'business_purpose'],
    category: 'utilities_phone_internet',
    keywords: ['phone', 'internet', 'utilities', 'electric', 'gas', 'water', 'cable', 'wifi']
  }
};

export function getIRSContentForTransaction(transaction: { merchant_name?: string | null; category?: string | null; mcc?: string | null }): IRSContent | null {
  const merchant = transaction.merchant_name?.toLowerCase() || '';
  const category = transaction.category?.toLowerCase() || '';
  const mcc = transaction.mcc || '';
  
  // Check by MCC code first
  for (const content of Object.values(IRS_CONTENT_DATABASE)) {
    if (content.mccCodes?.includes(mcc)) {
      return content;
    }
  }
  
  // Check by keywords
  for (const content of Object.values(IRS_CONTENT_DATABASE)) {
    if (content.keywords.some(keyword => 
      merchant.includes(keyword) || category.includes(keyword)
    )) {
      return content;
    }
  }
  
  // Check by category
  for (const content of Object.values(IRS_CONTENT_DATABASE)) {
    if (content.category === category) {
      return content;
    }
  }
  
  // Default to meals if it's a restaurant
  if (merchant.includes('restaurant') || merchant.includes('cafe') || 
      merchant.includes('coffee') || merchant.includes('starbucks')) {
    return IRS_CONTENT_DATABASE['meals_50'];
  }
  
  return null;
}

export function getRelatedIRSContent(currentContent: IRSContent): IRSContent[] {
  return currentContent.relatedTopics
    .map(topic => Object.values(IRS_CONTENT_DATABASE).find(content => content.id === topic))
    .filter(Boolean) as IRSContent[];
}
