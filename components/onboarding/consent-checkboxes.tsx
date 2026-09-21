'use client';

import React from 'react';
import type { ConsentChoices, ConsentKey } from '@/lib/onboarding/consents';

const policyLink = 'underline text-primary no-tap-highlight';

export function NoticeAtCollection({ className = '' }: { className?: string }) {
  return (
    <div className={`p-3 sm:p-4 bg-primary/10 dark:bg-primary/15 border border-primary/20 rounded-lg text-xs text-foreground ${className}`.trim()}>
      <strong>Notice at Collection:</strong> We collect your name, email, password, and, after signup, your bank transactions, employer/workstyle answers, and state. This information is used to provide tax deduction analysis, generate reports, and personalize your experience. See our <a href="/privacy" className={policyLink} target="_blank" rel="noopener noreferrer">Privacy Policy</a> for details.
    </div>
  );
}

interface ConsentItem {
  key: ConsentKey;
  /** Element id suffix; the sign-up form keeps its historical ids. */
  id: string;
  required: boolean;
  label: React.ReactNode;
}

// The stored record's version (CONSENT_TERMS_VERSION) describes this wording.
const CONSENT_ITEMS: ConsentItem[] = [
  {
    key: 'terms', id: 'termsConsent', required: true,
    label: <>I have read and agree to the <a href="/terms" className={policyLink} target="_blank" rel="noopener noreferrer">Terms of Service</a> and the <a href="/privacy" className={policyLink} target="_blank" rel="noopener noreferrer">Privacy Policy</a>. WriteOff organizes records and produces planning estimates; it does not prepare or file tax returns or give tax advice.</>,
  },
  {
    key: 'bank_data', id: 'bankConsent', required: true,
    label: <>I authorize WriteOff to access and use my account and transaction data via Plaid to analyze potential tax deductions and generate reports. (<a href="/privacy" className={policyLink} target="_blank" rel="noopener noreferrer">Privacy</a> | <a href="https://plaid.com/legal/#end-user-privacy-policy" className={policyLink} target="_blank" rel="noopener noreferrer">Plaid</a>)</>,
  },
  {
    key: 'ai_review', id: 'aiConsent', required: true,
    label: 'I understand that WriteOff uses automated (AI) analysis to suggest categories and possible tax treatments for my review, and that I confirm each one.',
  },
  {
    key: 'communications', id: 'commConsent', required: false,
    label: 'I consent to receive communications about my account and product updates.',
  },
];

interface ConsentCheckboxesProps {
  values: ConsentChoices;
  onChange: (key: ConsentKey, checked: boolean) => void;
  disabled?: boolean;
  idPrefix?: string;
}

export function ConsentCheckboxes({ values, onChange, disabled = false, idPrefix }: ConsentCheckboxesProps) {
  return (
    <div className="space-y-3 bg-muted/40 border border-border rounded-xl p-3 sm:p-4">
      {CONSENT_ITEMS.map(item => {
        const id = idPrefix ? `${idPrefix}-${item.id}` : item.id;
        return (
          <div key={item.key} className="flex items-start gap-3 sm:gap-2">
            <input
              type="checkbox"
              id={id}
              checked={values[item.key]}
              disabled={disabled}
              onChange={event => onChange(item.key, event.target.checked)}
              className="mt-0.5 w-5 h-5 sm:w-4 sm:h-4 flex-shrink-0"
              required={item.required}
              aria-required={item.required}
            />
            <label htmlFor={id} className="text-xs text-foreground leading-relaxed">
              {item.label}
              {item.required && <span className="text-destructive ml-0.5">*</span>}
            </label>
          </div>
        );
      })}
    </div>
  );
}
