import { parseCalendarDay } from '@/lib/dates/calendar-day';

/**
 * Dollar amounts and mileage rates stay off the page until tax sign-off.
 * Pricing math still runs in lib/tools/gig-mileage-gap.ts. Set this to true
 * to render that dollar view.
 */
export const SHOW_DEDUCTION_ESTIMATE = false;

/**
 * Every user-facing string for the gig mileage gap calculator.
 * Review and approve this file as a set. The page imports copy from here
 * instead of writing sentences inline.
 */
export const GIG_MILEAGE_GAP_COPY = {
  title: 'Gig Mileage Gap Calculator',
  metaDescription:
    'Compare gig-app on-trip miles with your odometer for a date range. See the mileage gap, how it splits, and the miles to review against your log. Free, in your browser.',
  ogTitle: 'Gig Mileage Gap Calculator | WriteOff',
  ogDescription:
    'See the gap between gig-app on-trip miles and your odometer, and the miles to review against your log.',
  twitterTitle: 'Gig Mileage Gap Calculator',
  twitterDescription:
    'Free browser calculator for the gap between gig-app miles and your odometer, in miles.',
  ogImageAlt: 'WriteOff',
  siteName: 'WriteOff',
  canonicalPath: '/tools/gig-mileage-gap-calculator',
  siteUrl: 'https://writeoffapp.com',
  pageUrl: 'https://writeoffapp.com/tools/gig-mileage-gap-calculator',
  jsonLdName: 'Gig Mileage Gap Calculator',
  jsonLdDescription:
    'Free in-browser calculator that compares on-trip miles reported by gig apps with odometer miles for a date range and shows the miles to review against your log.',
  freeBadge: 'Free tool',
  h1: 'Gig Mileage Gap Calculator',
  intro:
    'Enter the miles a gig app reported for trips, the extra miles you drove, and your odometer for the same dates. The gap is calculated in your browser.',
  privacyNote: 'Nothing you type is saved, and this page does not send it anywhere.',
  formTitle: 'Miles for this period',
  formDescription: 'Use miles for one date range. Leave a box blank until you know the number.',
  startDateLabel: 'Start date',
  endDateLabel: 'End date',
  startDateHelp: 'First day of the period, as a calendar date.',
  endDateHelp: 'Last day of the period, as a calendar date.',
  onTripLabel: 'Miles gig apps reported (on trip)',
  onTripHelp: 'Miles the gig apps counted while you had a rider or a delivery.',
  toPickupLabel: 'Miles driving to pickups',
  toPickupHelp: 'Miles driven to reach a pickup, not included in the app on-trip total.',
  commuteLabel: 'Miles from home to the first pickup and from the last drop-off home',
  commuteHelp: 'The drive from home to the first pickup plus the drive from the last drop-off back home.',
  waitingLabel: 'Miles online and waiting',
  waitingHelp: 'Miles driven while you were online and waiting for a request.',
  odometerLabel: 'Odometer miles for this period',
  odometerHelp: 'Ending odometer minus starting odometer for these dates.',
  homeOfficeLabel: 'I have a qualifying home office',
  homeOfficeHelp:
    'Check this only if you have a qualifying home office. Otherwise those home miles stay out of the estimated deduction.',
  invalidDate: 'Enter the start and end dates as YYYY-MM-DD.',
  endBeforeStart: 'The end date is earlier than the start date.',
  invalidMiles: 'Enter miles as a number that is zero or greater.',
  emptyResult: 'Enter the dates and miles to see the gap.',
  resultsTitle: 'Mileage gap',
  gapLabel: 'Mileage gap',
  gapHelp: 'Odometer miles minus the on-trip miles gig apps reported.',
  gapSplitTitle: 'How the gap splits',
  gapToPickup: 'Driving to pickups',
  gapCommute: 'Home to the first pickup and last drop-off to home',
  gapWaiting: 'Online and waiting',
  gapUnexplained: 'Not listed in the entries above',
  unexplainedNote: 'These miles are not part of the miles to review against your log.',
  gapOver: 'The listed miles add up to more than the gap.',
  waitingNotice: "The IRS hasn't ruled on this",
  waitingDetail: 'Online and waiting miles are shown separately and are not counted in the miles to review against your log.',
  commuteSeparate:
    'Shown separately and not counted in the miles to review against your log. For a typical driver with no home office or regular work location, the drive from home to the first pickup and from the last drop-off home is commuting (Rev. Rul. 99-7).',
  commuteExcluded:
    'These miles are shown here and are not included in the estimated deduction. For a typical driver with no home office or regular work location, the drive from home to the first pickup and from the last drop-off home is commuting (Rev. Rul. 99-7).',
  commuteIncluded:
    'You checked that you have a qualifying home office, so these miles are included in the estimated deduction. Without that, Rev. Rul. 99-7 treats the drive from home to the first pickup and from the last drop-off home as commuting for a typical driver with no home office or regular work location.',
  reviewOnTrip: 'On-trip miles',
  milesToReviewLabel: 'miles to review against your log',
  milesToReviewHelp: 'On-trip miles plus miles driving to pickups.',
  businessMilesLabel: 'Business miles in the estimated deduction',
  businessMilesHelp: 'On-trip miles plus miles driving to pickups.',
  businessMilesHelpHome: 'On-trip miles, miles driving to pickups, and the home miles above.',
  estimatedDeductionLabel: 'Estimated deduction that lowers taxable income',
  ratePending: 'Rate pending',
  ratePendingDetail:
    'No dollar amount is shown for this part because a standard mileage rate has not been published for these dates.',
  ratedPortionNote:
    'This amount includes only periods with a published rate. Any other period on this page is marked Rate pending and has no dollar amount.',
  splitPromptGeneric:
    'This date range covers more than one mileage-rate period. Enter miles for each period. Each portion is priced only after you enter that split.',
  splitPromptJuly:
    'This date range crosses July 1, 2026, when the standard mileage rate changes. Enter miles for each period. Each portion is priced only after you enter that split.',
  splitMismatch: 'Miles entered for the periods do not add up to the miles for the full date range.',
  splitNeededForPeriod: 'Enter the miles for this period before it is priced.',
  periodOnTrip: 'On-trip miles in this period',
  periodToPickup: 'Miles driving to pickups in this period',
  periodCommute: 'Home miles in this period',
  periodLegend: 'Miles by rate period',
  logNotice:
    "An odometer total isn't a mileage log. The deduction needs a record for each trip (IRC section 274(d), Treas. Reg. 1.274-5T(c)(2)(ii)(A)).",
  signupLink: 'Sign up to keep a record for each trip',
  signupHref: '/auth/sign-up',
  notTaxAdvice: 'General information, not tax advice.',
  howTitle: 'What this calculator uses',
  howBody:
    'The gap is odometer miles minus the on-trip miles a gig app reported. Miles to review against your log are on-trip miles plus miles driving to pickups. The drive from home and back is shown separately and is not counted. Miles online and waiting are shown separately and are not counted.',
  howBodyDeduction:
    'Business miles are priced with the standard mileage rate for the date of the trip. On-trip miles and miles driving to pickups are included. Home miles are included only when the qualifying home office box is checked. Miles online and waiting are not added to the total.',
  toolsIndexTitle: 'Gig Mileage Gap Calculator',
  toolsIndexDescription:
    'Compare gig-app on-trip miles with your odometer, split the gap, and see the miles to review against your log. Runs in the browser.',
  toolsIndexBadge: 'Free',
  footerNavLabel: 'Footer',
  footerAbout: 'About',
  footerBlog: 'Blog',
  footerPrivacy: 'Privacy',
  footerContact: 'Contact',
  aboutHref: '/about',
  blogHref: '/blog',
  privacyHref: '/privacy',
  contactHref: '/contact',
  copyrightMark: '©',
  copyrightLine: 'WriteOff. All rights reserved.',
  milesUnit: 'miles',
  through: 'through',
  centsPerMile: 'cents per mile',
} as const;

export const GIG_MILEAGE_GAP_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function formatMileageRateCents(ratePerMile: number): string {
  const tenths = Math.round(ratePerMile * 1000);
  const whole = Math.trunc(tenths / 10);
  const fraction = Math.abs(tenths % 10);
  const cents = fraction === 0 ? String(whole) : `${whole}.${fraction}`;
  return `${cents} ${GIG_MILEAGE_GAP_COPY.centsPerMile}`;
}

export function formatGigMileageGapDate(ymd: string): string {
  const parsed = parseCalendarDay(ymd);
  if (!parsed) return ymd;
  return `${GIG_MILEAGE_GAP_MONTHS[parsed.month - 1]} ${parsed.day}, ${parsed.year}`;
}

export function formatGigMileageGapPeriod(from: string, to: string): string {
  if (from === to) return formatGigMileageGapDate(from);
  return `${formatGigMileageGapDate(from)} ${GIG_MILEAGE_GAP_COPY.through} ${formatGigMileageGapDate(to)}`;
}

function visitCopy(value: unknown, found: string[]): void {
  if (typeof value === 'string') {
    found.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(item => visitCopy(item, found));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => visitCopy(item, found));
  }
}

/** Flat list of the copy, including composed dates and rate labels the page can show. */
export function listGigMileageGapCopy(): string[] {
  const found: string[] = [];
  visitCopy(GIG_MILEAGE_GAP_COPY, found);
  visitCopy(GIG_MILEAGE_GAP_MONTHS, found);
  found.push(formatGigMileageGapPeriod('2026-06-30', '2026-06-30'));
  found.push(formatGigMileageGapPeriod('2026-06-30', '2026-07-01'));
  found.push(formatGigMileageGapPeriod('2027-01-01', '2027-01-31'));
  for (const rate of [0.67, 0.7, 0.725, 0.76]) found.push(formatMileageRateCents(rate));
  return found;
}
