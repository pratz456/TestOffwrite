/**
 * State individual income tax planning module.
 *
 * Year-labeled registry of department-of-revenue parameters for tax years 2025 and 2026,
 * an estimate engine that starts from federal AGI, and informational notices about
 * separate business taxes. Everything here is an informational state planning estimate;
 * it does not prepare a state return.
 */
export * from './types';
export {
  ENCODED_STATE_CODES, US_STATES, US_STATE_NAMES, getStateYearRules, isRegistryTaxYear,
  isSupportedStateYear, resolveStateCode, stateName, supportedStateYears,
} from './registry';
export { estimateStateTax, scheduleTax } from './estimate';
export { businessTaxNotices, type BusinessTaxNotice, type BusinessTaxNoticeInput } from './business-notices';
export { readProfileLocation } from './profile-location';
