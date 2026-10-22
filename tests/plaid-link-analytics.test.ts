import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackPlaidLinkExit, trackPlaidLinkHandoff, trackPlaidLinkOpen } from '@/lib/analytics/plaid-link';

afterEach(() => { vi.unstubAllGlobals(); });

describe('Plaid Link analytics', () => {
  it('does nothing when the Google tag is not loaded', () => {
    vi.stubGlobal('window', { location: { href: 'https://writeoff.test/protected' } });
    expect(() => trackPlaidLinkOpen({ link_session_id: 'session-1' })).not.toThrow();
    expect(() => trackPlaidLinkHandoff({ link_session_id: 'session-1' })).not.toThrow();
    expect(() => trackPlaidLinkExit({ status: 'requires_credentials', link_session_id: 'session-1' }, { error_code: 'INVALID_CREDENTIALS' })).not.toThrow();
  });

  it('does nothing outside a browser', () => {
    const gtag = vi.fn();
    vi.stubGlobal('gtag', gtag);
    trackPlaidLinkOpen({ link_session_id: 'session-1' });
    expect(gtag).not.toHaveBeenCalled();
  });

  it('sends open, handoff, and exit through gtag with the session, status, and error code only', () => {
    const gtag = vi.fn();
    vi.stubGlobal('window', { gtag });
    const metadata = {
      link_session_id: 'session-1',
      institution_id: 'ins_1',
      institution_name: 'First Bank',
      accounts: [{ id: 'account-1', name: 'Checking', mask: '0000' }],
      public_token: 'public-sandbox-token',
      error_message: 'bad password',
      request_id: 'req-1',
    };
    trackPlaidLinkOpen(metadata);
    trackPlaidLinkHandoff(metadata);
    trackPlaidLinkExit(
      { ...metadata, status: 'requires_credentials' },
      { error_code: 'INVALID_CREDENTIALS', error_message: 'bad password' } as { error_code?: unknown },
    );
    expect(gtag).toHaveBeenNthCalledWith(1, 'event', 'plaid_link_open', { link_session_id: 'session-1' });
    expect(gtag).toHaveBeenNthCalledWith(2, 'event', 'plaid_link_handoff', { link_session_id: 'session-1' });
    expect(gtag).toHaveBeenNthCalledWith(3, 'event', 'plaid_link_exit', {
      link_session_id: 'session-1', status: 'requires_credentials', error_code: 'INVALID_CREDENTIALS',
    });
    expect(JSON.stringify(gtag.mock.calls)).not.toMatch(/ins_1|First Bank|0000|public-sandbox-token|bad password|req-1/);
  });

  it('pushes the same event onto dataLayer when gtag is not a function yet', () => {
    const dataLayer: unknown[] = [];
    vi.stubGlobal('window', { dataLayer });
    trackPlaidLinkExit({ link_session_id: 'session-1', status: 'institution_not_found' }, null);
    expect(dataLayer).toEqual([{ event: 'plaid_link_exit', link_session_id: 'session-1', status: 'institution_not_found' }]);
  });

  it('drops session ids and codes that are not Plaid tokens', () => {
    const gtag = vi.fn();
    vi.stubGlobal('window', { gtag });
    trackPlaidLinkOpen({ link_session_id: 'session 1 / user@example.com' });
    trackPlaidLinkExit({ status: 'user closed the window', error_code: 'not a code' }, null);
    expect(gtag).toHaveBeenNthCalledWith(1, 'event', 'plaid_link_open', {});
    expect(gtag).toHaveBeenNthCalledWith(2, 'event', 'plaid_link_exit', {});
  });
});
