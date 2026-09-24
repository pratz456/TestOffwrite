/** Public, credential-free contract for the owner-guided bank reconnect screen. */
export interface ReconnectAccount {
  id: string; name: string; mask: string | null; type: string; currency: string | null;
}
export interface ReconnectCanonical {
  reference: string; version: string; accountId: string; date: string; amount: number;
  merchant: string; currency: string | null; confirmed: boolean;
}
export interface ReconnectRecord {
  id: string; version: string; accountId: string; date: string; amount: number;
  merchant: string; currency: string | null; status: 'pending' | 'deferred' | 'resolved';
  event: 'added' | 'modified' | 'removed'; correction: boolean; canApplyCorrection?: boolean; canChooseDistinct?: boolean;
  previousRecord?: ReconnectCanonical;
  candidates: Array<ReconnectCanonical & { exact: boolean }>;
}
export interface ReconnectView {
  sessionId: string; phase: 'awaiting_link' | 'review' | 'active' | 'cancelled';
  itemId: string | null; accounts: ReconnectAccount[]; legacyAccounts: ReconnectAccount[];
  mappings: Record<string, string[]>; historyReady: boolean; mappingComplete: boolean;
  pendingCount: number; deferredCount: number; resolvedCount: number;
  records: ReconnectRecord[]; nextCursor: string | null; cutoverDate: string | null;
}
export type ReconnectDecision = {
  recordId: string; version: string; decision: 'duplicate' | 'distinct' | 'defer' | 'keep_existing' | 'apply_correction';
  canonicalReference?: string; canonicalVersion?: string; previousVersion?: string; confirmDifferentDetails?: boolean;
};
export type ReconnectAction =
  | { action: 'start' }
  | { action: 'map'; sessionId: string; mappings: Record<string, string[]>; confirmAccountMapping: true }
  | { action: 'decide'; sessionId: string; decisions: ReconnectDecision[] }
  | { action: 'sync' | 'cancel'; sessionId: string }
  | { action: 'activate'; sessionId: string; acknowledgeDeferred: boolean };
