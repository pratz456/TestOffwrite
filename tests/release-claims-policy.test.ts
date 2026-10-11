import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSENT_TERMS_VERSION } from '@/lib/onboarding/consents';

const source = (relative: string) => readFileSync(path.resolve(relative), 'utf8');

describe('release claims and privacy disclosures', () => {
  it('uses the expanded consent version and names sensitive organizer and document data', () => {
    expect(CONSENT_TERMS_VERSION).toBe('2026-10-11');
    const privacy = source('app/privacy/privacy-page-client.tsx');
    const notice = source('components/onboarding/consent-checkboxes.tsx');
    for (const text of ['Social Security numbers', 'spouse and dependent details', 'routing and account numbers', 'W-2s', 'bank or card statements']) {
      expect(privacy).toContain(text);
    }
    for (const text of ['taxpayer identifiers', 'spouse or dependent details', 'refund payment instructions']) {
      expect(notice).toContain(text);
    }
  });

  it('states deletion and vendor limits without absolute or unsupported promises', () => {
    const privacy = source('app/privacy/privacy-page-client.tsx');
    const settings = source('components/settings-screen.tsx');
    expect(privacy).toContain('account-deletion marker');
    expect(privacy).toContain('vendor records');
    expect(privacy).not.toMatch(/audited and compliant service providers|question to a tax professional through the app/i);
    expect(settings).not.toContain('all associated data');
  });

  it('advertises only implemented subscription and checklist behavior', () => {
    const subscriptions = source('app/protected/subscriptions/page.tsx');
    const actions = source('lib/guidance/action-engine.ts');
    const checklist = source('components/action-items-screen.tsx');
    expect(subscriptions).not.toMatch(/priority support|automatic transaction syncing/i);
    expect(actions).not.toMatch(/complete income reporting|avoid underpayment penalties/i);
    expect(checklist).not.toMatch(/all caught up|you.re all set|get everything ready for tax filing/i);
  });
});
