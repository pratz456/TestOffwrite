export class SocialSecurityReviewRequiredError extends Error {
  readonly code = 'SOCIAL_SECURITY_REVIEW_REQUIRED';

  constructor() {
    super('Review Social Security in Tax Organizer using SSA-1099/RRB-1099 records and IRS Publication 915. Required benefit and income details are missing, so WriteOff cannot calculate this federal estimate or Form 1040 export. Keep your benefit records for tax review.');
    this.name = 'SocialSecurityReviewRequiredError';
  }
}

/**
 * The organizer stores a benefits flag and a legacy Box 3 amount, not the facts
 * needed for Pub. 915 Worksheet 1 (Box 5 net benefits, tax-exempt income, etc.).
 * An 85% maximum is not a taxable-benefits calculation. Until the required facts
 * are collected, only organizers with no reported benefits can be calculated.
 * https://www.irs.gov/publications/p915
 */
export function assertSocialSecurityBenefitsSupported(organizer: Record<string, unknown>): void {
  const flag = organizer.hasSocialSecurity;
  const normalizedFlag = typeof flag === 'string' ? flag.trim().toLowerCase() : flag;
  if (normalizedFlag !== undefined && normalizedFlag !== null && normalizedFlag !== '' && normalizedFlag !== 'no') {
    throw new SocialSecurityReviewRequiredError();
  }

  // A stored amount must not disappear because a legacy flag is missing or No.
  const raw = organizer.amountSocialSecurity;
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return;
  const validNumber = typeof raw === 'number'
    || (typeof raw === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim()));
  if (!validNumber || !Number.isFinite(Number(raw)) || Number(raw) !== 0) {
    throw new SocialSecurityReviewRequiredError();
  }
}
