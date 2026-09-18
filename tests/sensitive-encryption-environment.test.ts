import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSensitive, encryptSensitive, isEncrypted } from '../lib/security/utils';

const fixture = 'synthetic-sensitive-value';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('WRITEOFF_ENV', '');
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', '');
  vi.stubEnv('SSN_ENCRYPTION_KEY', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('sensitive encryption environment boundaries', () => {
  it.each(['NODE_ENV', 'WRITEOFF_ENV', 'NEXT_PUBLIC_APP_ENV'])(
    'rejects an absent key when %s selects production', marker => {
      const demoCiphertext = encryptSensitive(fixture);
      vi.stubEnv(marker, 'production');

      expect(() => encryptSensitive(fixture)).toThrow('Encryption failed');
      expect(() => decryptSensitive(demoCiphertext)).toThrow('Decryption failed');
    },
  );

  it.each(['WRITEOFF_ENV', 'NEXT_PUBLIC_APP_ENV'])(
    'rejects a short key in a development server with %s selecting production', marker => {
      vi.stubEnv(marker, 'production');
      vi.stubEnv('SSN_ENCRYPTION_KEY', 'incomplete-test-key');

      expect(() => encryptSensitive(fixture)).toThrow('Encryption failed');
    },
  );

  it.each(['NODE_ENV', 'WRITEOFF_ENV', 'NEXT_PUBLIC_APP_ENV'])(
    'round-trips using the configured key when %s selects production', marker => {
      vi.stubEnv(marker, 'production');
      vi.stubEnv('SSN_ENCRYPTION_KEY', 'a1'.repeat(32));

      const ciphertext = encryptSensitive(fixture);
      expect(isEncrypted(ciphertext)).toBe(true);
      expect(ciphertext).not.toContain(fixture);
      expect(decryptSensitive(ciphertext)).toBe(fixture);
    },
  );

  it.each(['development', 'test'])(
    'preserves isolated %s fallback behavior', nodeEnv => {
      vi.stubEnv('NODE_ENV', nodeEnv);
      vi.stubEnv('WRITEOFF_ENV', 'local');
      vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'local');

      expect(decryptSensitive(encryptSensitive(fixture))).toBe(fixture);
    },
  );
});
