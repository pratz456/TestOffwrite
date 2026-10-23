import { createHash } from 'node:crypto';

/** SHA-256 of the exact consent text shown at signing (Rev. Proc. 2013-14 section 4.03(4)). */
export function consentTextSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
