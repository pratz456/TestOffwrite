import { describe, expect, it, vi } from 'vitest';
import { reloadProfileEmail } from '@/lib/onboarding/profile-identity';
vi.mock('@/lib/firebase/client', () => ({ auth: { currentUser: null } }));
const fixture = (email: string | null = null) => ({ uid: 'expected-user', email, reload: vi.fn().mockResolvedValue(undefined) });

describe('missing profile email recovery uses the same authenticated account', () => {
  it('does not reload an identity that already has its email', async () => {
    const current = fixture('existing@example.test');
    await expect(reloadProfileEmail(current.uid, { currentUser: current })).resolves.toBe('existing@example.test');
    expect(current.reload).not.toHaveBeenCalled();
  });
  it('reads the restored email after Firebase reload completes', async () => {
    const current = fixture(); current.reload.mockImplementation(async () => { current.email = 'restored@example.test'; });
    await expect(reloadProfileEmail(current.uid, { currentUser: current })).resolves.toBe('restored@example.test');
    expect(current.reload).toHaveBeenCalledOnce();
  });
  it('coalesces duplicate mount requests for the same Firebase user object', async () => {
    const current = fixture(); let finish!: () => void;
    current.reload.mockImplementation(() => new Promise<void>(resolve => { finish = () => { current.email = 'restored@example.test'; resolve(); }; }));
    const first = reloadProfileEmail(current.uid, { currentUser: current });
    const second = reloadProfileEmail(current.uid, { currentUser: current });
    expect(current.reload).toHaveBeenCalledOnce(); finish();
    await expect(Promise.all([first, second])).resolves.toEqual(['restored@example.test', 'restored@example.test']);
  });
  it('does not reload an absent or replacement account', async () => {
    await expect(reloadProfileEmail('expected-user', { currentUser: null })).rejects.toThrow('account changed');
    const replacement = fixture(); replacement.uid = 'replacement-user';
    await expect(reloadProfileEmail('expected-user', { currentUser: replacement })).rejects.toThrow('account changed');
    expect(replacement.reload).not.toHaveBeenCalled();
  });
  it('never reads a replacement account email after an in-flight reload', async () => {
    const current = fixture(); const client = { currentUser: current }; let finish!: () => void;
    current.reload.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = reloadProfileEmail(current.uid, client);
    client.currentUser = { ...fixture('replacement@example.test'), uid: 'replacement-user' }; finish();
    await expect(pending).rejects.toThrow('account changed');
  });
  it('hides provider error details and allows a deliberate retry', async () => {
    const current = fixture(); current.reload.mockRejectedValueOnce(new Error('private provider diagnostic')).mockImplementationOnce(async () => { current.email = 'restored@example.test'; });
    await expect(reloadProfileEmail(current.uid, { currentUser: current })).rejects.toThrow('Check your connection');
    await expect(reloadProfileEmail(current.uid, { currentUser: current })).resolves.toBe('restored@example.test');
    expect(current.reload).toHaveBeenCalledTimes(2);
  });
  it('does not invent an email when the reload still returns no address', async () => {
    const current = fixture(); await expect(reloadProfileEmail(current.uid, { currentUser: current })).rejects.toThrow('Please try again');
    expect(current.reload).toHaveBeenCalledOnce();
  });
});
