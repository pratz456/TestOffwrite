export interface ExternalFilingProvider {
  id: string;
  name: string;
  description: string;
  url: string;
  pricingEstimate: string;
  pricingNote?: string;
  badge?: string;
  recommendedFor?: string;
}

export const FILING_PROVIDERS: ExternalFilingProvider[] = [
  {
    id: "turbotax",
    name: "TurboTax",
    description: "Guided filing for freelancers and self-employed users",
    url: "https://turbotax.intuit.com/personal-taxes/online/self-employed.jsp",
    pricingEstimate: "Check provider pricing",
    pricingNote:
      "Pricing and eligibility depend on the return and selected service.",
    badge: "External provider",
    recommendedFor: "Freelancers, gig workers",
  },
  {
    id: "columntax",
    name: "Column Tax",
    description: "Simple and modern tax filing experience",
    url: "https://www.columntax.com",
    pricingEstimate: "Partner access required",
    pricingNote: "WriteOff has not activated a filing partnership. Pricing and availability are unconfirmed.",
    badge: "Integration pending",
    recommendedFor: "Subject to provider eligibility",
  },
];
