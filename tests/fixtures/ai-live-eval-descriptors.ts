/**
 * Realistic bank-feed descriptors for the live model evaluation. The golden corpus uses clean
 * merchant names; real Plaid feeds carry processor prefixes, store numbers and truncation.
 * Every case is synthetic. `expectedCategory` is the label a careful preparer would give the
 * ORGANIZING category; `expectedStatus` is what the engine should return given the saved facts
 * (a deduction is only ever `ok` when the user's own purpose is saved and no eligibility gate applies).
 */
import type { OutputType, TransactionInput, UserContext } from '@/lib/ai/analyzeTransaction';

type Category = NonNullable<OutputType['category']>;
type Status = OutputType['status'];

export interface DescriptorCase {
  id: string;
  descriptor: string;
  amount: number;
  /** Plaid personal_finance_category.detailed when the feed supplies one. */
  plaidCategory?: string;
  purpose?: string;
  businessUsePercentage?: number;
  profession: 'designer' | 'rideshare' | 'photographer' | 'consultant' | 'realtor' | 'trainer' | 'writer';
  expectedCategory: Category | null;
  expectedStatus: Status | 'blocked_or_review';
  expectedKind?: OutputType['transaction_kind'];
  note?: string;
}

const PROFILES: Record<DescriptorCase['profession'], UserContext> = {
  designer: { user_id: 'desc-designer', profession: ['Freelance graphic designer'], filing_state: 'CA', business_entity: 'sole_proprietor', office_location: 'Oakland, CA' },
  rideshare: { user_id: 'desc-rideshare', profession: ['Rideshare driver'], filing_state: 'TX', business_entity: 'sole_proprietor', vehicle_business_use_percentage: 80 },
  photographer: { user_id: 'desc-photo', profession: ['Wedding photographer'], filing_state: 'NY', business_entity: 'single_member_llc' },
  consultant: { user_id: 'desc-consultant', profession: ['Marketing consultant'], filing_state: 'IL', business_entity: 'sole_proprietor', work_related_travel: 'frequent' },
  realtor: { user_id: 'desc-realtor', profession: ['Real estate agent'], filing_state: 'FL', business_entity: 'sole_proprietor' },
  trainer: { user_id: 'desc-trainer', profession: ['Personal trainer'], filing_state: 'AZ', business_entity: 'sole_proprietor' },
  writer: { user_id: 'desc-writer', profession: ['Freelance writer'], filing_state: 'WA', business_entity: 'sole_proprietor' },
};

const c = (id: string, descriptor: string, amount: number, profession: DescriptorCase['profession'], expectedCategory: Category | null,
  expectedStatus: DescriptorCase['expectedStatus'], extra: Partial<DescriptorCase> = {}): DescriptorCase =>
  ({ id, descriptor, amount, profession, expectedCategory, expectedStatus, ...extra });

export const DESCRIPTOR_CASES: DescriptorCase[] = [
  // Software and web services — purpose saved → ok; no purpose → review (proposed purpose expected once merchant intelligence lands)
  c('paypal-adobe', 'PAYPAL *ADOBE 4029357733 CA', 59.99, 'designer', 'software_subscriptions', 'ok', { purpose: 'Creative Cloud for client design work', plaidCategory: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES' }),
  c('adobe-no-purpose', 'ADOBE *CREATIVE CLD 800-833-6687', 59.99, 'designer', 'software_subscriptions', 'needs_more_info'),
  c('figma', 'FIGMA MONTHLY RENEWAL', 15, 'designer', 'software_subscriptions', 'ok', { purpose: 'Design tool used on client projects' }),
  c('google-workspace', 'GOOGLE *GSUITE_writeoffde', 14.4, 'consultant', 'software_subscriptions', 'ok', { purpose: 'Business email and docs for my consulting practice' }),
  c('apple-bill-ambiguous', 'APPLE.COM/BILL 866-712-7753 CA', 9.99, 'writer', null, 'needs_more_info', { note: 'App Store charge could be anything' }),
  c('notion', 'NOTION LABS INC SAN FRANCISCO', 10, 'writer', 'software_subscriptions', 'ok', { purpose: 'Editorial calendar and client briefs' }),
  c('zoom', 'ZOOM.US 888-799-9666 WWW.ZOOM.US CA', 15.99, 'consultant', 'software_subscriptions', 'ok', { purpose: 'Client meetings' }),
  c('canva', 'CANVA* 04529-12345678 SYDNEY', 12.99, 'realtor', 'software_subscriptions', 'ok', { purpose: 'Listing flyers and social posts' }),
  c('openai', 'OPENAI *CHATGPT SUBSCR', 20, 'writer', 'software_subscriptions', 'ok', { purpose: 'Research and drafting tool for client articles' }),
  c('squarespace', 'SQUARESPACE INC. NEW YORK', 23, 'photographer', 'advertising_marketing', 'ok', { purpose: 'Portfolio website hosting', note: 'website hosting is commonly advertising or software; either organizing category is acceptable' }),
  c('godaddy', 'DNH*GODADDY.COM 480-5058855', 21.17, 'photographer', 'advertising_marketing', 'ok', { purpose: 'Domain for my photography site' }),
  // Advertising
  c('google-ads', 'GOOGLE *ADS3927541288', 250, 'realtor', 'advertising_marketing', 'ok', { purpose: 'Listing ads for the Palmetto property' }),
  c('meta-ads', 'FACEBK *K3LM2N9P42 650-5434800', 120, 'trainer', 'advertising_marketing', 'ok', { purpose: 'Instagram ads for training packages' }),
  c('meta-ads-no-purpose', 'FACEBK *Q9ZZ12345 650-5434800', 45, 'writer', 'advertising_marketing', 'needs_more_info'),
  // Platforms, fees, payouts
  c('upwork-fee', 'UPWORK -ESCROW SERVICE FEE', 47.5, 'writer', 'bank_and_payment_fees', 'ok', { purpose: 'Upwork service fee on client contract' }),
  c('stripe-payout', 'STRIPE TRANSFER ST-X1Y2Z3', -1840, 'designer', null, 'needs_more_info', { expectedKind: 'income', plaidCategory: 'TRANSFER_IN_ACCOUNT_TRANSFER', note: 'a payout without INCOME category needs the source confirmed' }),
  c('stripe-payout-income', 'STRIPE TRANSFER ST-A1B2C3', -2400, 'designer', null, 'ok', { expectedKind: 'income', purpose: 'Client invoice payout for Q3 branding project', plaidCategory: 'INCOME_OTHER_INCOME' }),
  c('shopify-payout', 'SHOPIFY PAYOUT 1234567', -512.4, 'photographer', null, 'needs_more_info', { expectedKind: 'income' }),
  c('square-fees', 'SQUARE INC. FEES', 18.2, 'trainer', 'bank_and_payment_fees', 'ok', { purpose: 'Card processing fees on client sessions' }),
  c('chase-fee', 'MONTHLY SERVICE FEE', 15, 'consultant', 'bank_and_payment_fees', 'ok', { purpose: 'Business checking monthly fee' }),
  c('amex-annual', 'AMERICAN EXPRESS ANNUAL FEE', 250, 'consultant', 'bank_and_payment_fees', 'needs_more_info', { note: 'card used for both business and personal per profile; percentage needed', businessUsePercentage: undefined }),
  // Travel and vehicle
  c('uber-trip', 'UBER *TRIP HELP.UBER.COM', 23.4, 'consultant', 'travel', 'needs_more_info', { purpose: 'Ride to client office downtown', note: 'local business ride: vehicle/travel gate asks for the trip facts' }),
  c('lyft-no-purpose', 'LYFT *RIDE SUN 9PM', 18.75, 'designer', 'travel', 'needs_more_info'),
  c('chevron', 'CHEVRON 0091234 AUSTIN TX', 62.1, 'rideshare', 'vehicle_expense', 'needs_more_info', { purpose: 'Gas while driving for Uber', note: 'standard mileage vs actual method question' }),
  c('shell', 'SHELL OIL 57444121905', 48, 'realtor', 'vehicle_expense', 'needs_more_info', { purpose: 'Gas for showings' }),
  c('delta', 'DELTA AIR 0062345678901 ATLANTA', 412.6, 'consultant', 'travel', 'needs_more_info', { purpose: 'Flight to Denver client workshop Oct 3-5', note: 'travel gate asks tax home/dates/personal days' }),
  c('marriott', 'MARRIOTT DENVER TECH CENTER', 389.24, 'consultant', 'travel', 'needs_more_info', { purpose: 'Hotel for the Denver workshop' }),
  c('airbnb-personal', 'AIRBNB * HMXYZ123 415-800-5959', 620, 'writer', 'travel', 'needs_more_info', { note: 'no purpose: could be vacation' }),
  c('parking', 'PARKMOBILE 770-818-9036 GA', 6.5, 'realtor', 'parking_tolls', 'ok', { purpose: 'Parking at closing', note: 'business-trip parking is deductible in addition to standard mileage (Pub 463); line 9 as parking_tolls (2026-09-18.3)' }),
  c('ezpass', 'E-ZPASS REBILL', 40, 'rideshare', 'parking_tolls', 'ok', { purpose: 'Tolls while driving passengers', note: 'tolls on business driving are deductible in addition to standard mileage' }),
  c('parking-commute', 'LAZ PARKING 400 MAIN', 22, 'consultant', 'parking_tolls', 'ok', { purpose: 'Monthly parking for commuting to the office', expectedKind: 'personal', note: 'commuting parking is personal (Pub 463): ok as personal, never a deduction' }),
  c('spothero-no-purpose', 'SPOTHERO 844-356-8054', 18, 'consultant', 'parking_tolls', 'needs_more_info', { note: 'no purpose: the commuting question, no proposed purpose' }),
  c('hertz', 'HERTZ RENT-A-CAR ORLANDO', 212, 'photographer', 'travel', 'needs_more_info', { purpose: 'Rental car for destination wedding shoot' }),
  c('amtrak', 'AMTRAK .COM 2150000000', 89, 'writer', 'travel', 'needs_more_info', { purpose: 'Train to interview a source in Portland' }),
  // Meals
  c('starbucks-alone', 'STARBUCKS STORE 08421', 6.45, 'writer', 'meals_50', 'needs_more_info', { note: 'coffee alone is personal; never ok' }),
  c('client-lunch', 'TST* SWEETGREEN - MISSION', 38.2, 'designer', 'meals_50', 'needs_more_info', { purpose: 'Lunch with client Maria Chen to review brand concepts', note: 'meal gate asks attendees/conditions even with purpose' }),
  c('doordash', 'DD *DOORDASH CHIPOTLE', 24.6, 'consultant', 'meals_50', 'needs_more_info', { purpose: 'Working late' }),
  // Supplies, equipment, assets
  c('staples', 'STAPLES 00123456 OAKLAND CA', 84.12, 'designer', 'supplies_small_tools', 'ok', { purpose: 'Printer paper and ink for client proofs' }),
  c('amazon-no-note', 'AMZN Mktp US*2K3L9M0N1', 45.99, 'writer', null, 'needs_more_info', { plaidCategory: 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES' }),
  c('amazon-with-note', 'AMZN Mktp US*7Q8R9S0T2', 129, 'photographer', 'supplies_small_tools', 'ok', { purpose: 'SD cards and lens cloths for shoots' }),
  c('bh-camera', 'B&H PHOTO 800-606-6969 NY', 2199, 'photographer', 'equipment', 'needs_more_info', { purpose: 'Sony A7 IV body for weddings', note: 'asset gate: depreciation/§179/de minimis facts' }),
  c('apple-store-laptop', 'APPLE STORE R123 EMERYVILLE', 1899, 'designer', 'equipment', 'needs_more_info', { purpose: 'MacBook Pro for design work' }),
  c('best-buy-monitor', 'BEST BUY 00012345 SAN FRAN', 349.99, 'designer', 'supplies_small_tools', 'needs_more_info', { purpose: 'Second monitor for the design workstation', note: 'over the $200 supplies limit: de minimis election question' }),
  c('home-depot-desk', 'THE HOME DEPOT #0652', 249, 'writer', 'supplies_small_tools', 'needs_more_info', { purpose: 'Standing desk for my writing office', note: 'over the $200 supplies limit: de minimis election question' }),
  c('costco-mixed', 'COSTCO WHSE #0475 SAN LEANDRO', 187.33, 'trainer', null, 'needs_more_info', { purpose: 'Protein bars for clients and groceries', note: 'mixed use: percentage needed' }),
  // Phone, internet, utilities
  c('verizon-no-pct', 'VERIZON WRLS MY VZ VB P', 92.4, 'realtor', 'utilities_phone_internet', 'needs_more_info', { purpose: 'Cell phone used for clients and personal' }),
  c('verizon-pct', 'VERIZON WRLS MY VZ VB P', 92.4, 'realtor', 'utilities_phone_internet', 'ok', { purpose: 'Cell phone, 70% client calls and showings', businessUsePercentage: 70 }),
  c('comcast', 'COMCAST CABLE COMM 800-COMCAST', 89.99, 'writer', 'utilities_phone_internet', 'needs_more_info', { purpose: 'Home internet', note: 'home internet needs the business share' }),
  // Rent, coworking, home office
  c('wework', 'WEWORK 415 MISSION ST', 450, 'consultant', 'rent', 'ok', { purpose: 'Monthly hot desk membership for client work' }),
  c('landlord-rent', 'ZELLE PAYMENT TO JOHN PROPERTIES', 2100, 'designer', 'rent', 'needs_more_info', { purpose: 'Apartment rent; I work from home', note: 'home rent → home office questions, never ok' }),
  c('landlord-rent-nopurpose', 'BAY PROPERTY MGMT ACH', 2100, 'writer', null, 'needs_more_info'),
  // Insurance, professional services, education, dues
  c('hiscox', 'HISCOX INC 866-283-7545', 42, 'consultant', 'insurance', 'ok', { purpose: 'Professional liability insurance for my consulting business', note: 'business insurance is confirmable on line 15 (2026-09-18.3)' }),
  c('next-insurance-no-purpose', 'NEXT INSURANCE INC', 38, 'trainer', 'insurance', 'needs_more_info', { note: 'business insurer with no purpose: proposed purpose, never ok' }),
  c('state-farm-vague', 'STATE FARM INSURANCE 800-782-8332', 110, 'realtor', 'insurance', 'needs_more_info', { purpose: 'Insurance premium for the business', note: 'a carrier that sells every policy type: insurance_coverage question' }),
  c('blue-shield', 'BLUE SHIELD OF CA PREMIUM', 486, 'designer', 'other', 'blocked', { purpose: 'My health insurance premium', note: 'own health premium is a Schedule 1 / Form 7206 item: blocked (Rule 5, relabeled 2026-09-18), never Schedule C ok; never the insurance category' }),
  c('geico', 'GEICO *AUTO 800-841-3000', 148, 'rideshare', 'vehicle_expense', 'needs_more_info', { purpose: 'Car insurance for my rideshare car', note: 'vehicle method question' }),
  c('lemonade-renters', 'LEMONADE INS 844-733-8666', 28, 'writer', 'home_office', 'needs_more_info', { purpose: 'Renters insurance for the apartment where I write', note: 'home policy → home-office eligibility, never line 15' }),
  c('legalzoom', 'LEGALZOOM.COM INC', 299, 'photographer', 'legal_professional', 'needs_more_info', { purpose: 'LLC formation filing for my photography business', note: 'formation facts and entity cost treatment required before deduction' }),
  c('law-firm-contract', 'MORRISON LAW GROUP PLLC', 450, 'consultant', 'legal_professional', 'ok', { purpose: 'Attorney review of my client services contract' }),
  c('law-firm-divorce', 'MORRISON LAW GROUP PLLC', 1800, 'consultant', 'legal_professional', 'ok', { purpose: 'Attorney fees for my divorce', expectedKind: 'personal', note: 'personal matter (Pub 334): ok as personal, never a deduction' }),
  c('hrblock', 'H&R BLOCK ONLINE 800-472-5625', 189, 'writer', 'legal_professional', 'needs_more_info', { purpose: 'Tax prep for my 1040 and Schedule C', note: 'business portion only: business_use_percentage required; line 17 as legal_professional' }),
  c('hrblock-share', 'H&R BLOCK ONLINE 800-472-5625', 189, 'writer', 'legal_professional', 'ok', { purpose: 'Tax prep for my 1040 and Schedule C', businessUsePercentage: 40, note: 'saved share: ok at 40% under legal_professional' }),
  c('sunbiz', 'FL SUNBIZ ANNUAL REPORT', 138.75, 'realtor', 'taxes_licenses', 'ok', { purpose: 'Annual report fee for my LLC', note: 'line 23 as taxes_licenses (2026-09-18.3)' }),
  c('city-license', 'CITY OF OAKLAND BUSINESS LICENSE', 95, 'designer', 'taxes_licenses', 'ok', { purpose: 'Business license renewal for the design studio' }),
  c('ubreakifix', 'UBREAKIFIX 00234 CHICAGO', 180, 'consultant', 'repairs_maintenance', 'ok', { purpose: 'Screen repair on the work laptop', note: 'line 21 as repairs_maintenance (2026-09-18.3)' }),
  c('hvac-improvement', 'ACE HVAC SERVICES', 3200, 'photographer', 'repairs_maintenance', 'needs_more_info', { purpose: 'Replaced the compressor in the studio HVAC system', note: 'improvement over the de minimis ceiling: asset_treatment (§263)' }),
  c('home-repair', 'MR APPLIANCE OF AUSTIN', 260, 'writer', 'home_office', 'needs_more_info', { purpose: 'Fixed the dishwasher in my home', note: 'home repair → home-office eligibility, never line 21' }),
  c('udemy', 'UDEMY ONLINE COURSES', 19.99, 'designer', 'education_training', 'ok', { purpose: 'Advanced Figma course to improve my design skills' }),
  c('coursera-new-trade', 'COURSERA ORG', 49, 'trainer', 'education_training', 'needs_more_info', { purpose: 'Nursing prerequisites so I can change careers', note: '§1.162-5 new trade: never ok' }),
  c('aiga-dues', 'AIGA NATIONAL DUES', 150, 'designer', 'dues_and_memberships', 'ok', { purpose: 'Professional association membership' }),
  c('planet-fitness', 'PLANET FITNESS CLUB FEES', 24.99, 'writer', 'dues_and_memberships', 'ok', { purpose: 'Gym membership', expectedKind: 'personal', note: '§274(a)(3) club dues with no business purpose: ok as personal without a question (Rule 4, relabeled 2026-09-18), never a deduction' }),
  c('trainer-gym-rent', 'EQUINOX TRAINER SPACE RENTAL', 400, 'trainer', 'rent', 'ok', { purpose: 'Floor space rental to train my clients at the gym' }),
  // Contract labor
  c('contractor-zelle', 'ZELLE PAYMENT TO ANA RIVERA', 800, 'photographer', 'contract_labor', 'ok', { purpose: 'Second shooter for the Alvarez wedding' }),
  c('venmo-no-note', 'VENMO PAYMENT 1023456789', 60, 'designer', null, 'needs_more_info', { note: 'transfer/personal ambiguity' }),
  // Not expenses: taxes, transfers, deposits, refunds, personal
  c('irs-estimated', 'IRS USATAXPYMT 2260000000', 1500, 'consultant', 'other', 'blocked_or_review', { purpose: 'Q3 estimated tax', expectedKind: 'expense', note: 'P0 from the live eval: must never be ok' }),
  c('ftb-payment', 'FRANCHISE TAX BOARD PAYMENTS', 800, 'designer', 'other', 'blocked_or_review', { purpose: 'California estimated tax' }),
  c('transfer-savings', 'ONLINE TRANSFER TO SAV ...9988', 500, 'writer', null, 'needs_more_info', { plaidCategory: 'TRANSFER_OUT_ACCOUNT_TRANSFER', expectedKind: 'transfer', note: 'transfer never a deduction' }),
  c('transfer-own-noted', 'ONLINE TRANSFER TO SAV ...9988', 500, 'writer', null, 'ok', { purpose: 'Moved money between my own accounts', plaidCategory: 'TRANSFER_OUT_ACCOUNT_TRANSFER', expectedKind: 'transfer' }),
  c('zelle-deposit', 'ZELLE PAYMENT FROM MARK T', -300, 'trainer', null, 'needs_more_info', { note: 'unexplained deposit is not income' }),
  c('client-deposit', 'ZELLE PAYMENT FROM MARK T', -300, 'trainer', null, 'ok', { purpose: 'Client payment for 4 training sessions', plaidCategory: 'INCOME_OTHER_INCOME', expectedKind: 'income' }),
  c('amazon-refund', 'AMZN Mktp US*RF12345 REFUND', -45.99, 'writer', null, 'needs_more_info', { expectedKind: 'refund', note: 'refund needs the original purchase' }),
  c('atm', 'ATM WITHDRAWAL 00123 MAIN ST', 200, 'rideshare', null, 'needs_more_info', { plaidCategory: 'TRANSFER_OUT_WITHDRAWAL' }),
  c('netflix', 'NETFLIX.COM 866-579-7172', 15.49, 'designer', null, 'ok', { expectedKind: 'personal', note: 'streaming with no purpose is personal by nature: ok as personal without a question (Rule 4, relabeled 2026-09-18), never a deduction' }),
  c('groceries', 'TRADER JOE S #123 OAKLAND', 84.2, 'consultant', null, 'ok', { plaidCategory: 'FOOD_AND_DRINK_GROCERIES', expectedKind: 'personal', note: 'groceries with no purpose are personal by nature: ok as personal without a question (Rule 4, relabeled 2026-09-18), never a deduction' }),
  c('check', 'CHECK 1043', 1200, 'realtor', null, 'needs_more_info'),
  c('pending-auth', 'PENDING - UBER *TRIP', 12, 'consultant', 'travel', 'needs_more_info', { note: 'pending records should not be approved' }),
];

export function descriptorTransaction(item: DescriptorCase): TransactionInput {
  return {
    tx_id: `desc-${item.id}`, merchant: item.descriptor, merchant_name: item.descriptor, amount_usd: item.amount, amount: item.amount,
    date_iso: '2026-06-12', date: '2026-06-12', category: item.plaidCategory ?? undefined,
    ...(item.plaidCategory ? { personal_finance_category: { detailed: item.plaidCategory } } : {}),
    ...(item.purpose ? { business_purpose: item.purpose } : {}),
    ...(item.businessUsePercentage !== undefined ? { business_use_percentage: item.businessUsePercentage } : {}),
    ...(item.id === 'pending-auth' ? { pending: true } : {}),
    account_usage_type: 'business',
  };
}

export function descriptorContext(item: DescriptorCase): UserContext {
  return PROFILES[item.profession];
}
