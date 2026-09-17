import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };

export const API_BASE_URL = (extra.apiBaseUrl ?? 'https://writeoff-production-testing.web.app').replace(/\/$/, '');

/** Production banking and billing are never sold or configured inside the mobile client. */
export const MOBILE_FEATURES = Object.freeze({
  automaticTripDetection: true,
  receiptCapture: true,
  inAppPurchases: false,
  embeddedFiling: false,
});
