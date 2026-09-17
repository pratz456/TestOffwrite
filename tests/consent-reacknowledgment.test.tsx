import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: { id: 'legacy-user' }, signOut: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: vi.fn() }));
vi.mock('@/components/logout-button', () => ({ LogoutButton: (props: { className?: string }) => <button type="button" className={props.className}>Sign out</button> }));

import { ConsentReacknowledgment, needsConsentReacknowledgment } from '@/components/onboarding/consent-reacknowledgment';
import { buildConsentRecord, CONSENT_SOURCES, CONSENT_TERMS_VERSION, parseConsentRecord } from '@/lib/onboarding/consents';

const current = { version: CONSENT_TERMS_VERSION, source: 'sign-up', accepted_at: '2026-09-17T12:00:00.000Z', bank_data: true, ai_review: true, communications: false };

describe('consent re-acknowledgment for existing accounts', () => {
  it('gates profiles with no record, an older terms version, or missing required acknowledgments; not a current record', () => {
    expect(needsConsentReacknowledgment({ name: 'Legacy' })).toBe(true);
    expect(needsConsentReacknowledgment({ consents: { ...current, version: '2026-01-01' } })).toBe(true);
    expect(needsConsentReacknowledgment({ consents: { ...current, ai_review: false } })).toBe(true);
    expect(needsConsentReacknowledgment({ consents: current })).toBe(false);
    expect(needsConsentReacknowledgment(null)).toBe(false);
  });
  it('records the re-acknowledgment as its own source that the server allowlist accepts', () => {
    expect(CONSENT_SOURCES).toContain('reacknowledgment');
    const record = buildConsentRecord({ bank_data: true, ai_review: true, communications: true }, 'reacknowledgment', new Date('2026-10-01T00:00:00Z'));
    expect(record).toMatchObject({ source: 'reacknowledgment', version: CONSENT_TERMS_VERSION, communications: true });
    expect(parseConsentRecord(record)).toMatchObject({ source: 'reacknowledgment' });
    expect(parseConsentRecord({ ...record, source: 'support-override' })).toBeNull();
  });
  it('renders the notice, both required checkboxes unchecked, a disabled continue button and a sign-out path', () => {
    const html = renderToStaticMarkup(<ConsentReacknowledgment onRecorded={() => {}} />);
    expect(html).toContain('Please review our updated acknowledgments');
    expect(html).toContain(`updated on ${CONSENT_TERMS_VERSION}`);
    expect(html).toContain('Notice at Collection');
    expect(html).toContain('id="reack-');
    expect(html).not.toMatch(/checked=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Agree and continue/);
    expect(html).toMatch(/Sign out|Log out/i);
    expect(html).not.toMatch(/maximi[sz]e|file your taxes|guarantee/i);
  });
});
