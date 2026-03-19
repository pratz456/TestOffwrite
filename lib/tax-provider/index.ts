import type { TaxProviderName, StartTaxFilingInput, StartTaxFilingResult } from './types';
import { getTaxProviderName } from './config';

export type TaxProvider = {
  startFiling: (input: StartTaxFilingInput) => Promise<StartTaxFilingResult>;
};

// Provider factory (kept simple for now; ready for additional providers later)
export async function getTaxProvider(): Promise<TaxProvider & { name: TaxProviderName }> {
  const name = getTaxProviderName();

  switch (name) {
    case 'taxbandits': {
      const mod = await import('./taxbandits/provider');
      return { name, ...mod };
    }
    default: {
      // Exhaustiveness fallback
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}

