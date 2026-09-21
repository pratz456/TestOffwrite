import { describe, expect, it, vi } from 'vitest';
import { notifyProfileUpdated, subscribeToProfileUpdates } from '../lib/onboarding/profile-events';
import { profileLookupState } from '../lib/onboarding/profile';

describe('navigation after inline profile setup', () => {
  it('invalidates a cached missing profile when setup completes without changing the URL', async () => {
    const events = new EventTarget();
    let profile: unknown = null;
    let lookupState = profileLookupState(profile, { code: 'PROFILE_NOT_FOUND' });
    const lookup = vi.fn(async () => { lookupState = profileLookupState(profile, null); });
    const stop = subscribeToProfileUpdates('new-user', () => { void lookup(); }, events);
    expect(lookupState).toBe('missing');
    profile = { name: 'Completed customer', id: 'new-user' };
    notifyProfileUpdated('new-user', events);
    await vi.waitFor(() => expect(lookupState).toBe('existing'));
    expect(lookup).toHaveBeenCalledOnce();
    stop();
  });
  it('ignores completion for another account and stops listening on unmount/account change', () => {
    const events = new EventTarget(); const refresh = vi.fn();
    const stop = subscribeToProfileUpdates('current-user', refresh, events);
    notifyProfileUpdated('other-user', events);
    expect(refresh).not.toHaveBeenCalled();
    stop();
    notifyProfileUpdated('current-user', events);
    expect(refresh).not.toHaveBeenCalled();
  });
});
