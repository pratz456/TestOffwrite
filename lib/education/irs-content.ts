export interface IRSContent {
  id: string;
  title: string;
  publication: string;
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
    section: 'Section 274(n)',
    content: `Business meals are generally deductible at 50% under IRC Section 274(n). This includes meals with clients, business associates, or during business travel.

Key Requirements:
- Must be directly related to or associated with your business
- Must be ordinary and necessary for your business
- Cannot be lavish or extravagant
- Must have a clear business purpose

The 50% limitation applies to most business meals, but there are exceptions for certain types of meals like company parties or meals provided for the convenience of the employer.`,
    examples: [
      'Lunch with a client to discuss a project - 50% deductible',
      'Dinner during a business conference - 50% deductible',
      'Coffee meeting with a potential business partner - 50% deductible',
      'Company holiday party for employees - 100% deductible (exception)'
    ],
    keyPoints: [
      'Always document the business purpose and attendees',
      'Keep receipts showing date, amount, and business purpose',
      'The 50% rule applies even if you discuss business',
      'Entertainment expenses are generally not deductible'
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
      '200 sq ft home office = $1,000 deduction (simplified)',
      '15% of home used for business = 15% of utilities, insurance, etc.',
      'Separate structure used exclusively for business = 100% deductible'
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
    section: 'Section 162',
    content: `Vehicle expenses for business use are deductible. You can choose between the standard mileage rate or actual expenses.

Standard Mileage Rate (2024):
- 67 cents per mile for business use
- Includes depreciation, gas, insurance, maintenance
- Must be chosen in first year of business use
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
      'Drive 1,000 business miles = $670 deduction (standard rate)',
      'Client meeting 50 miles away = $33.50 deduction',
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
    publication: 'IRS Pub 535',
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
      'Annual subscriptions can be deducted in full if business use'
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
    publication: 'IRS Pub 535',
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

export function getIRSContentForTransaction(transaction: any): IRSContent | null {
  const merchant = transaction.merchant_name?.toLowerCase() || '';
  const category = transaction.category?.toLowerCase() || '';
  const mcc = transaction.mcc || '';
  
  // Check by MCC code first
  for (const [key, content] of Object.entries(IRS_CONTENT_DATABASE)) {
    if (content.mccCodes?.includes(mcc)) {
      return content;
    }
  }
  
  // Check by keywords
  for (const [key, content] of Object.entries(IRS_CONTENT_DATABASE)) {
    if (content.keywords.some(keyword => 
      merchant.includes(keyword) || category.includes(keyword)
    )) {
      return content;
    }
  }
  
  // Check by category
  for (const [key, content] of Object.entries(IRS_CONTENT_DATABASE)) {
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
