/** Pending product decision. False keeps the current nav name. */
export const PREPARER_NAV_RENAME = false;

export function filingNavName(rename: boolean): string {
  return rename ? 'Preparer exports' : 'Filing & exports';
}

export function filingAuthNavLabel(rename: boolean): string {
  // The no wording is pending approval.
  return rename ? 'Filing authorization' : 'Filing authorization';
}
