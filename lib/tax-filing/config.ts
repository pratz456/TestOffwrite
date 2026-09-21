/** Sandbox enrollment only. Production filing needs provider QA and a separate launch change. */
export interface FilingSandboxConfig { environment: 'sandbox'; taxYear: number; clientId: string; clientSecret: string }
export function filingSandboxConfig(env: Record<string, string | undefined> = process.env): FilingSandboxConfig | null {
  if (env.COLUMN_TAX_MODE !== 'sandbox' || env.COLUMN_TAX_SANDBOX_APPROVED !== 'true'
    || env.WRITEOFF_ENV !== 'staging' || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== 'writeoff-production-testing') return null;
  const raw = env.COLUMN_TAX_FILING_YEAR ?? '';
  if (!/^20\d{2}$/.test(raw) || ![2024, 2025, 2026].includes(Number(raw))) return null;
  if (!env.COLUMN_TAX_CLIENT_ID?.trim() || !env.COLUMN_TAX_CLIENT_SECRET?.trim()) return null;
  return { environment: 'sandbox', taxYear: Number(raw), clientId: env.COLUMN_TAX_CLIENT_ID, clientSecret: env.COLUMN_TAX_CLIENT_SECRET };
}
export function isFilingSandboxIdentity(user: { uid: string; email: string | null }): boolean {
  return /^staging-filing-[a-f0-9-]{36}$/.test(user.uid) && user.email === `${user.uid}@example.com`;
}
