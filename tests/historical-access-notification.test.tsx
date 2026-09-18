import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: () => [state.values[state.cursor++], vi.fn()], useEffect: vi.fn() };
});
vi.mock('@/lib/firebase/auth-context', () => ({ useAuth: () => ({ user: { id: 'fixture-user' } }) }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { HistoricalAccessNotification } from '@/components/historical-access-notification';
import { TrialCountdown } from '@/components/trial-countdown';

const expired = { hasAccess: false, isTrial: false, isPaid: false, subscriptionStatus: 'expired', trialEnd: '2020-01-01T00:00:00Z' };
beforeEach(() => { state.cursor = 0; state.values = [false, false, expired]; });

describe('trial-ended bank history notice', () => {
  it('distinguishes the free import window from retained saved records and limits the upgrade promise', () => {
    const html = renderToStaticMarkup(<HistoricalAccessNotification />);
    expect(html).toContain('Free Trial Ended');
    expect(html).toContain('Free accounts can import the last 90 days');
    expect(html).toContain('your saved records remain accessible');
    expect(html).toContain('up to 2 years of bank history, depending on bank availability');
    expect(html).toContain('Upgrade Now');
    expect(html).not.toMatch(/now seeing 3 months|restore 1-year|1-year access/);
  });
  it('remains hidden for a verified active subscription', () => {
    state.values[2] = { ...expired, hasAccess: true, isPaid: true };
    expect(renderToStaticMarkup(<HistoricalAccessNotification />)).toBe('');
  });
  it('remains hidden after dismissal', () => {
    state.values[0] = true;
    expect(renderToStaticMarkup(<HistoricalAccessNotification />)).toBe('');
  });
});

describe('trial countdown history policy copy', () => {
  it.each([
    { isTrial: true, days: 0, heading: 'Free Trial Expired' },
    { isTrial: false, days: 0, heading: 'Subscription Period Ended' },
    { isTrial: true, days: 3, heading: 'Your free trial ends in 3 days' },
    { isTrial: false, days: 3, heading: 'This billing period ends in 3 days' },
  ])('describes retained records and bank availability for $heading', ({ isTrial, days, heading }) => {
    state.values = [{ days, hours: 0, minutes: 0, seconds: 0 }];
    const html = renderToStaticMarkup(<TrialCountdown trialEnd={new Date('2026-09-20T12:00:00Z')} isTrial={isTrial} />);
    expect(html).toContain(heading);
    expect(html).toContain('Free accounts can import the last 90 days');
    expect(html).toContain('saved records remain accessible');
    expect(html).toContain('up to 2 years of bank history, depending on bank availability');
    expect(html).not.toMatch(/3 months|1-year access|restore.*access/);
    if (!isTrial) expect(html).not.toMatch(/free trial/i);
  });
});
