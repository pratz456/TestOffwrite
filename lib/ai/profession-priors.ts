/**
 * Profession priors: what a self-employed person in a given line of work typically deducts, the
 * specific rule nuance for each category, the merchants that show up in their bank feeds and the
 * top audit traps. Priors shape the prompt and the grounding questions; they never establish
 * deductibility. Rule text is traceable to the evidence packet in transaction-tax-policy.ts by the
 * listed evidence IDs; anything outside the packet is flagged in `notes` rather than asserted.
 */
import type { MerchantSubtype } from './merchant-intelligence';
import type { ExpenseCategory } from './transaction-tax-policy';

export const PROFESSION_IDS = [
  'graphic_ux_designer', 'web_developer', 'photographer_videographer', 'writer_editor', 'marketing_consultant',
  'management_consultant', 'real_estate_agent', 'rideshare_delivery_driver', 'trucker_owner_operator', 'personal_trainer',
  'hair_stylist_barber', 'massage_therapist', 'nurse_contractor', 'therapist_private_practice', 'musician_performer',
  'tutor_teacher', 'ecommerce_seller', 'handyman_contractor', 'cleaner', 'landscaper', 'notary_signing_agent', 'bookkeeper',
  'insurance_agent', 'influencer_content_creator', 'virtual_assistant', 'other_general',
] as const;
export type ProfessionId = typeof PROFESSION_IDS[number];

export interface ProfessionExpensePrior {
  category: ExpenseCategory;
  /** The rule nuance the model should apply for this profession, in plain language. */
  nuance: string;
  /** Evidence IDs from TRANSACTION_TAX_EVIDENCE that back the nuance. */
  evidence: readonly string[];
}
/** A profession-specific reading of a merchant signal: a question or a category re-route, never an approval. */
export interface ProfessionMerchantHint {
  category?: ExpenseCategory;
  scheduleCLine?: string;
  question: string;
}
export interface ProfessionPrior {
  id: ProfessionId;
  label: string;
  /** Lowercase keywords/phrases matched against the profile's profession text; longer matches win. */
  keywords: readonly string[];
  summary: string;
  typical: readonly ProfessionExpensePrior[];
  merchants: readonly string[];
  auditTraps: readonly [string, string, string];
  hints?: Partial<Record<MerchantSubtype, ProfessionMerchantHint>>;
  /** Rules referenced from outside the evidence packet, or facts that could not be verified against a primary source. */
  notes?: string;
}

const E = {
  general: ['business-162'], personal: ['personal-262'], meals: ['meals-274'], travel: ['travel-463'], assets: ['assets-946', 'capital-263', 'supplies-263a'],
  home: ['home-587'], records: ['records-334'], software: ['software-334'], ads: ['advertising-334'], labor: ['contract-labor-334', 'information-returns-6041'],
  insurance: ['insurance-334'], fees: ['bank-fees-334', 'platform-fees-1099k'], dues: ['dues-274a3'], gifts: ['gifts-274b'], phone: ['phone-internet-262'],
  startup: ['startup-195'], professional: ['professional-fees-334'], taxes: ['taxes-licenses-sch-c'], mileage: ['mileage-rates', 'travel-463'],
  supplies: ['supplies-263a'], rent: ['rent-334'], utilities: ['utilities-334'], education: ['education-reg-1.162-5'],
};
const t = (category: ExpenseCategory, nuance: string, evidence: readonly string[]): ProfessionExpensePrior => ({ category, nuance, evidence });

// Nuances reused across professions --------------------------------------------------------------
const N = {
  softwareBusiness: t('software_subscriptions', 'Subscriptions used in the business are ordinary (line 18); family or personal plans need a business-use split', E.software),
  computerAsset: t('equipment', 'Computers and tablets: de minimis election at or under $2,500 per item, otherwise depreciation/§179; shared devices need a business-use %', E.assets),
  homeOffice: t('home_office', 'Regular and exclusive business use only (Form 8829 or simplified method); a shared family room fails', E.home),
  phoneSplit: t('utilities_phone_internet', 'Phone and internet count only at the documented business-use %; the first residential line is personal', E.phone),
  ceMaintain: t('education_training', 'Maintaining or improving current skills qualifies; qualifying for a new trade or license does not', E.education),
  contractors: t('contract_labor', 'Subcontractor payments (line 11); Form 1099-NEC due at $2,000+ per payee for payments after 2025', E.labor),
  clientMeals: t('meals_50', 'Meals with a client or collaborator where business is discussed are 50%; meals alone while working are personal', E.meals),
  liability: t('other', 'Business liability or E&O premiums are line 15; health premiums go to Schedule 1 (Form 7206), not Schedule C', E.insurance),
  mileage: t('vehicle_expense', 'Log business miles between work locations; commuting is personal unless the home office is the principal place of business', E.mileage),
  platformFees: t('bank_and_payment_fees', 'Report platform payouts at the gross 1099-K amount; deduct platform and processing fees separately (line 10)', E.fees),
  professionalDues: t('dues_and_memberships', 'Professional or trade association dues are deductible; gym, social and country club dues are not', E.dues),
  licenses: t('other', 'License, permit and regulatory renewals are line 23; income and estimated tax payments are never an expense', E.taxes),
  clothing: t('other', 'Clothing suitable for everyday wear is personal even when worn for work; only uniforms, costumes and protective gear qualify', E.personal),
  gifts: t('other', 'Business gifts are capped at $25 per recipient per year; entertainment such as tickets is not deductible', E.gifts),
};

export const PROFESSION_PRIORS: readonly ProfessionPrior[] = [
  {
    id: 'graphic_ux_designer', label: 'Graphic / UX designer',
    keywords: ['graphic designer', 'ux designer', 'ui designer', 'ux/ui', 'product designer', 'web designer', 'brand designer', 'illustrator', 'designer', 'design', 'animator', 'motion graphics'],
    summary: 'Client design work billed per project; software-heavy with a home office and occasional print or stock purchases.',
    typical: [
      t('software_subscriptions', 'Adobe, Figma and similar design tools are ordinary software (line 18); Microsoft or Apple family plans need a business-use split', E.software),
      N.computerAsset,
      t('supplies_small_tools', 'Stock images, fonts and templates bought for client deliverables are supplies (line 22)', E.supplies),
      t('advertising_marketing', 'Portfolio site, domain and paid listings promoting the practice are advertising (line 8)', E.ads),
      N.professionalDues, N.ceMaintain, N.homeOffice,
    ],
    merchants: ['Adobe', 'Figma', 'Canva', 'Apple', 'Squarespace', 'Envato', 'Dribbble', 'AIGA'],
    auditTraps: [
      'A personal or family Microsoft 365 / Apple One plan claimed at 100%.',
      'A new computer or tablet expensed in full without the de minimis election or a business-use %.',
      'Stock assets, fonts and courses bought for personal projects.',
    ],
    hints: {
      electronics: { category: 'equipment', question: 'What was purchased and how much of its use is client design work? Items over $2,500 need depreciation or first-year expensing records; items at or under need the de minimis election.' },
    },
  },
  {
    id: 'web_developer', label: 'Web developer / software engineer',
    keywords: ['software developer', 'software engineer', 'web developer', 'developer', 'programmer', 'engineer', 'app developer', 'data scientist', 'data engineer', 'devops', 'coder', 'it consultant', 'it contractor', 'machine learning', 'data analyst', 'qa engineer', 'technical consultant'],
    summary: 'Contract development billed hourly or per project; cloud, tooling and hardware costs dominate.',
    typical: [
      t('software_subscriptions', 'Hosting, repositories, IDEs and AI tools used for client work are ordinary software (line 18); bills that host personal side projects need a split', E.software),
      N.computerAsset, N.contractors, N.homeOffice, N.phoneSplit,
      t('education_training', 'Courses and conferences maintaining current skills qualify; a degree or bootcamp that qualifies for the trade does not', E.education),
    ],
    merchants: ['GitHub', 'AWS', 'Vercel', 'DigitalOcean', 'JetBrains', 'OpenAI', 'Apple', 'Udemy'],
    auditTraps: [
      'Cloud and domain bills that also run personal projects claimed in full.',
      'Bootcamp or degree tuition that qualifies for a new trade.',
      'Home internet and phone claimed at 100%.',
    ],
  },
  {
    id: 'photographer_videographer', label: 'Photographer / videographer',
    keywords: ['photographer', 'videographer', 'filmmaker', 'cinematographer', 'video editor', 'video production', 'photo', 'video', 'wedding photography', 'drone pilot'],
    summary: 'Paid shoots with heavy equipment, editing software, travel to locations and second shooters or editors.',
    typical: [
      t('equipment', 'Camera bodies, lenses, lighting and drones are assets: §179/bonus or depreciation over $2,500 per item, de minimis election at or under; gear also used personally needs a business-use %', E.assets),
      t('software_subscriptions', 'Editing suites and client gallery delivery services are ordinary software (line 18)', E.software),
      t('rent', 'Studio rent is line 20b; gear and lens rentals for a shoot are line 20a', E.rent),
      t('travel', 'Shoots away from the tax home overnight are travel; a vacation with an incidental paid shoot is personal except the shoot-specific costs', E.travel),
      t('contract_labor', 'Second shooters and editors are contract labor (line 11) with Form 1099-NEC at $2,000 or more per payee', E.labor),
      N.mileage,
    ],
    merchants: ['B&H Photo', 'Adorama', 'Adobe', 'Pixieset', 'Lensrentals', 'Squarespace', 'PPA', 'Delta'],
    auditTraps: [
      'Gear used for personal photos with no business-use log or percentage.',
      'A whole trip deducted when the paid shoot was incidental to a vacation.',
      'Bodies and lenses over $2,500 expensed without depreciation or §179 records.',
    ],
    hints: {
      electronics: { category: 'equipment', scheduleCLine: '13', question: 'Is this camera body, lens or computer used in paid shoots, what share of its use is personal, and is it over $2,500 (depreciation or first-year expensing) or at or under (de minimis election)?' },
      travel_air: { question: 'Which paid shoot required this trip, what were the travel dates, and were any days personal or with family?' },
    },
  },
  {
    id: 'writer_editor', label: 'Writer / editor',
    keywords: ['writer', 'freelance writer', 'editor', 'copywriter', 'author', 'journalist', 'blogger', 'proofreader', 'translator', 'copy editor', 'ghostwriter', 'technical writer', 'grant writer'],
    summary: 'Writing and editing for clients or publications; low overhead with research, software and a home office.',
    typical: [
      N.softwareBusiness,
      t('supplies_small_tools', 'Books, references and publications bought for a specific paid piece are supplies; general reading is personal', E.supplies),
      N.homeOffice, N.phoneSplit,
      t('advertising_marketing', 'Author website, newsletter platform and paid listings are advertising (line 8)', E.ads),
      t('bank_and_payment_fees', 'Agent commissions and platform fees are line 10; report the gross fee income', E.fees),
      N.ceMaintain,
    ],
    merchants: ['Grammarly', 'Substack', 'Amazon', 'Squarespace', 'ConvertKit', 'Scrivener', 'Authors Guild', 'Zoom'],
    auditTraps: [
      'Books, streaming and news subscriptions consumed for pleasure labelled research.',
      'A home office that doubles as the family room (exclusive use fails).',
      'Conference travel with personal days not separated.',
    ],
    hints: {
      streaming: { question: 'Books, audiobooks and streaming are personal unless bought for a specific paid piece. Which piece or client was this research for?' },
    },
  },
  {
    id: 'marketing_consultant', label: 'Marketing consultant / social media manager',
    keywords: ['marketing consultant', 'seo consultant', 'marketing', 'social media manager', 'social media', 'marketing specialist', 'seo', 'digital marketer', 'ads manager', 'media buyer', 'pr consultant', 'publicist', 'brand strategist', 'growth', 'email marketing'],
    summary: 'Runs marketing for clients; ad spend, scheduling tools and analytics software, often with reimbursed client costs.',
    typical: [
      t('advertising_marketing', 'Ad spend promoting your own practice is line 8; ad spend you run for clients is your expense only if you bear the cost, and any reimbursement is income', E.ads.concat(E.records)),
      N.softwareBusiness, N.contractors, N.clientMeals, N.phoneSplit, N.homeOffice,
    ],
    merchants: ['Meta Ads', 'Google Ads', 'Canva', 'Later', 'Semrush', 'HubSpot', 'Mailchimp', 'Zoom'],
    auditTraps: [
      'Client-reimbursed ad spend deducted without reporting the reimbursement as income.',
      'Personal phone, streaming and social subscriptions claimed as research.',
      'Giveaway prizes and gifts to customers without checking the $25 gift cap or the advertising treatment.',
    ],
    notes: 'Whether a contest prize is advertising or a §274(b) gift depends on facts; the priors ask rather than conclude.',
  },
  {
    id: 'management_consultant', label: 'Consultant / business coach',
    keywords: ['management consultant', 'business consultant', 'business coach', 'executive coach', 'life coach', 'career coach', 'consultant', 'consulting', 'coach', 'strategy', 'advisor', 'fractional', 'project manager', 'analyst', 'interim'],
    summary: 'Advisory work billed per engagement; travel to client sites, client meals, certifications and professional insurance.',
    typical: [
      t('travel', 'Overnight travel to client sites away from the tax home is travel; a single client site expected to last more than one year is not temporary', E.travel),
      N.clientMeals, N.softwareBusiness, N.liability, N.professionalDues, N.ceMaintain, N.homeOffice,
    ],
    merchants: ['Delta', 'Marriott', 'Uber', 'Zoom', 'Calendly', 'LinkedIn', 'Hiscox', 'WeWork'],
    auditTraps: [
      'Client-reimbursed travel deducted a second time.',
      'Commuting to a long-term single client site treated as business travel.',
      'Coaching or certification programs that qualify for a new profession.',
    ],
    hints: {
      electronics: { question: 'What was purchased and how is it used in your consulting work? A camera or audio gear needs a stated business use; a laptop over $2,500 or shared with personal use needs asset treatment.' },
    },
  },
  {
    id: 'real_estate_agent', label: 'Real estate agent',
    keywords: ['real estate', 'realtor', 'real estate agent', 'real estate broker', 'property manager', 'leasing agent', 'mortgage broker', 'loan officer'],
    summary: 'Commission income under a brokerage; lead generation, showings by car, association dues, license renewals and closing gifts.',
    typical: [
      t('advertising_marketing', 'Lead platforms, signs, listing photography and mailers are advertising (line 8)', E.ads),
      t('vehicle_expense', 'Driving to showings and listings uses a mileage log; the daily drive to the brokerage office is commuting', E.mileage),
      t('dues_and_memberships', 'Board, MLS and association dues are deductible except the lobbying share the association reports each year', E.dues),
      N.licenses, N.gifts, N.ceMaintain,
      t('bank_and_payment_fees', 'Desk fees are rent (line 20b); referral fees and commission splits paid out are line 10', E.fees.concat(E.rent)),
    ],
    merchants: ['Zillow', 'Realtor.com', 'NAR', 'Supra', 'ShowingTime', 'dotloop', 'Costco', 'Shell'],
    auditTraps: [
      'Closing gifts over $25 per recipient.',
      'Commuting and personal errands inside the mileage log.',
      'Staging furniture and decor that ends up in personal use.',
    ],
    hints: {
      gift: { question: 'Who received this closing or client gift? Business gifts are capped at $25 per recipient per year; the excess is not deductible.' },
      fuel: { question: 'Was this fuel for driving to showings and listings, and do you use the standard mileage rate (fuel is already included) or actual expenses? What does your mileage log show?' },
    },
    notes: 'The nondeductible lobbying share of association dues comes from §162(e), which is outside the evidence packet; the association publishes the percentage.',
  },
  {
    id: 'rideshare_delivery_driver', label: 'Rideshare / delivery driver',
    keywords: ['rideshare', 'ride share', 'uber driver', 'lyft driver', 'uber', 'lyft', 'doordash', 'dasher', 'delivery driver', 'delivery', 'courier', 'instacart', 'grubhub', 'gig driver', 'driver', 'amazon flex', 'spark driver'],
    summary: 'Platform driving reported on a 1099-K/1099-NEC; the vehicle is the main deduction and the standard mileage rate usually dominates.',
    typical: [
      t('vehicle_expense', 'Standard mileage covers fuel, repairs, insurance, depreciation and car washes; only tolls and parking are added. App-on and en-route miles need a contemporaneous log; personal and commuting miles are out', E.mileage),
      t('supplies_small_tools', 'Phone mounts, chargers, insulated bags and passenger amenities are supplies (line 22)', E.supplies),
      N.phoneSplit, N.platformFees,
      t('meals_50', 'Your own meals and drinks during a shift are personal; no per diem applies to local driving', E.meals.concat(E.personal)),
    ],
    merchants: ['Shell', 'Chevron', 'Costco Gas', 'Jiffy Lube', 'Amazon', 'Verizon', 'E-ZPass', 'Everlance'],
    auditTraps: [
      'Fuel, repairs or insurance claimed on top of the standard mileage rate.',
      'Personal or commuting miles counted as app-on miles without a log.',
      'Own meals and drinks during shifts deducted as business meals.',
    ],
    hints: {
      fuel: { question: 'Do you use the standard mileage rate (fuel is already included, so this is not a separate deduction) or actual expenses (fuel counts at your business-use %)? What does your mileage log show for this period?' },
      auto_service: { question: 'Under the standard mileage rate repairs, oil changes and car washes are already included; under actual expenses they count at your business-use %. Which method do you use, and what is your logged business %?' },
      parking_tolls: { question: 'Tolls and parking during app-on trips are deductible in addition to the mileage rate. Was this during a delivery or ride, or personal driving?' },
      meal: { question: 'Your own meals and drinks during a shift are personal. Was this a passenger amenity, a business meeting, or your own meal?' },
      local_transport: { question: 'A ride you took yourself is personal unless it was a business errand; a credit from the platform is a payout (income at the gross amount). Which was this?' },
    },
    notes: 'Whether trips from home to the first pickup are business depends on the home qualifying as the principal place of business (Pub 463); the priors ask rather than assume.',
  },
  {
    id: 'trucker_owner_operator', label: 'Trucker (owner-operator)',
    keywords: ['trucker', 'truck driver', 'owner-operator', 'owner operator', 'cdl', 'hauler', 'freight', 'hotshot', 'trucking', 'long haul', 'otr driver', 'box truck', 'tow truck'],
    summary: 'Runs a tractor or heavy truck under own authority or leased on; actual vehicle costs, DOT per diem, permits and heavy-asset depreciation.',
    typical: [
      t('vehicle_expense', 'The standard mileage rate is for cars, vans, pickups and panel trucks; a tractor or heavy truck uses actual expenses: diesel, tires, repairs, insurance and depreciation at the business %', E.mileage.concat(E.assets)),
      t('meals_50', 'Meals on overnight trips away from home are 80% (not 50%) for drivers subject to DOT hours-of-service limits, using actual costs or the transportation-industry per diem with a days-away log', E.meals.concat(E.travel)),
      t('other', 'IFTA fuel tax, IRP plates, heavy vehicle use tax (Form 2290), UCR and permits are line 23; loan principal on the truck is not an expense', E.taxes),
      t('equipment', 'Tractor and trailer purchases are depreciated (§179/bonus at the business %); interest on the truck loan is line 16b', E.assets),
      N.liability, N.softwareBusiness,
    ],
    merchants: ['Pilot', "Love's", 'TA Petro', 'PrePass', 'DAT', 'Motive', 'IFTA', 'Progressive Commercial'],
    auditTraps: [
      'Meals claimed at 50% or in full instead of the 80% DOT rule with a days-away log.',
      'Truck payments deducted as an expense instead of depreciation plus interest.',
      'Personal vehicle and household fuel mixed into the truck fuel account.',
    ],
    hints: {
      fuel: { category: 'vehicle_expense', question: 'Diesel for the truck is an actual vehicle expense (the standard mileage rate does not apply to a tractor). Was this fuel for the business truck, and is the receipt kept for IFTA?' },
      meal: { question: 'Was this meal on a trip logged as away from home overnight? DOT hours-of-service drivers use the 80% limit with actual receipts or the transportation per diem; local meals are personal.' },
    },
    notes: 'The transportation-industry special per diem amount is published annually by the IRS and is not in the evidence packet; the priors do not state a dollar amount.',
  },
  {
    id: 'personal_trainer', label: 'Personal trainer / fitness instructor',
    keywords: ['personal trainer', 'fitness trainer', 'fitness instructor', 'fitness coach', 'health coach', 'yoga instructor', 'yoga teacher', 'pilates', 'group fitness', 'crossfit coach', 'strength coach', 'running coach', 'trainer', 'fitness', 'yoga', 'nutrition coach'],
    summary: 'Trains clients in a gym, studio or their homes; floor fees or space rent, certifications, liability insurance and client equipment.',
    typical: [
      t('rent', 'Floor fees or space rent paid to a gym or studio to train your own clients is rent (line 20b); your own gym membership is personal dues', E.rent.concat(E.dues)),
      t('education_training', 'Certification renewals and CE maintain current skills; the first certification that qualifies you to train is not deductible', E.education),
      N.liability,
      t('supplies_small_tools', 'Bands, mats and small equipment used only with clients are supplies; shared gear needs a business-use %', E.supplies),
      N.softwareBusiness, N.mileage,
      t('other', 'Workout clothing and shoes suitable for everyday wear are personal; supplements and food are personal', E.personal),
    ],
    merchants: ['Trainerize', 'Mindbody', 'NASM', 'ACE', 'Planet Fitness', 'Amazon', 'Lululemon', 'Hiscox'],
    auditTraps: [
      'Your own gym membership deducted as professional dues.',
      'Workout clothing, shoes and supplements.',
      'Rent paid for training space with no agreement or fee schedule from the gym.',
    ],
    hints: {
      gym: { category: 'rent', scheduleCLine: '20b', question: 'Is this a floor fee or space rent you pay to train your own clients here (business rent, with the gym\'s fee schedule or agreement), or your own membership (personal club dues)?' },
      clothing: { question: 'Workout clothing and shoes suitable for everyday wear are personal even when worn to train clients. Was this a branded uniform unusable off the job, or client equipment?' },
      sporting_goods: { category: 'supplies_small_tools', scheduleCLine: '22', question: 'Is this equipment used only with your clients (supplies), or also for your own training? Shared gear counts only at the business-use %.' },
    },
    notes: 'The everyday-wear clothing test comes from Pub 529 and case law rather than the evidence packet; it is applied as a question only.',
  },
  {
    id: 'hair_stylist_barber', label: 'Hair stylist / barber (booth renter)',
    keywords: ['hair stylist', 'hairstylist', 'stylist', 'barber', 'cosmetologist', 'colorist', 'salon', 'lash tech', 'lash artist', 'nail tech', 'nail technician', 'esthetician', 'makeup artist', 'braider', 'loctician', 'beautician'],
    summary: 'Rents a booth or suite and serves own clients; supplies used on clients, license renewals, booking software and retail product for resale.',
    typical: [
      t('rent', 'Booth, chair or suite rent is line 20b', E.rent),
      t('supplies_small_tools', 'Color, product and disposables used on clients are supplies; product bought for resale is cost of goods sold, not a supply until sold', E.supplies.concat(E.records)),
      N.licenses, N.ceMaintain,
      t('bank_and_payment_fees', 'Booking app and card-processing fees are line 10; tips received are income', E.fees.concat(E.records)),
      t('equipment', 'Chairs, dryers and styling stations are assets (de minimis at or under $2,500 per item)', E.assets),
      t('other', 'Your own hair, nails and grooming are personal even for client-facing work', E.personal),
    ],
    merchants: ['Sola Salon', 'Sally Beauty', 'CosmoProf', 'GlossGenius', 'Square', 'StyleSeat', 'Booksy', 'Amazon'],
    auditTraps: [
      'Tips left out of income.',
      'Personal hair, beauty services and clothing.',
      'Retail product inventory expensed as supplies while unsold.',
    ],
    hints: {
      beauty: { category: 'supplies_small_tools', scheduleCLine: '22', question: 'Was this product or service used on your own clients (supplies), or your own hair, nails or grooming (personal)?' },
    },
  },
  {
    id: 'massage_therapist', label: 'Massage therapist',
    keywords: ['massage therapist', 'massage', 'bodywork', 'lmt', 'acupuncturist', 'acupuncture', 'reflexolog', 'reiki', 'doula'],
    summary: 'Sessions in a rented room, own studio or clients\' homes; linens, oils, table equipment, license renewals and association coverage.',
    typical: [
      t('rent', 'Treatment room or suite rent is line 20b', E.rent),
      t('supplies_small_tools', 'Linens, oils, lotions and laundry for them are supplies (line 22)', E.supplies),
      t('equipment', 'Tables and chairs are assets (de minimis at or under $2,500 per item)', E.assets),
      N.licenses, N.ceMaintain,
      t('dues_and_memberships', 'Association dues that include liability coverage are deductible (dues line 27a or insurance line 15)', E.dues.concat(E.insurance)),
      N.mileage,
      t('other', 'Your own massages, spa treatments and wellness are personal', E.personal),
    ],
    merchants: ['Massage Warehouse', 'Earthlite', 'AMTA', 'ABMP', 'Vagaro', 'Square', 'Costco', 'Shell'],
    auditTraps: [
      'Your own massages or spa treatments claimed as research.',
      'A home treatment room that is not used exclusively for the business.',
      'Initial licensing school tuition (qualifies for a new trade).',
    ],
    hints: {
      beauty: { question: 'Was this a treatment you received (personal), or supplies and services for your own clients?' },
    },
  },
  {
    id: 'nurse_contractor', label: 'Nurse / travel nurse contractor (1099)',
    keywords: ['travel nurse', 'nurse', 'registered nurse', 'nurse practitioner', 'lpn', 'lvn', 'cna', 'crna', 'physician assistant', 'locum', 'home health', 'caregiver', 'medical contractor', 'dental hygienist', 'respiratory therapist', 'per diem nurse', 'agency nurse'],
    summary: 'Contract nursing paid on a 1099; deductions depend on having a tax home, licensure across states and uniforms.',
    typical: [
      t('travel', 'Lodging and meals on assignment count only if you keep a tax home whose costs you duplicate; without a tax home you are itinerant and travel is personal. An assignment expected to last more than one year is indefinite, not temporary', E.travel),
      N.licenses,
      t('education_training', 'CE hours and BLS/ACLS renewals maintain your license; a new degree or specialty credential may qualify for a new trade', E.education),
      t('other', 'Scrubs and shoes are deductible only if not suitable for everyday wear; malpractice insurance is line 15', E.personal.concat(E.insurance)),
      N.mileage, N.phoneSplit,
    ],
    merchants: ['Nursys', 'Furnished Finder', 'Airbnb', 'Delta', 'FIGS', 'ANA', 'AHA (BLS/ACLS)', 'Uber'],
    auditTraps: [
      'Agency W-2 income treated as self-employment, with Schedule C expenses against it.',
      'Lodging deducted without a tax home (itinerant) or with agency stipends already covering it.',
      'One-year-plus assignments at one location treated as temporary travel.',
    ],
    hints: {
      travel_lodging: { question: 'Do you maintain a permanent home whose costs continue while on this assignment, is the assignment expected to last one year or less, and did an agency stipend already cover housing?' },
      clothing: { question: 'Scrubs and protective footwear that cannot be worn off the job can qualify; ordinary clothing worn to work is personal. Which was this?' },
    },
  },
  {
    id: 'therapist_private_practice', label: 'Therapist / counselor in private practice',
    keywords: ['therapist', 'counselor', 'psychologist', 'psychotherapist', 'lcsw', 'lmft', 'lpc', 'mental health', 'social worker', 'psychiatrist', 'dietitian', 'nutritionist', 'speech therapist', 'speech-language', 'occupational therapist', 'physical therapist', 'chiropractor', 'private practice', 'behavior analyst', 'bcba'],
    summary: 'Sees clients in a rented office or by telehealth; practice-management software, licensure, CE, supervision and malpractice coverage.',
    typical: [
      t('rent', 'Office rent is line 20b; a home telehealth room qualifies only with regular and exclusive use', E.rent.concat(E.home)),
      t('software_subscriptions', 'Practice-management, telehealth and billing software are ordinary software (line 18)', E.software),
      N.licenses,
      t('education_training', 'CE required to keep the license qualifies; the degree or supervised hours that qualify you for licensure do not', E.education),
      t('other', 'Clinical supervision and consultation fees are professional services (line 17); malpractice is line 15; your own therapy is personal', E.professional.concat(E.insurance, E.personal)),
      N.professionalDues,
      t('advertising_marketing', 'Directory listings such as Psychology Today are advertising (line 8)', E.ads),
    ],
    merchants: ['SimplePractice', 'Psychology Today', 'Headway', 'Zoom', 'NASW', 'APA', 'Regus', 'Hiscox'],
    auditTraps: [
      'Your own therapy or wellness claimed as supervision.',
      'A home office shared with family life.',
      'Pre-licensure supervision and exam costs that qualify for the license.',
    ],
    hints: {
      education: { question: 'Does this course or supervision maintain a license you already hold (deductible CE), or does it count toward qualifying for licensure (not deductible)?' },
    },
  },
  {
    id: 'musician_performer', label: 'Musician / performer',
    keywords: ['musician', 'dj', 'singer', 'performer', 'actor', 'actress', 'band', 'music producer', 'producer', 'audio engineer', 'sound engineer', 'voice actor', 'voiceover', 'comedian', 'dancer', 'composer', 'songwriter', 'entertainer', 'magician'],
    summary: 'Gigs, sessions, royalties and merch; instruments and gear, software, travel to shows, agent commissions and union dues.',
    typical: [
      t('equipment', 'Instruments, PA and recording gear are assets: §179/bonus or depreciation over $2,500, de minimis at or under; instruments also played for pleasure need a business-use %', E.assets),
      t('software_subscriptions', 'DAWs, plugins and sample libraries are ordinary software (line 18)', E.software),
      t('travel', 'Gigs away from the tax home overnight are travel; local shows are vehicle mileage plus parking', E.travel.concat(E.mileage)),
      t('bank_and_payment_fees', 'Booking agent and manager commissions and distribution fees are line 10; royalties and streaming payouts are income', E.fees.concat(E.records)),
      t('dues_and_memberships', 'Union and performing-rights organization dues are deductible', E.dues),
      t('other', 'Stage costumes unusable off stage qualify; ordinary clothing worn to perform is personal', E.personal),
      t('rent', 'Rehearsal and studio space rent is line 20b', E.rent),
    ],
    merchants: ['Sweetwater', 'Guitar Center', 'Reverb', 'Splice', 'DistroKid', 'Bandcamp', 'AFM', 'Spotify (personal)'],
    auditTraps: [
      'Repeated losses with no profit motive (hobby-loss review).',
      'Stage clothing that doubles as everyday wear.',
      'Instruments played personally with no business-use percentage.',
    ],
    hints: {
      streaming: { question: 'Music streaming is personal even for a musician unless it is a paid distribution or promotion service. Which was this?' },
      clothing: { question: 'Only stage costumes that cannot be worn off stage qualify; ordinary clothing worn to perform is personal. Which was this?' },
    },
    notes: 'Hobby-loss review under §183 is outside the evidence packet; the priors flag it as a trap without applying it.',
  },
  {
    id: 'tutor_teacher', label: 'Tutor / teacher (self-employed)',
    keywords: ['tutor', 'online tutor', 'teacher', 'instructor', 'educator', 'test prep', 'music teacher', 'piano teacher', 'lecturer', 'corporate trainer', 'esl', 'language teacher', 'course creator', 'swim instructor', 'driving instructor'],
    summary: 'Teaches students directly or through platforms; materials, software, platform fees and travel to students.',
    typical: [
      N.softwareBusiness,
      t('supplies_small_tools', 'Books, workbooks and teaching materials for students are supplies (line 22)', E.supplies),
      N.platformFees, N.homeOffice, N.phoneSplit,
      t('vehicle_expense', 'Driving between students\' homes is business mileage; the trip from home to the first student is commuting unless the home office is the principal place of business', E.mileage),
      N.ceMaintain,
    ],
    merchants: ['Wyzant', 'Outschool', 'Zoom', 'Amazon', 'Canva', 'Best Buy', 'Teachers Pay Teachers', 'Google Workspace'],
    auditTraps: [
      'The $300 educator expense deduction belongs to W-2 K-12 teachers, not to Schedule C.',
      'Net platform payouts reported instead of the gross amount with fees deducted.',
      'A family-room home office.',
    ],
    hints: {
      education: { question: 'Does this course maintain your current teaching skills (deductible), or does it qualify you for a new credential or subject (not deductible)?' },
    },
    notes: 'The educator expense deduction is §62(a)(2)(D), outside the evidence packet; noted only to keep it off Schedule C.',
  },
  {
    id: 'ecommerce_seller', label: 'E-commerce seller',
    keywords: ['e-commerce', 'ecommerce', 'online store', 'store owner', 'etsy seller', 'etsy', 'amazon seller', 'amazon fba', 'shopify', 'reseller', 'dropship', 'print on demand', 'ebay seller', 'online seller', 'retail', 'merch', 'boutique', 'handmade', 'crafts'],
    summary: 'Sells goods online; inventory is cost of goods sold, platform fees are deducted from gross 1099-K sales, and packaging, shipping and ads are the running costs.',
    typical: [
      t('supplies_small_tools', 'Inventory and materials for products are cost of goods sold (Schedule C Part III) when sold, not supplies when bought; packaging and shipping supplies are line 22', E.records.concat(E.supplies)),
      t('bank_and_payment_fees', 'Report marketplace payouts at the gross 1099-K amount; seller, listing and processing fees are line 10', E.fees),
      t('advertising_marketing', 'Marketplace ads and social ads are advertising (line 8)', E.ads),
      N.softwareBusiness,
      t('home_office', 'Inventory storage space at home is deductible without the exclusive-use test when the home is the only fixed business location', E.home),
      t('other', 'Sales tax collected from buyers and remitted is neither income nor expense; sales tax you owe as the seller is line 23', E.taxes),
      t('other', 'Postage and shipping paid for orders is a business expense (line 27a) or part of cost of goods sold', E.general),
    ],
    merchants: ['Shopify', 'Etsy', 'Amazon Seller', 'Faire', 'Printful', 'Uline', 'Pirate Ship', 'USPS'],
    auditTraps: [
      'Inventory expensed when bought rather than as cost of goods sold when sold.',
      'Net payouts reported instead of the gross 1099-K amount with fees deducted.',
      'Household Amazon and Target orders on the business card.',
    ],
    hints: {
      general_merchandise: { category: 'supplies_small_tools', question: 'Was this inventory or materials for products you sell (cost of goods sold), packaging or shipping supplies (line 22), or a household purchase?' },
      postage: { category: 'supplies_small_tools', scheduleCLine: '22', question: 'Was this postage or shipping for customer orders, or personal mail?' },
    },
    notes: 'The small-business inventory method under §471(c) is outside the evidence packet; the priors keep inventory in cost of goods sold and ask.',
  },
  {
    id: 'handyman_contractor', label: 'Handyman / contractor',
    keywords: ['handyman', 'contractor', 'general contractor', 'plumber', 'electrician', 'carpenter', 'painter', 'roofer', 'hvac', 'remodel', 'construction', 'flooring', 'welder', 'mason', 'tile', 'drywall', 'home improvement', 'renovation', 'framer', 'fencing', 'locksmith', 'appliance repair'],
    summary: 'Job-by-job trade work; materials billed through, tools and equipment, a work truck, subcontractors, permits and liability insurance.',
    typical: [
      t('supplies_small_tools', 'Job materials and consumables are supplies (line 22) even when billed to the customer; the reimbursement is income', E.supplies.concat(E.records)),
      t('equipment', 'Tools at or under $2,500 per item can be expensed with the de minimis election; larger equipment is depreciated or §179', E.assets),
      t('vehicle_expense', 'The work truck uses actual expenses or the standard mileage rate, never both; a heavy truck over 6,000 lbs GVWR has different depreciation caps', E.mileage.concat(E.assets)),
      t('contract_labor', 'Subcontractors are line 11 with Form 1099-NEC at $2,000 or more; workers you control may be employees, not contractors', E.labor),
      N.licenses, N.liability,
      t('other', 'Steel-toe boots, hard hats and protective gear qualify; jeans and ordinary work shirts are personal; equipment rentals are line 20a', E.personal.concat(E.rent)),
    ],
    merchants: ['Home Depot', "Lowe's", 'Harbor Freight', 'Ferguson', 'Angi', 'Thumbtack', 'Sunbelt Rentals', 'Shell'],
    auditTraps: [
      'Workers treated as contractors without Form 1099-NEC or a classification review.',
      'Personal home-improvement purchases at the same stores.',
      'Truck costs claimed under both the standard mileage rate and actual expenses.',
    ],
    hints: {
      hardware: { category: 'supplies_small_tools', scheduleCLine: '22', question: 'Was this material or a tool for a customer job (supplies; tools over $2,500 are assets), or for your own home?' },
      clothing: { question: 'Protective gear and boots that cannot be worn off the job qualify; jeans and ordinary work clothes are personal. Which was this?' },
    },
  },
  {
    id: 'cleaner', label: 'Cleaner (residential / commercial)',
    keywords: ['cleaner', 'cleaning', 'house cleaner', 'housekeeper', 'housekeeping', 'janitorial', 'janitor', 'maid', 'carpet cleaning', 'pressure washing', 'window cleaning', 'organizer', 'home organizer'],
    summary: 'Cleans client homes or offices; supplies, small equipment, driving between sites, helpers, bonding and insurance.',
    typical: [
      t('supplies_small_tools', 'Cleaning products, cloths and disposables used at client sites are supplies (line 22); household supplies for your own home are personal', E.supplies.concat(E.personal)),
      t('equipment', 'Vacuums and machines are assets (de minimis at or under $2,500 per item)', E.assets),
      N.mileage, N.contractors, N.liability, N.licenses,
      t('other', 'Logo uniforms unusable off the job qualify; ordinary clothing is personal', E.personal),
      t('advertising_marketing', 'Lead services and local listings are advertising (line 8)', E.ads),
    ],
    merchants: ['Costco', 'Walmart', 'Home Depot', 'Amazon', 'Thumbtack', 'Shell', 'Hiscox', 'Square'],
    auditTraps: [
      'Household cleaning supplies for your own home mixed with job supplies.',
      'Helpers paid in cash with no Form 1099-NEC or records.',
      'Commuting miles counted as business miles.',
    ],
    hints: {
      groceries: { category: 'supplies_small_tools', scheduleCLine: '22', question: 'Were these cleaning supplies for client jobs (supplies), or groceries and household items (personal)?' },
      general_merchandise: { category: 'supplies_small_tools', scheduleCLine: '22', question: 'Were these cleaning supplies or equipment for client jobs, or household purchases?' },
    },
  },
  {
    id: 'landscaper', label: 'Landscaper / lawn care',
    keywords: ['landscaper', 'landscaping', 'lawn care', 'lawn', 'gardener', 'gardening', 'tree service', 'arborist', 'snow removal', 'pool service', 'pest control', 'irrigation', 'hardscape'],
    summary: 'Crews and equipment serving properties; mowers and trailers, equipment fuel, plants and materials, a work truck, crew labor and applicator licenses.',
    typical: [
      t('equipment', 'Mowers, trimmers and trailers are assets: §179/bonus or depreciation, de minimis at or under $2,500 per item', E.assets),
      t('supplies_small_tools', 'Fuel for mowers and equipment, plants, mulch and fertilizer for jobs are supplies, separate from truck fuel', E.supplies),
      t('vehicle_expense', 'The truck and trailer use actual expenses or the standard mileage rate, never both; equipment fuel is not a vehicle expense', E.mileage),
      N.contractors, N.licenses, N.liability,
      t('other', 'Equipment repairs are line 21; dump and disposal fees are line 27a', E.general),
    ],
    merchants: ['SiteOne', 'Home Depot', 'John Deere', 'Stihl dealer', 'Shell', 'Sunbelt Rentals', 'Angi', 'Progressive Commercial'],
    auditTraps: [
      'Equipment fuel and truck fuel commingled under a standard mileage claim.',
      'Crew paid as contractors without Form 1099-NEC or a classification review.',
      'Personal yard purchases at the same suppliers.',
    ],
    hints: {
      fuel: { question: 'Was this fuel for mowers and equipment (a supply, line 22) or for the truck (vehicle expense under your chosen method)? Keep the split on the receipt.' },
      hardware: { category: 'supplies_small_tools', scheduleCLine: '22', question: 'Were these plants, materials or tools for a customer job, or for your own yard?' },
    },
    notes: 'Any off-highway fuel excise credit (Form 4136) is outside the evidence packet and is not applied.',
  },
  {
    id: 'notary_signing_agent', label: 'Notary / loan signing agent',
    keywords: ['notary', 'loan signing', 'signing agent', 'notary public', 'mobile notary', 'process server', 'fingerprinting'],
    summary: 'Mobile signings paid per appointment; commission and bond costs, a dual-tray printer and supplies, mileage and platform fees.',
    typical: [
      t('other', 'Notary commission, background check, surety bond and E&O are line 23 and line 15', E.taxes.concat(E.insurance)),
      t('equipment', 'A dual-tray laser printer and scanner are assets (de minimis at or under $2,500 per item); paper, toner, stamps and journals are supplies', E.assets.concat(E.supplies)),
      N.mileage, N.platformFees, N.phoneSplit, N.professionalDues,
    ],
    merchants: ['NNA', 'Snapdocs', 'Signing Order', 'Staples', 'Amazon', 'Shell', 'USPS', 'Notary Rotary'],
    auditTraps: [
      'Fees for notarial acts are exempt from self-employment tax on Schedule SE, but signing-agent service fees are not; the split needs records.',
      'Home printer, paper and internet used personally claimed in full.',
      'Signing mileage with no contemporaneous log.',
    ],
    notes: 'The notary SE-tax exemption comes from the Schedule SE instructions, outside the evidence packet; the priors flag it for the return, not for expense grounding.',
  },
  {
    id: 'bookkeeper', label: 'Bookkeeper / accountant / tax preparer',
    keywords: ['bookkeeper', 'bookkeeping', 'accountant', 'accounting', 'cpa', 'tax preparer', 'tax professional', 'tax consultant', 'tax advisor', 'enrolled agent', 'payroll', 'controller', 'cfo', 'financial analyst'],
    summary: 'Client bookkeeping and tax work; accounting and tax software, CPE, credential renewals, E&O and a home office.',
    typical: [
      t('software_subscriptions', 'Accounting, payroll and tax software used for clients is ordinary software (line 18)', E.software),
      t('education_training', 'CPE required to keep a credential qualifies; CPA or EA exam review that qualifies for the credential does not', E.education),
      N.licenses, N.professionalDues, N.liability, N.homeOffice, N.phoneSplit,
      t('other', 'Fees you pay on a client\'s behalf and are reimbursed for are income and expense, not a net item', E.records),
    ],
    merchants: ['Intuit', 'Xero', 'Drake', 'AICPA', 'NATP', 'IRS PTIN', 'Hiscox', 'Zoom'],
    auditTraps: [
      'CPA or EA exam preparation and review courses (qualify for a new credential).',
      'A home office shared with personal use.',
      'Client filing fees paid and reimbursed netted out of income.',
    ],
    hints: {
      education: { question: 'Is this CPE that maintains a credential you already hold (deductible), or exam review that qualifies you for a new credential (not deductible)?' },
    },
  },
  {
    id: 'insurance_agent', label: 'Insurance agent / financial advisor',
    keywords: ['insurance agent', 'insurance broker', 'insurance', 'financial advisor', 'financial planner', 'financial consultant', 'wealth', 'annuity', 'life insurance', 'medicare agent', 'benefits broker', 'registered representative'],
    summary: 'Commission-based sales under carrier appointments; licensing, E&O, lead generation, client meals and gifts, and driving to clients.',
    typical: [
      t('other', 'State licenses, appointments and CE are line 23 and line 27a; E&O is line 15', E.taxes.concat(E.insurance, E.education)),
      t('advertising_marketing', 'Leads, mailers and seminars promoting your practice are advertising (line 8)', E.ads),
      N.clientMeals, N.gifts, N.mileage, N.softwareBusiness, N.homeOffice,
      t('bank_and_payment_fees', 'Commission chargebacks reduce income; a full-time life insurance agent may be a statutory employee whose Schedule C income is not subject to SE tax', E.records),
    ],
    merchants: ['NIPR', 'Sircon', 'Kaplan', 'Hiscox', 'Zoom', 'Salesforce', 'Costco', 'Shell'],
    auditTraps: [
      'Client gifts over $25 per recipient and entertainment such as tickets.',
      'Commuting miles to the agency office.',
      'Statutory-employee W-2 income misreported as ordinary self-employment.',
    ],
    hints: {
      gift: { question: 'Who received this client gift and what is the business relationship? Business gifts are capped at $25 per recipient per year.' },
      meal: { question: 'Which client or prospect attended and what business was discussed? A meal alone or entertainment such as tickets is not deductible.' },
    },
  },
  {
    id: 'influencer_content_creator', label: 'Influencer / content creator',
    keywords: ['influencer', 'content creator', 'creator', 'youtuber', 'youtube', 'streamer', 'twitch', 'tiktok', 'tiktoker', 'podcaster', 'podcast', 'vlogger', 'onlyfans', 'social media personality', 'instagram', 'ugc creator'],
    summary: 'Brand deals, ad revenue and affiliate income; gear and software with a strict personal boundary around clothing, beauty, meals and travel.',
    typical: [
      t('other', 'Clothing, makeup, hair and nails worn on camera are personal when suitable for everyday wear; only costumes unusable off camera qualify', E.personal),
      t('equipment', 'Cameras, lights, mics and phones: §179/bonus or depreciation over $2,500, de minimis at or under; a shared phone needs a business-use %', E.assets),
      t('other', 'Free products and trips received for promotion are income at fair market value', E.records),
      t('travel', 'Content trips need a business purpose beyond the trip itself; filmed vacations and meals are personal', E.travel.concat(E.meals)),
      t('software_subscriptions', 'Editing, scheduling and design tools are ordinary software (line 18)', E.software),
      t('bank_and_payment_fees', 'Platform, agency and management commissions are line 10; report brand-deal income at the gross amount', E.fees),
      t('home_office', 'A filming room qualifies only with regular and exclusive business use', E.home),
    ],
    merchants: ['Meta Ads', 'Canva', 'CapCut', 'Adobe', 'B&H Photo', 'Amazon', 'Sephora (personal)', 'Airbnb'],
    auditTraps: [
      'Clothing, makeup, hair and nails claimed because they appear on camera.',
      'Free products and trips received for promotion left out of income.',
      'Vacation-style travel and restaurant meals labelled content.',
    ],
    hints: {
      clothing: { question: 'Clothing worn on camera is personal when suitable for everyday wear; only costumes or items unusable off camera qualify. Which was this, and was it a product you were paid to feature (income)?' },
      beauty: { question: 'Hair, makeup and nails are personal even for on-camera work. Was this a stylist hired for a specific paid production instead?' },
      meal: { question: 'A filmed meal is still a personal meal unless it qualifies as a business meal with a client or collaborator. Who attended and what was the business purpose?' },
      streaming: { question: 'Streaming and music services are personal unless licensed for use in your published content. Was this a content license?' },
      travel_lodging: { question: 'What paid brand deal or production required this stay, and which nights were personal? A trip filmed for content is not by itself business travel.' },
    },
    notes: 'The everyday-wear clothing test comes from Pub 529 and case law rather than the evidence packet; it is applied as a question only.',
  },
  {
    id: 'virtual_assistant', label: 'Virtual assistant',
    keywords: ['virtual assistant', 'executive assistant', 'administrative', 'admin support', 'data entry', 'customer support', 'transcription', 'online business manager', 'obm', 'scheduler', 'receptionist'],
    summary: 'Remote admin support for clients billed hourly or by retainer; software, a home office, phone/internet and platform fees.',
    typical: [
      N.softwareBusiness, N.homeOffice, N.phoneSplit, N.computerAsset, N.platformFees, N.ceMaintain, N.liability,
    ],
    merchants: ['Google Workspace', 'Zoom', 'Upwork', 'Fiverr', 'Notion', '1Password', 'Apple', 'Best Buy'],
    auditTraps: [
      'Home internet and phone claimed at 100%.',
      'Upwork or Fiverr net payouts reported instead of the gross amount with fees deducted.',
      'A shared family computer expensed in full.',
    ],
    hints: {
      phone_internet: { question: 'What share of this plan is used for client work, and what supports that split? Home internet and phone count only at the documented business-use %.' },
    },
  },
  {
    id: 'other_general', label: 'Other self-employed (no profession-specific priors)',
    keywords: ['other', 'self-employed', 'self employed', 'freelancer', 'freelance', 'sole proprietor', 'small business', 'business owner', 'gig worker', 'independent contractor', 'entrepreneur'],
    summary: 'No profession-specific priors; apply the ordinary-and-necessary test with the merchant intelligence and ask for the business purpose.',
    typical: [
      t('other', 'An expense must be ordinary and necessary for the existing business; the merchant and the account never establish the purpose', E.general),
      t('other', 'Personal, living and family costs stay out even when they help the work', E.personal),
      N.homeOffice, N.phoneSplit,
    ],
    merchants: [],
    auditTraps: [
      'Personal purchases on a business card treated as deductible by default.',
      'Mixed-use items claimed in full without an allocation.',
      'No business purpose recorded for recurring charges.',
    ],
  },
];

const PRIORS_BY_ID = new Map(PROFESSION_PRIORS.map(prior => [prior.id, prior]));
export const OTHER_GENERAL_PRIOR = PRIORS_BY_ID.get('other_general')!;

export interface ProfessionMatch { prior: ProfessionPrior; keyword: string }

const normalizeProfession = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9/&+\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const keywordPattern = (keyword: string) => new RegExp(`(?:^|[^a-z0-9])${escape(keyword)}(?:s|es|ing)?(?![a-z0-9])`, 'i');

/**
 * Fuzzy match on a free-text or option-list profession. The longest matching keyword wins so that
 * "fitness coach" reaches the trainer and "business coach" the consultant; ties keep table order.
 * Returns null when nothing matches (callers fall back to OTHER_GENERAL_PRIOR).
 */
export function matchProfession(profileProfession: string | null | undefined): ProfessionMatch | null {
  const normalized = typeof profileProfession === 'string' ? normalizeProfession(profileProfession) : '';
  if (!normalized) return null;
  const scan = (priors: readonly ProfessionPrior[]) => {
    let best: ProfessionMatch | null = null;
    for (const prior of priors) {
      for (const keyword of prior.keywords) {
        if (!keywordPattern(keyword).test(normalized)) continue;
        if (!best || keyword.length > best.keyword.length) best = { prior, keyword };
      }
    }
    return best;
  };
  // Generic words such as "freelance" only apply when no specific profession matched.
  return scan(PROFESSION_PRIORS.filter(prior => prior.id !== 'other_general')) ?? scan([OTHER_GENERAL_PRIOR]);
}

/** Distinct priors for the profile's profession list, in profile order; other_general when text is present but unmatched. */
export function matchProfessions(professions: string | readonly string[] | null | undefined): ProfessionPrior[] {
  const values = Array.isArray(professions) ? professions : typeof professions === 'string' ? professions.split(',') : [];
  const matched: ProfessionPrior[] = [];
  let unmatchedText = false;
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const match = matchProfession(value);
    if (!match) { unmatchedText = true; continue; }
    if (!matched.includes(match.prior)) matched.push(match.prior);
  }
  if (!matched.length && unmatchedText) matched.push(OTHER_GENERAL_PRIOR);
  return matched;
}

/** The profession-specific reading of a merchant signal, from the first matched profession that has one. */
export function professionHint(priors: readonly ProfessionPrior[], subtype: MerchantSubtype | null | undefined): ProfessionMerchantHint | null {
  if (!subtype) return null;
  for (const prior of priors) {
    const hint = prior.hints?.[subtype];
    if (hint) return hint;
  }
  return null;
}

export const PROFESSION_CONTEXT_LIMIT = 900;

interface BlockPlan { categories: number; traps: number; summary: boolean; merchants: boolean }
function professionBlock(prior: ProfessionPrior, plan: BlockPlan): string {
  const typical = prior.typical.slice(0, plan.categories).map(item => `${item.category}: ${item.nuance}`).join('; ');
  const parts = [plan.summary ? `${prior.label} — ${prior.summary}` : `${prior.label}.`, `Typical: ${typical}.`];
  if (plan.traps > 0) parts.push(`Traps: ${prior.auditTraps.slice(0, plan.traps).join(' ')}`);
  if (plan.merchants && prior.merchants.length) parts.push(`Merchants: ${prior.merchants.slice(0, 6).join(', ')}.`);
  return parts.join(' ');
}
/** Detail order of preference: category nuances, then traps, then the summary, then merchants. */
const SINGLE_PLANS: BlockPlan[] = [
  { categories: 7, traps: 3, summary: true, merchants: true }, { categories: 7, traps: 3, summary: true, merchants: false },
  { categories: 6, traps: 3, summary: true, merchants: false }, { categories: 6, traps: 3, summary: false, merchants: false },
  { categories: 5, traps: 3, summary: false, merchants: false }, { categories: 5, traps: 2, summary: false, merchants: false },
  { categories: 4, traps: 2, summary: false, merchants: false }, { categories: 4, traps: 1, summary: false, merchants: false },
  { categories: 3, traps: 1, summary: false, merchants: false }, { categories: 2, traps: 1, summary: false, merchants: false },
  { categories: 2, traps: 0, summary: false, merchants: false }, { categories: 1, traps: 0, summary: false, merchants: false },
];
const PAIR_PLANS: BlockPlan[] = [
  { categories: 3, traps: 1, summary: false, merchants: false }, { categories: 2, traps: 1, summary: false, merchants: false },
  { categories: 2, traps: 0, summary: false, merchants: false }, { categories: 1, traps: 0, summary: false, merchants: false },
];

/**
 * Compact, model-facing profession context (at most PROFESSION_CONTEXT_LIMIT characters). Up to two
 * matched professions are described; detail is trimmed until the text fits. Priors are hints for
 * category choice and questions only; the note reminds the model they never establish eligibility.
 */
export function professionContextForModel(profile: { profession?: string | readonly string[] | null } | null | undefined, limit = PROFESSION_CONTEXT_LIMIT): string | null {
  const priors = matchProfessions(profile?.profession).slice(0, 2);
  if (!priors.length) return null;
  const suffix = ' Priors never establish that a purchase was for business.';
  const budget = limit - suffix.length;
  let body: string | null = null;
  for (const plan of priors.length === 1 ? SINGLE_PLANS : PAIR_PLANS) {
    const candidate = priors.map(prior => professionBlock(prior, plan)).join('\n');
    if (candidate.length <= budget) { body = candidate; break; }
  }
  if (body === null) {
    const single = professionBlock(priors[0], { categories: 1, traps: 0, summary: false, merchants: false });
    const cut = single.slice(0, budget);
    body = cut.slice(0, Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), 0) + 1) || cut.trimEnd();
  }
  return `${body}${suffix}`;
}
