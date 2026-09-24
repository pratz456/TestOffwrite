import { describe, expect, it } from 'vitest';
import { groundTransactionAnalysis } from '@/lib/ai/transaction-tax-policy';
import type { OutputType, TransactionInput, UserContext } from '@/lib/ai/analyzeTransaction';

const context: UserContext = { user_id: 'source-audit-synthetic', business_entity: 'sole_proprietor', profession: ['Designer'] };
function grounded(merchant: string, purpose: string, category: OutputType['category'], evidence: string, percent = 100) {
  const input: OutputType = {
    status: 'ok', transaction_kind: 'expense', category, is_deductible: true,
    expense_type: 'business', deductible_percent: percent, evidence_ids: [evidence],
    customized_reason: 'The saved expense was approved by the model.', confidence: 0.9,
  };
  const transaction: TransactionInput = { tx_id: 'audit', merchant, amount_usd: 100, date_iso: '2026-09-23', business_purpose: purpose, business_use_percentage: percent };
  return groundTransactionAnalysis(input, transaction, context, 'synthetic');
}

describe('live-provider statutory approval regressions', () => {
  it('formation fees cannot pass as ordinary operating professional fees', () => {
    const result = grounded('LegalZoom', 'LLC formation filing for my design business', 'legal_professional', 'professional-fees-334');
    expect(result).toMatchObject({ status: 'needs_more_info', missing_fields: ['formation_cost_treatment'] });
    expect(result?.is_deductible).toBeUndefined();
    expect(result?.questions?.[0]).toContain('active business operations');
  });
  it('ongoing contract review and annual compliance remain distinct from formation', () => {
    expect(grounded('Law firm', 'Attorney review of my client services contract', 'legal_professional', 'professional-fees-334')?.status).toBe('ok');
    expect(grounded('Sunbiz', 'Annual report fee for my LLC', 'taxes_licenses', 'taxes-licenses-sch-c')?.status).toBe('ok');
  });
  it('a recorded percentage does not turn office food into ordinary supplies', () => {
    const result = grounded('Costco', 'Office snacks for the studio and household groceries, 30% business', 'supplies_small_tools', 'business-162', 30);
    expect(result).toMatchObject({ status: 'needs_more_info', missing_fields: ['food_expense_treatment'] });
    expect(result?.deductible_percent).toBeUndefined();
    expect(result?.questions?.[0]).toContain('food for resale');
  });
  it('food in the client industry does not change a software subscription into a meal', () => {
    expect(grounded('Adobe', 'Design software for food company client projects', 'software_subscriptions', 'software-334')?.status).toBe('ok');
  });
  it.each([
    'Sales tax collected from customers, remitted for Q2',
    'Buyer-imposed sales tax collected from customers and remitted for Q2',
    'Seller-imposed sales tax included in gross receipts, remitted for Q2',
  ])('sales-tax incidence and receipt reconciliation remain required: %s', purpose => {
    const result = grounded('WA Dept of Revenue', purpose, 'taxes_licenses', 'taxes-licenses-sch-c');
    expect(result).toMatchObject({ status: 'needs_more_info', missing_fields: ['sales_tax_incidence'] });
    expect(result?.is_deductible).toBeUndefined();
    expect(result?.customized_reason).toContain('excluded from both gross receipts and deductions');
  });
  it('an explicitly named Upwork platform service fee is not contractor labor', () => {
    const result = grounded('UPWORK -ESCROW SERVICE FEE', 'Upwork service fee on client contract', 'contract_labor', 'contract-labor-334');
    expect(result).toMatchObject({ status: 'ok', category: 'bank_and_payment_fees', is_deductible: true, schedule_c_line: '10' });
    expect(result?.customized_reason).toContain('not a payment for a freelancer');
    expect(result?.sources?.map(source => source.id)).toContain('platform-fees-1099k');
    expect(result?.sources?.map(source => source.id)).not.toContain('contract-labor-334');
  });
  it('a payment to a freelancer through Upwork remains contract labor', () => {
    expect(grounded('Upwork', 'Paid a freelance developer for the client web app build', 'contract_labor', 'contract-labor-334'))
      .toMatchObject({ status: 'ok', category: 'contract_labor', is_deductible: true });
  });
  it('REALTOR dues need the association allocation before the full bill is deducted', () => {
    const result = grounded('National Association of Realtors', 'Annual REALTOR association and MLS dues', 'dues_and_memberships', 'dues-274a3');
    expect(result).toMatchObject({ status: 'needs_more_info', missing_fields: ['association_dues_allocation'] });
    expect(result?.is_deductible).toBeUndefined();
    expect(result?.questions?.[0]).toContain('lobbying');
  });
});
