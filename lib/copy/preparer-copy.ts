/** Pending product decision. False keeps the current nav name. */
export const PREPARER_NAV_RENAME = false;

export function filingNavName(rename: boolean): string {
  return rename ? 'Preparer exports' : 'Filing & exports';
}
