import type { StartTaxFilingInput, StartTaxFilingResult } from '../types';
import { getTaxProviderRedirectBaseUrl } from '../config';
import { createTaxFilingSession } from '@/lib/firebase/tax-filing-sessions';

function buildRedirectUrl(input: {
  baseUrl: string;
  sessionId: string;
  taxYear: string;
}): string {
  const url = new URL(input.baseUrl);
  url.searchParams.set('provider', 'taxbandits');
  url.searchParams.set('sessionId', input.sessionId);
  url.searchParams.set('taxYear', input.taxYear);
  return url.toString();
}

export async function startFiling(input: StartTaxFilingInput): Promise<StartTaxFilingResult> {
  const baseUrl = getTaxProviderRedirectBaseUrl('taxbandits');
  if (!baseUrl) {
    throw new Error(
      'TaxBandits redirect URL is not configured. Set TAXBANDITS_REDIRECT_BASE_URL (or TAXBANDITS_REDIRECT_URL) in your environment.'
    );
  }

  const session = await createTaxFilingSession({
    userId: input.userId,
    provider: 'taxbandits',
    taxYear: input.taxYear,
    summary: input.summary,
  });

  const redirectUrl = buildRedirectUrl({
    baseUrl,
    sessionId: session.sessionId,
    taxYear: input.taxYear,
  });

  return {
    sessionId: session.sessionId,
    redirectUrl,
  };
}

