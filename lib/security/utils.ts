/**
 * Security Utilities
 * Input validation, sanitization, and encryption helpers.
 *
 * SSN handling:
 *   - SSNs are NEVER logged anywhere
 *   - SSNs stored in Firestore are AES-256-GCM encrypted with a server-side key
 *   - Only the last 4 digits are ever displayed in the UI
 *   - The full SSN is only decrypted at PDF generation time, in-memory, never persisted in plain text
 */

import crypto from 'crypto';

// ── Input sanitization ───────────────────────────────────────────────────────

/**
 * Strip HTML tags and dangerous characters from user-provided strings.
 * Use on all user text inputs before storing in Firestore.
 */
export function sanitizeString(input: unknown, maxLength = 500): string {
  if (typeof input !== 'string') return '';
  return input
    .slice(0, maxLength)
    .replace(/<[^>]*>/g, '')           // strip HTML tags
    .replace(/[<>&"']/g, (c) => ({    // encode remaining special chars
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#x27;',
    }[c] || c))
    .trim();
}

/**
 * Validate and sanitize a dollar amount from user input.
 */
export function sanitizeAmount(input: unknown): number {
  const n = typeof input === 'string' ? parseFloat(input.replace(/[^0-9.-]/g, '')) : Number(input);
  if (!isFinite(n) || isNaN(n)) return 0;
  return Math.max(-999_999_999, Math.min(999_999_999, n));
}

/**
 * Validate a US tax year is reasonable.
 */
export function validateTaxYear(year: unknown): number {
  const n = parseInt(String(year), 10);
  if (isNaN(n) || n < 2015 || n > new Date().getFullYear() + 1) {
    throw new Error(`Invalid tax year: ${year}`);
  }
  return n;
}

/**
 * Validate a US SSN format (9 digits, not all zeros, not sequential).
 */
export function validateSSN(ssn: string): { valid: boolean; error?: string } {
  const digits = ssn.replace(/\D/g, '');
  if (digits.length !== 9) return { valid: false, error: 'SSN must be exactly 9 digits' };
  if (digits === '000000000') return { valid: false, error: 'SSN cannot be all zeros' };
  if (digits.startsWith('000')) return { valid: false, error: 'Invalid SSN (starts with 000)' };
  if (digits.substring(3, 5) === '00') return { valid: false, error: 'Invalid SSN (group 00)' };
  if (digits.substring(5) === '0000') return { valid: false, error: 'Invalid SSN (serial 0000)' };
  if (digits === '123456789') return { valid: false, error: 'Invalid SSN' };
  return { valid: true };
}

/**
 * Format SSN for PDF display: 123-45-6789
 */
export function formatSSNForDisplay(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length !== 9) return '';
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5, 9)}`;
}

/**
 * Return only last 4 digits for UI display: ***-**-6789
 */
export function maskSSN(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length < 4) return '***-**-****';
  return `***-**-${d.slice(-4)}`;
}

// ── SSN Encryption (AES-256-GCM) ─────────────────────────────────────────────
// Key must be exactly 32 bytes (256 bits)
// Set SSN_ENCRYPTION_KEY in environment as a 64-char hex string

function getEncryptionKey(): Buffer {
  const keyHex = process.env.SSN_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length < 64) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SSN_ENCRYPTION_KEY is required in production (64-char hex)');
    }
    // Dev fallback - deterministic but not for production
    return Buffer.from('dev_key_not_for_production_use__'.repeat(1).padEnd(32, '0').slice(0, 32));
  }
  return Buffer.from(keyHex.slice(0, 64), 'hex');
}

/**
 * Encrypt a sensitive string (SSN, bank account) before Firestore storage.
 * Returns a base64-encoded string: iv:authTag:ciphertext
 */
export function encryptSensitive(plaintext: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  } catch {
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt a sensitive string from Firestore.
 */
export function decryptSensitive(encrypted: string): string {
  try {
    const key = getEncryptionKey();
    const parts = encrypted.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');

    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const ciphertext = Buffer.from(parts[2], 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Decryption failed - data may be corrupted');
  }
}

/**
 * Check if a string is already encrypted (contains our format marker)
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3 && parts.every(p => /^[A-Za-z0-9+/=]+$/.test(p));
}

// ── Input validation schemas ─────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateW2Entry(body: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof body !== 'object' || body === null) return { valid: false, errors: ['Invalid request body'] };
  const b = body as Record<string, unknown>;

  const wages = sanitizeAmount(b.box1Wages ?? b.wages);
  const withheld = sanitizeAmount(b.box2FederalWithheld ?? b.federalWithheld);

  if (wages < 0) errors.push('Wages cannot be negative');
  if (wages > 10_000_000) errors.push('Wages exceed maximum allowed value');
  if (withheld < 0) errors.push('Federal withheld cannot be negative');
  if (withheld > wages && wages > 0) errors.push('Federal withheld cannot exceed wages');

  const employer = sanitizeString(b.employer ?? b.employerName ?? '');
  if (!employer) errors.push('Employer name is required');

  return { valid: errors.length === 0, errors };
}

export function validateDeductionEntry(body: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof body !== 'object' || body === null) return { valid: false, errors: ['Invalid request body'] };
  const b = body as Record<string, unknown>;

  const MAX_DEDUCTION = 500_000;
  const checks: [string, string][] = [
    ['healthInsurancePremiums', 'Health insurance premiums'],
    ['sepIraContribution', 'SEP-IRA contribution'],
    ['solo401kEmployeeContribution', 'Solo 401k employee contribution'],
    ['hsaContribution', 'HSA contribution'],
    ['studentLoanInterest', 'Student loan interest'],
    ['charitableCashDonations', 'Charitable cash donations'],
    ['charitableNonCashDonations', 'Charitable non-cash donations'],
  ];
  for (const [field, label] of checks) {
    if (b[field] !== undefined) {
      const v = sanitizeAmount(b[field]);
      if (v < 0) errors.push(`${label} cannot be negative`);
      if (v > MAX_DEDUCTION) errors.push(`${label} exceeds maximum allowed value`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateGrossReceipt(body: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof body !== 'object' || body === null) return { valid: false, errors: ['Invalid request body'] };
  const b = body as Record<string, unknown>;

  const amount = sanitizeAmount(b.amount);
  if (amount <= 0) errors.push('Amount must be greater than zero');
  if (amount > 10_000_000) errors.push('Amount exceeds maximum allowed value');

  const source = sanitizeString(b.source ?? '');
  if (!source) errors.push('Income source is required');

  return { valid: errors.length === 0, errors };
}

// ── CSRF helpers ─────────────────────────────────────────────────────────────

/**
 * Generate a CSRF token for form submissions.
 * In Next.js App Router, CSRF is largely mitigated by the same-origin requirement
 * for cookies + the Firebase Auth token requirement. But we add this for extra protection
 * on state-changing endpoints that don't use Firebase Auth (if any).
 */
export function generateCSRFToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
