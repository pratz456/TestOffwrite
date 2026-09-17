export interface ScheduledBankConfig {
  project: string | undefined;
  origin: string;
  clientId: string;
  environment: string;
  secret: string;
}

/** A deployed scheduler must select the same project, provider account, and app. */
export function assertScheduledBankConfig(config: ScheduledBankConfig): void {
  const allowed: Record<string, { origin: string; environment: string }> = {
    'writeoff-production-testing': { origin: 'https://writeoff-production-testing.web.app', environment: 'sandbox' },
    'writeoff-23910': { origin: 'https://writeoffapp.com', environment: 'production' },
  };
  const expected = config.project ? allowed[config.project] : undefined;
  let url: URL;
  try { url = new URL(config.origin); }
  catch { throw new Error('BANK_SYNC_CONFIGURATION_REQUIRED'); }
  if (!expected || url.origin !== expected.origin || url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
      config.environment !== expected.environment || !config.clientId.trim() || config.secret.length < 32) {
    throw new Error('BANK_SYNC_CONFIGURATION_REQUIRED');
  }
}

export function currentBankUsers(connections: Array<Record<string, unknown>>, config: ScheduledBankConfig): string[] {
  assertScheduledBankConfig(config);
  return [...new Set(connections.filter(connection => connection.status === 'active' &&
    connection.clientId === config.clientId && connection.environment === config.environment &&
    typeof connection.uid === 'string' && /^[^/\\\u0000-\u001f\u007f]{1,256}$/.test(connection.uid))
    .map(connection => connection.uid as string))];
}
