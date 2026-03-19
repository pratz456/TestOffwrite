import type { TaxProviderName } from './types';

export function getTaxProviderName(): TaxProviderName {
  const env = process.env.TAX_FILING_PROVIDER;
  if (env === 'taxbandits') return 'taxbandits';

  // Default to TaxBandits while only one provider is supported.
  return 'taxbandits';
}

export function getTaxProviderDisplayName(provider: TaxProviderName): string {
  switch (provider) {
    case 'taxbandits':
      return 'TaxBandits';
    default:
      return 'TaxBandits';
  }
}

export function getTaxProviderRedirectBaseUrl(provider: TaxProviderName): string {
  switch (provider) {
    case 'taxbandits':
      // Provide either a "redirect base url" with optional query params.
      return (
        process.env.TAXBANDITS_REDIRECT_BASE_URL ||
        process.env.TAXBANDITS_REDIRECT_URL ||
        ''
      );
  }
}

