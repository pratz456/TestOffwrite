import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { DocumentData } from 'firebase-admin/firestore';

/**
 * Provider identity, identifier validation and token encryption shared by the
 * private connection store and the legacy-credential migration. This module
 * must stay free of Admin SDK instances so the administrative migration script
 * can load it with the operator's environment only.
 */
export const configuredIdentity = () => ({ clientId: process.env.PLAID_CLIENT_ID || '', environment: process.env.PLAID_ENV || '' });
export const isCurrent = (data: DocumentData) => {
  const current = configuredIdentity();
  return Boolean(current.clientId && current.environment && data.clientId === current.clientId && data.environment === current.environment);
};
export function validId(value: string) {
  if (typeof value !== 'string' || !value || value.includes('/') || value.length > 500) throw new Error('Invalid bank identifier');
  return value;
}
function key(): Buffer {
  const value = process.env.PLAID_TOKEN_ENCRYPTION_KEY;
  if (!value || !/^[a-f\d]{64}$/i.test(value)) throw new Error('Bank token encryption is not configured');
  return Buffer.from(value, 'hex');
}
export function assertPlaidTokenEncryptionConfigured(): void { key(); }
export function encryptPlaidToken(uid: string, itemId: string, token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(JSON.stringify([uid, itemId])));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}
export function decryptPlaidToken(uid: string, itemId: string, encrypted: string): string {
  try {
    const [version, iv, tag, ciphertext, extra] = encrypted.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext || extra) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(JSON.stringify([uid, itemId])));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw new Error('Bank token could not be decrypted'); }
}
