import { resolveStateCode } from './registry';
import type { StateSource } from './types';

/**
 * Informational notice about a separate business or local tax. Nothing is calculated:
 * the notice is triggered only by the saved state and, where a locality is required,
 * by the saved city. Thresholds and rates are quoted from the administering agency.
 */
export interface BusinessTaxNotice {
  id: 'wa-bo' | 'nyc-ubt' | 'portland-multnomah' | 'philadelphia-birt-npt' | 'oh-cat';
  jurisdiction: string;
  title: string;
  summary: string;
  /** Whether the state alone or the saved city triggered the notice. */
  basis: 'state' | 'city';
  sources: readonly StateSource[];
}

export interface BusinessTaxNoticeInput {
  stateCode: unknown;
  /** Optional saved city (profile mailing address). Localities are never inferred. */
  city?: unknown;
  taxYear?: number;
}

const normalizeCity = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ') : '');

// New York City boroughs as commonly written in a mailing address (nyc.gov UBT applies citywide).
const NYC_CITY_NAMES = new Set(['new york', 'new york city', 'nyc', 'manhattan', 'brooklyn', 'bronx', 'the bronx', 'queens', 'staten island']);
// Localities named on the Portland Revenue Division page: Portland is inside both jurisdictions;
// Gresham, Troutdale and Corbett are Multnomah County only.
const PORTLAND_CITY = 'portland';
const MULTNOMAH_ONLY_CITIES = new Set(['gresham', 'troutdale', 'corbett']);
const PHILADELPHIA_CITY = 'philadelphia';

const money = (n: number) => `$${n.toLocaleString('en-US')}`;

function portlandExemptionThreshold(taxYear: number | undefined): number {
  if (taxYear === undefined || taxYear < 2026) return 50000;
  return taxYear === 2026 ? 75000 : 100000;
}

/** Notices for the saved state and optional city; an empty array when nothing applies. */
export function businessTaxNotices(input: BusinessTaxNoticeInput): BusinessTaxNotice[] {
  const stateCode = resolveStateCode(input.stateCode);
  if (!stateCode) return [];
  const city = normalizeCity(input.city);
  const notices: BusinessTaxNotice[] = [];

  if (stateCode === 'WA') {
    notices.push({
      id: 'wa-bo', jurisdiction: 'Washington', basis: 'state',
      title: 'Washington business and occupation (B&O) tax',
      summary: 'Washington has no individual income tax, but most businesses, including sole proprietors, owe the B&O tax on gross receipts by business classification. It allows no deduction for expenses, so it can be owed in a loss year. It is not part of the state income tax estimate.',
      sources: [{
        url: 'https://dor.wa.gov/taxes-rates/business-occupation-tax',
        note: 'Washington Department of Revenue: the B&O tax is a gross receipts tax measured on the value of products, gross proceeds of sale or gross income of the business, with no deduction for labor, materials or other business costs; rates depend on classification.',
      }],
    });
  }

  if (stateCode === 'NY' && NYC_CITY_NAMES.has(city)) {
    notices.push({
      id: 'nyc-ubt', jurisdiction: 'New York City', basis: 'city',
      title: 'New York City unincorporated business tax (UBT)',
      summary: 'An individual carrying on a business in New York City with total gross business income over $95,000 must file a UBT return (NYC-202 or NYC-202S). The tax is 4% of business taxable income allocated to the city after a $5,000 exemption; a credit eliminates a liability of $3,400 or less and partially offsets liabilities up to $5,400. The MCTMT on net earnings from self-employment in the metropolitan commuter transportation district and the New York City resident income tax are also separate from this estimate.',
      sources: [
        {
          url: 'https://www.nyc.gov/site/finance/business/business-unincorporated-business-tax-ubt.page',
          note: 'NYC Department of Finance: 4% UBT rate on taxable income allocated to New York City; full credit for a liability of $3,400 or less and partial credit between $3,401 and $5,400.',
        },
        {
          url: 'https://www.nyc.gov/assets/finance/downloads/pdf/25pdf/business_tax_forms/nyc-202-instr_2025.pdf',
          note: '2025 Form NYC-202 instructions: an individual with total gross income from all business of more than $95,000 must file; line 15 unincorporated business exemption of $5,000.',
        },
        {
          url: 'https://www.tax.ny.gov/bus/mctmt/selfemp.htm',
          note: 'New York State Department of Taxation and Finance: MCTMT for self-employed individuals; Zone 1 is the five New York City counties.',
        },
      ],
    });
  }

  if (stateCode === 'OR' && (city === PORTLAND_CITY || MULTNOMAH_ONLY_CITIES.has(city))) {
    const inPortland = city === PORTLAND_CITY;
    const threshold = portlandExemptionThreshold(input.taxYear);
    notices.push({
      id: 'portland-multnomah', jurisdiction: inPortland ? 'Portland and Multnomah County' : 'Multnomah County', basis: 'city',
      title: inPortland ? 'Portland business license tax and Multnomah County business income tax' : 'Multnomah County business income tax',
      summary: `${inPortland
        ? `Sole proprietors doing business in Portland must register with the Revenue Division and file a business tax return each year, even when exempt. The Portland business license tax is 2.6% of net business income and is not owed when gross receipts from all business are under ${money(threshold)}${input.taxYear ? ` for tax year ${input.taxYear}` : ''}. `
        : 'Sole proprietors doing business in Multnomah County must register with the Portland Revenue Division and file a business tax return each year, even when exempt. '
      }The Multnomah County business income tax is 2% of net business income and is not owed when gross receipts from all business are under $100,000. Sole proprietors are not liable for the Metro supportive housing services business income tax but are subject to the Metro SHS personal income tax, which is separate from this estimate.`,
      sources: [{
        url: 'https://www.portland.gov/revenue/business-tax',
        note: 'City of Portland Revenue Division: business license tax 2.6% and Multnomah County business income tax 2%; Portland exemption for gross receipts under $50,000 (tax years before 2026), $75,000 (2026) and $100,000 (2027 and later); Multnomah County exemption under $100,000; exempt filers must still file; sole proprietors owe the Metro SHS personal income tax rather than the business tax.',
      }],
    });
  }

  if (stateCode === 'PA' && city === PHILADELPHIA_CITY) {
    notices.push({
      id: 'philadelphia-birt-npt', jurisdiction: 'Philadelphia', basis: 'city',
      title: 'Philadelphia business income and receipts tax (BIRT) and net profits tax (NPT)',
      summary: 'Sole proprietors doing business in Philadelphia must file a BIRT return every year regardless of profit; the $100,000 gross receipts exemption no longer applies as of tax year 2025 (1.410 mills on gross receipts plus 5.71% on taxable net income for 2025). Philadelphia residents also owe the NPT on all net profits (3.74% for 2025; 3.43% for nonresidents on Philadelphia activity), and a return is required even in a loss year. Neither tax is part of this state income tax estimate.',
      sources: [
        {
          url: 'https://www.phila.gov/services/payments-assistance-taxes/taxes/business-taxes/business-taxes-by-type/business-income-receipts-tax-birt/',
          note: 'City of Philadelphia: tax year 2025 BIRT rates of 1.410 mills on gross receipts and 5.71% on taxable net income; the $100,000 exemption is no longer offered as of tax year 2025; every individual engaged in business in the city must file.',
        },
        {
          url: 'https://www.phila.gov/services/payments-assistance-taxes/taxes/business-taxes/business-taxes-by-type/net-profits-tax/',
          note: 'City of Philadelphia: tax year 2025 NPT of 3.74% (resident) and 3.43% (nonresident) of net profits; a return must be filed even if a loss is incurred.',
        },
      ],
    });
  }

  if (stateCode === 'OH') {
    notices.push({
      id: 'oh-cat', jurisdiction: 'Ohio', basis: 'state',
      title: 'Ohio commercial activity tax (CAT) does not apply under $6 million of receipts',
      summary: 'For tax years 2025 and later the Ohio CAT applies only to businesses with more than $6 million of Ohio taxable gross receipts; businesses at or below that amount are excluded and do not need to register or file. Ohio municipal and school district income taxes are separate returns and are not included in this estimate.',
      sources: [{
        url: 'https://tax.ohio.gov/business/commercial-activity-tax',
        note: 'Ohio Department of Taxation: for tax years 2025 and forward, businesses with more than $6 million a year in Ohio taxable gross receipts must pay the CAT; businesses with $6 million or less are excluded.',
      }],
    });
  }

  return notices;
}
