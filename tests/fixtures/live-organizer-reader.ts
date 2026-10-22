/**
 * Test-only copy of the decrypt and mask helpers used by production commit
 * 7a8ba53d6e82ccdacd1c3cf2dae34f8a2d5ffa0b.
 * Source: lib/security/utils.ts
 * Source: lib/tax-organizer/identifiers.ts
 * Function bodies are copied unchanged from that commit.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'crypto';

export const LIVE_READER_COMMIT = '7a8ba53d6e82ccdacd1c3cf2dae34f8a2d5ffa0b';
export const LIVE_READER_SOURCES = ['lib/security/utils.ts', 'lib/tax-organizer/identifiers.ts'] as const;

export type OrganizerIdentifierKind = 'ssn' | 'bankAccount' | 'bankRouting' | 'ipPin' | 'ein';

export const IDENTIFIER_PROVIDED_SEPARATELY = 'Provided to preparer separately';

export function maskSSN(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length < 4) return '***-**-****';
  return `***-**-${d.slice(-4)}`;
}

function getEncryptionKey(): Buffer {
  const keyHex = process.env.SSN_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length < 64) {
    // A development server can connect to live data; its build mode must not
    // permit the demo key when any marker selects production or a real account.
    if (process.env.NODE_ENV === 'production' || process.env.WRITEOFF_ENV === 'production'
      || process.env.NEXT_PUBLIC_APP_ENV === 'production'
      || process.env.WRITEOFF_LOCAL_ACCOUNT_PREVIEW === 'true'
      || process.env.WRITEOFF_ENV === 'local-account-preview'
      || process.env.NEXT_PUBLIC_APP_ENV === 'local-account-preview') {
      throw new Error('SSN_ENCRYPTION_KEY is required for real account data (64-char hex)');
    }
    // Dev fallback - deterministic but not for production
    return Buffer.from('dev_key_not_for_production_use__'.repeat(1).padEnd(32, '0').slice(0, 32));
  }
  return Buffer.from(keyHex.slice(0, 64), 'hex');
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

export function maskOrganizerIdentifier(kind: OrganizerIdentifierKind, value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  switch (kind) {
    case 'ssn': return maskSSN(digits);
    case 'ipPin': return IDENTIFIER_PROVIDED_SEPARATELY;
    case 'ein': return `**-***${digits.slice(-4).padStart(4, '*')}`;
    case 'bankRouting': return `*****${digits.slice(-4).padStart(4, '*')}`;
    case 'bankAccount': return `****${digits.slice(-4).padStart(4, '*')}`;
  }
}

const COPIED_FUNCTIONS = ['getEncryptionKey', 'decryptSensitive', 'maskSSN', 'maskOrganizerIdentifier'] as const;

function extractFunction(source: string, name: string): string {
  const start = source.search(new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`));
  if (start < 0) throw new Error(`missing ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

/** When the recorded commit is present locally, the copied helpers must match it. */
export function assertVendoredLiveReader(): void {
  try {
    execFileSync('git', ['cat-file', '-e', `${LIVE_READER_COMMIT}^{commit}`], { stdio: 'ignore' });
  } catch {
    return;
  }
  const fixture = readFileSync(path.join(process.cwd(), 'tests/fixtures/live-organizer-reader.ts'), 'utf8');
  const recorded = LIVE_READER_SOURCES.map(file => execFileSync('git', ['show', `${LIVE_READER_COMMIT}:${file}`], { encoding: 'utf8' })).join('\n');
  for (const name of COPIED_FUNCTIONS) {
    if (extractFunction(fixture, name) !== extractFunction(recorded, name)) {
      throw new Error(`Vendored reader does not match ${LIVE_READER_COMMIT}`);
    }
  }
  const constant = `export const IDENTIFIER_PROVIDED_SEPARATELY = 'Provided to preparer separately';`;
  if (!recorded.includes(constant) || !fixture.includes(constant)) {
    throw new Error(`Vendored reader does not match ${LIVE_READER_COMMIT}`);
  }
}
