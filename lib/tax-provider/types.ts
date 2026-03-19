export type TaxProviderName = 'taxbandits';

export type TaxFilingStatus =
  | 'initiated'
  | 'redirected'
  | 'in_progress'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'error';

export interface TaxFilingLineItemSummary {
  lineCode: string;
  lineName: string;
  transactionCount: number;
  deductible: number;
}

export interface TaxFilingSummary {
  taxYear: string;
  totalExpenses: number;
  totalDeductible: number;
  lineItemCount: number;
  deductibleTransactionCount: number;
  lineItems: TaxFilingLineItemSummary[];
}

export interface StartTaxFilingInput {
  userId: string;
  email: string;
  taxYear: string;
  summary: TaxFilingSummary;
}

export interface StartTaxFilingResult {
  sessionId: string;
  redirectUrl: string;
}

