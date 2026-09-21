import { describe, expect, it, vi } from 'vitest';
import { missingProfileFields, profileDetailsError, profileLookupState, profileWriteData, type ProfileSetupData } from '@/lib/onboarding/profile';
import { establishVerifiedSession } from '@/lib/onboarding/verification';

const profile: ProfileSetupData = {
  email: ' example@example.com ', name: ' Alex Example ', profession: ['Consultant'],
  businessEntityType: 'Sole Proprietor / Independent Contractor', primaryWorkLocation: 'Home Office',
  workRelatedTravelPattern: '', income: '$47,150 - $100,525', state: 'California', filingStatus: 'Single',
};

describe('profile setup validation and persistence', () => {
  it('rejects whitespace-only names and blank custom professions', () => {
    expect(missingProfileFields({ ...profile, name: '   ' })).toContain('full name');
    expect(missingProfileFields({ ...profile, profession: ['Other'], customProfession: ' ' })).toContain('your profession');
    expect(missingProfileFields(profile)).toEqual([]);
  });

  it('preserves explicit zero income and decimal business use in saved data', () => {
    const result = profileWriteData({ ...profile, w2Income: 0, businessIncome: 1200.55, vehicleBusinessUsePercentage: 62.5 }, false);
    expect(result).toMatchObject({ w2_income: 0, business_income: 1200.55, vehicle_business_use_percentage: 62.5, name: 'Alex Example', email: 'example@example.com' });
  });

  it('does not save hidden business details after the user chooses to skip them', () => {
    const result = profileWriteData({ ...profile, ein: '12-3456789', homeOfficeSqft: 150, totalHomeSqft: 1200, vehicleBusinessUsePercentage: 80, businessPurpose: 'Consulting', businessStartDate: '2025-01-01', w2Income: 0 }, true);
    for (const key of ['ein', 'home_office_sqft', 'total_home_sqft', 'vehicle_business_use_percentage', 'business_purpose', 'business_start_date']) expect(result).not.toHaveProperty(key);
    expect(result.w2_income).toBe(0);
    expect(result).not.toHaveProperty('plaid_token');
  });

  it('uses the entered custom profession without retaining the Other placeholder', () => {
    expect(profileWriteData({ ...profile, profession: ['Consultant', 'Other'], customProfession: '  Carpenter ' }, false).profession).toBe('Consultant, Carpenter');
  });

  it.each([-1, 101, Infinity, NaN])('rejects invalid vehicle business use %s', value => {
    expect(profileDetailsError({ ...profile, vehicleBusinessUsePercentage: value }, false)).toMatch(/between 0% and 100%/);
  });

  it('rejects impossible home-office dimensions and negative income', () => {
    expect(profileDetailsError({ ...profile, homeOfficeSqft: 500, totalHomeSqft: 400 }, false)).toMatch(/cannot be larger/);
    expect(profileDetailsError({ ...profile, w2Income: -100 }, true)).toMatch(/zero or more/);
  });

  it('does not validate hidden skipped business details but still validates personal details', () => {
    expect(profileDetailsError({ ...profile, vehicleBusinessUsePercentage: 130, ein: 'invalid' }, true)).toBeNull();
    expect(profileDetailsError({ ...profile, yearOfBirth: '1899' }, true, 2026)).toMatch(/year of birth/);
  });

  it.each(['2027', '20.5', 'abcd'])('rejects invalid birth year %s', yearOfBirth => {
    expect(profileDetailsError({ ...profile, yearOfBirth }, true, 2026)).toMatch(/year of birth/);
  });

  it('accepts zero and fractional details and optional blank inputs', () => {
    expect(profileDetailsError({ ...profile, w2Income: 0, homeOfficeSqft: 100.5, totalHomeSqft: 1000, vehicleBusinessUsePercentage: 0, ein: '' }, false)).toBeNull();
  });

  it('only treats documented missing-profile results as safe to create', () => {
    expect(profileLookupState(null, { code: 'PROFILE_NOT_FOUND' })).toBe('missing');
    expect(profileLookupState(null, { code: 'FETCH_ERROR' })).toBe('error');
    expect(profileLookupState(null, {})).toBe('error');
    expect(profileLookupState(profile, { code: 'permission-denied' })).toBe('error');
    expect(profileLookupState(profile, null)).toBe('existing');
  });
});

describe('email verification session handoff', () => {
  const verifiedUser = () => ({ emailVerified: true, reload: vi.fn().mockResolvedValue(undefined), getIdToken: vi.fn().mockResolvedValue('synthetic-refreshed-token') });

  it('does not create a session for an unverified user', async () => {
    const user = { ...verifiedUser(), emailVerified: false };
    const request = vi.fn();
    await expect(establishVerifiedSession(user, request)).resolves.toBe(false);
    expect(user.reload).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
    expect(user.getIdToken).not.toHaveBeenCalled();
  });

  it('reloads external verification and forces token refresh before creating the session', async () => {
    const user = { ...verifiedUser(), emailVerified: false };
    user.reload.mockImplementation(async () => { user.emailVerified = true; });
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await expect(establishVerifiedSession(user, request)).resolves.toBe(true);
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(request).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify({ idToken: 'synthetic-refreshed-token' }) }));
  });

  it.each([401, 403, 500])('does not report completion when session creation returns HTTP %s', async status => {
    const request = vi.fn().mockResolvedValue(new Response('private server diagnostic', { status }));
    await expect(establishVerifiedSession(verifiedUser(), request)).rejects.toThrow('could not start your session');
  });

  it('does not send session requests when authentication is missing or reload fails', async () => {
    const request = vi.fn();
    await expect(establishVerifiedSession(null, request)).rejects.toThrow('Sign in again');
    const user = verifiedUser();
    user.reload.mockRejectedValue(new Error('offline'));
    await expect(establishVerifiedSession(user, request)).rejects.toThrow('offline');
    expect(request).not.toHaveBeenCalled();
  });

  it('allows retry after a temporary session error', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const user = verifiedUser();
    await expect(establishVerifiedSession(user, request)).rejects.toThrow();
    await expect(establishVerifiedSession(user, request)).resolves.toBe(true);
  });
});
