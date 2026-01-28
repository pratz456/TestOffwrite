/**
 * Debug utility functions that only log in development/test environments
 * All console output is suppressed in production builds
 */

const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Conditional console.log - only logs in development/test
 */
export const debugLog = (...args: any[]): void => {
  if (isDevelopment) {
    console.log(...args);
  }
};

/**
 * Conditional console.warn - only warns in development/test
 */
export const debugWarn = (...args: any[]): void => {
  if (isDevelopment) {
    console.warn(...args);
  }
};

/**
 * Conditional console.error - only errors in development/test
 * Note: Critical errors should still use console.error directly
 */
export const debugError = (...args: any[]): void => {
  if (isDevelopment) {
    console.error(...args);
  }
};

/**
 * Conditional console.info - only logs in development/test
 */
export const debugInfo = (...args: any[]): void => {
  if (isDevelopment) {
    console.info(...args);
  }
};

/**
 * Conditional console.debug - only logs in development/test
 */
export const debugDebug = (...args: any[]): void => {
  if (isDevelopment) {
    console.debug(...args);
  }
};

/**
 * Check if we're in development mode
 */
export const isDev = (): boolean => isDevelopment;

/**
 * Check if we're in production mode
 */
export const isProd = (): boolean => isProduction;
