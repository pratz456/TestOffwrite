/** Bank acknowledgment shown before Plaid Link opens. A saved record stores this version and a sha256 of the text. */
export const BANK_CONSENT_VERSION = '2026-10-22b';

export const BANK_CONSENT_SOURCE = 'bank-connect' as const;

export const BANK_CONSENT_TEXT = 'I agree that WriteOff may save transactions from the bank accounts I connect in my WriteOff account, use them to suggest categories for me to review, and include them in reports I create. WriteOff uses service providers, including Plaid, to get and process those transactions. I can disconnect a bank on the Bank accounts screen. Disconnecting stops new imports and keeps records already saved in my account.';

export const BANK_CONSENT_PRIVACY_LINK_LABEL = 'Privacy Policy';

export const BANK_LINK_NOT_NOW = 'Not now';

export const BANK_LINK_TRY_AGAIN = 'Try again';

export const BANK_LINK_ADD_EXPENSE = 'Add an expense by hand';

export const BANK_LINK_UPLOAD_RECEIPT = 'Upload a receipt';

export const BANK_LINK_NOT_FINISHED = 'Bank connection was not finished.';

/** Used when the acknowledgment cannot be saved: extra fields, a missing or unreadable time, or a failed write. */
export const BANK_CONSENT_SAVE_ERROR = 'We could not save your bank acknowledgment. Please try again.';

export const BANK_CONSENT_REQUIRED_ERROR = 'Acknowledge how WriteOff uses bank transactions before connecting a bank.';

/** Used only when reading a stored bank acknowledgment fails. */
export const BANK_CONSENT_LOOKUP_ERROR = 'We could not check your bank acknowledgment. Please try again.';

export const BANK_CONSENT_OUT_OF_DATE_ERROR = 'Bank acknowledgment is out of date. Refresh and try again.';

export const BANK_CONSENT_CLOCK_ERROR = "We could not save your bank acknowledgment. Check your device's date and time, then try again.";
