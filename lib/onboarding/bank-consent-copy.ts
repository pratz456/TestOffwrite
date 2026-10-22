/** Bank acknowledgment shown before Plaid Link opens. The version and text are hashed together when the record is saved. */
export const BANK_CONSENT_VERSION = '2026-10-22';

export const BANK_CONSENT_SOURCE = 'bank-connect' as const;

export const BANK_CONSENT_TEXT = 'I agree that WriteOff may store bank transactions I choose to connect in my account, use them to suggest categories for my review, and include them in reports I generate. WriteOff uses service providers, including Plaid, to retrieve and process those transactions. I can disconnect a bank in Settings. Disconnecting stops later imports and keeps records already saved in my account.';
