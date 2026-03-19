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
    pricingEstimate: "~$0 – $129+",
    pricingNote:
      "Free for very simple returns. Self-employed plans are typically higher.",
    badge: "Most popular",
    recommendedFor: "Freelancers, gig workers",
  },
  {
    id: "columntax",
    name: "Column Tax",
    description: "Simple and modern tax filing experience",
    url: "https://www.columntax.com",
    pricingEstimate: "~$25 – $60",
    pricingNote: "Simple, modern filing with transparent pricing.",
    badge: "Simple & fast",
    recommendedFor: "Simple returns",
  },
];
