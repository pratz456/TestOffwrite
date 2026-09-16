import type { UserProfile } from '@/lib/firebase/profiles-server';
import { type Asset, calc4562 } from './calc4562';
import { createPlanningPDF, formatExportMoney as money } from './planning-pdf';
export interface Form4562Data { userProfile: UserProfile; assetsSettings: Asset[]; transactions: unknown[]; taxYear: number; }
export async function generateForm4562PDF(data: Form4562Data): Promise<Uint8Array> {
  const c = calc4562(data.assetsSettings, 0, data.taxYear);
  const pdf = await createPlanningPDF('Form 4562 - supported depreciation worksheet', data.taxYear);
  pdf.paragraph('Preparer review only, not an IRS Form 4562 or complete depreciation schedule. Supported first-year nonlisted 5/7-year MACRS assets use the half-year convention. Section 179/bonus elections, prior-year basis, vehicles and other unsupported cases require review.', true);
  pdf.paragraph(`Name as saved: ${data.userProfile.name || 'Not provided'}. Assets calculated: ${c.assets.length}.`);
  pdf.table(['Supported calculation', 'Amount'], [['Regular depreciation', money(c.totalRegularDepreciation)], ['Total supported depreciation', money(c.totalDepreciation)]], [398, 130]);
  pdf.section('Complete asset detail');
  for (const item of c.assets) {
    const a = item.asset;
    const rawDate = a.datePlacedInService as unknown;
    const date = rawDate && typeof rawDate === 'object' && 'toDate' in rawDate && typeof rawDate.toDate === 'function' ? rawDate.toDate() as Date : new Date(rawDate as string | Date);
    pdf.section(a.description);
    pdf.table(['Recorded fact / calculation', 'Value'], [
      ['Asset identifier', a.id], ['Placed in service', date.toISOString().slice(0, 10)], ['Cost', money(a.cost)],
      ['Business-use percentage', `${a.businessUsePercent}%`], ['Business basis', money(a.cost * a.businessUsePercent / 100)],
      ['Method / convention', `${a.method}; half-year`], ['Current-year regular depreciation', money(item.regularDepreciation)],
      ['Remaining business basis', money(item.remainingBasis)],
    ], [295, 233]);
  }
  pdf.paragraph('Review recovery class, acquisition/service dates, any required elections, business-use evidence, and prior depreciation with your preparer. This export does not claim that omitted elections or carryovers are zero. Retain the source documents; this worksheet cannot be filed instead of Form 4562.');
  pdf.paragraph('Reference: irs.gov/publications/p946 (Tables A-1/A-2) and irs.gov/instructions/i4562.');
  return pdf.save();
}
