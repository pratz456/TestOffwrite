const PROFILE_UPDATED = 'writeoff:profile-updated';

/** Inline setup may finish on the same URL, so navigation alone cannot invalidate the layout. */
export function notifyProfileUpdated(userId: string, target: EventTarget = window) {
  target.dispatchEvent(Object.assign(new Event(PROFILE_UPDATED), { userId }));
}

export function subscribeToProfileUpdates(userId: string, refresh: () => void, target: EventTarget = window) {
  const listener = (event: Event) => {
    if ('userId' in event && event.userId === userId) refresh();
  };
  target.addEventListener(PROFILE_UPDATED, listener);
  return () => target.removeEventListener(PROFILE_UPDATED, listener);
}
