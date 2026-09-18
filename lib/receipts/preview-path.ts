/** Receipt URLs are editable data. Allow only the ownership-checked private API,
 * including its legacy UID/transaction/filename route, never arbitrary links.
 */
export function validateReceiptPreviewPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const prefix = '/api/receipts/';
  if (!value.startsWith(prefix) || value.length > prefix.length + 7200) return null;
  const parts = value.slice(prefix.length).split('/');
  if (parts.length !== 1 && parts.length !== 3) return null;
  try {
    const decoded = parts.map(part => decodeURIComponent(part));
    // Reject residual percent encoding rather than allowing a later decoder to
    // reinterpret the path. The server limits the complete decoded ID to 600.
    if (decoded.join('/').length > 600 || decoded.some(part => !part || part === '.' || part === '..'
      || /[\\/?#%]|\p{Cc}|\p{Cf}/u.test(part))) return null;
    const canonical = decoded.map(part => encodeURIComponent(part).replace(/[!'()*]/g,
      char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`));
    return prefix + canonical.join('/');
  } catch {
    return null;
  }
}
