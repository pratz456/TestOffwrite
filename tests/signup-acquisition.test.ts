import { describe, expect, it } from 'vitest';
import {
  ACQUISITION_FIELDS, ACQUISITION_STORAGE_KEY, ACQUISITION_TTL_MS, captureFirstTouch, readStoredAcquisition,
  type CaptureSource, type KeyValueStorage,
} from '@/lib/analytics/acquisition';
import { attributeSignup, trackSignUp } from '@/lib/analytics/sign-up';

const NOW = Date.parse('2026-10-22T19:00:00.000Z');
const SOURCE: CaptureSource = {
  search: '?utm_source=Newsletter&utm_medium=email&utm_campaign=spring_launch&utm_content=hero&email=person@example.com',
  referrer: 'https://news.ycombinator.com/item?id=1&token=secret',
  pathname: '/pricing',
  hostname: 'writeoffapp.com',
};

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { snapshot(): Record<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
    snapshot: () => Object.fromEntries(values),
  };
}

describe('first-touch campaign capture', () => {
  it('stores the utm fields, the referrer host, and the landing path', () => {
    const storage = memoryStorage();
    const captured = captureFirstTouch(storage, NOW, SOURCE);
    expect(captured).toEqual({
      utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'spring_launch', utm_content: 'hero',
      referrerHost: 'news.ycombinator.com', landingPath: '/pricing', capturedAt: '2026-10-22T19:00:00.000Z',
    });
    const raw = storage.snapshot()[ACQUISITION_STORAGE_KEY];
    expect(raw).not.toContain('person@example.com');
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('/item');
    expect(JSON.parse(raw).expiresAt).toBe(NOW + ACQUISITION_TTL_MS);
  });

  it('keeps the first capture when a later page load has different parameters', () => {
    const storage = memoryStorage();
    captureFirstTouch(storage, NOW, SOURCE);
    const second = captureFirstTouch(storage, NOW + 86_400_000, {
      search: '?utm_source=other', referrer: 'https://example.com/later', pathname: '/blog', hostname: 'writeoffapp.com',
    });
    expect(second?.utm_source).toBe('newsletter');
    expect(second?.landingPath).toBe('/pricing');
    expect(JSON.parse(storage.snapshot()[ACQUISITION_STORAGE_KEY]).expiresAt).toBe(NOW + ACQUISITION_TTL_MS);
  });

  it('drops an expired capture and allows a new first touch', () => {
    const storage = memoryStorage();
    captureFirstTouch(storage, NOW, SOURCE);
    expect(readStoredAcquisition(storage, NOW + ACQUISITION_TTL_MS)).toBeNull();
    expect(storage.snapshot()[ACQUISITION_STORAGE_KEY]).toBeUndefined();
    const next = captureFirstTouch(storage, NOW + ACQUISITION_TTL_MS + 1, {
      search: '?utm_source=second', referrer: '', pathname: '/', hostname: 'writeoffapp.com',
    });
    expect(next).toMatchObject({ utm_source: 'second', capturedAt: new Date(NOW + ACQUISITION_TTL_MS + 1).toISOString() });
  });

  it('stores nothing when the visit has no campaign or external referrer', () => {
    const storage = memoryStorage();
    expect(captureFirstTouch(storage, NOW, {
      search: '?email=person@example.com&token=abc.def.ghi',
      referrer: 'https://www.writeoffapp.com/welcome?next=/dash',
      pathname: '/pricing', hostname: 'writeoffapp.com',
    })).toBeNull();
    expect(captureFirstTouch(storage, NOW, {
      search: '', referrer: 'https://ads.writeoffapp.com/c', pathname: '/', hostname: 'localhost',
    })).toBeNull();
    expect(storage.snapshot()).toEqual({});
  });

  it('caps campaign values and rejects emails, urls, and this site as a referrer', () => {
    const storage = memoryStorage();
    const captured = captureFirstTouch(storage, NOW, {
      search: `?utm_source=${'A'.repeat(80)}&utm_medium=person@example.com&utm_campaign=https://evil.test/a?token=abc&utm_content=spring.sale`,
      referrer: 'https://partners.example.com/creator/42?token=secret',
      pathname: '/r/creator?email=person@example.com',
      hostname: 'www.writeoffapp.com',
    });
    expect(captured).toEqual({
      utm_source: 'a'.repeat(64),
      referrerHost: 'partners.example.com',
      landingPath: '/r/creator',
      capturedAt: '2026-10-22T19:00:00.000Z',
    });
    const raw = storage.snapshot()[ACQUISITION_STORAGE_KEY];
    expect(raw).not.toContain('@');
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('evil.test');
    expect(raw).not.toContain('creator/42');
  });

  it('stores none of the click ids, full referrer, query string, ip, or user agent from a landing URL', () => {
    expect(ACQUISITION_FIELDS).toEqual([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
      'creatorRef', 'referrerHost', 'landingPath', 'capturedAt',
    ]);
    const gclid = 'EAIaIQobChMI123click';
    const fbclid = 'IwAR0fbclickvalue';
    const msclkid = 'msclkidvalue123';
    const ttclid = 'ttclidvalue123';
    const ip = '203.0.113.8';
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
    const storage = memoryStorage();
    const captured = captureFirstTouch(storage, NOW, {
      search: `?utm_source=newsletter&utm_medium=cpc&utm_campaign=spring&utm_content=${gclid}&utm_term=shoes&gclid=${gclid}&fbclid=${fbclid}&msclkid=${msclkid}&ttclid=${ttclid}&ip=${ip}&ua=${encodeURIComponent(userAgent)}`,
      referrer: `https://l.facebook.com/l.php?u=https%3A%2F%2Fwriteoffapp.com%2Fpricing&fbclid=${fbclid}&gclid=${gclid}`,
      pathname: `/pricing?plan=pro&gclid=${gclid}&fbclid=${fbclid}`,
      hostname: 'writeoffapp.com',
    });
    expect(captured).toEqual({
      utm_source: 'newsletter', utm_medium: 'cpc', utm_campaign: 'spring',
      referrerHost: 'l.facebook.com', landingPath: '/pricing', capturedAt: '2026-10-22T19:00:00.000Z',
    });
    const raw = storage.snapshot()[ACQUISITION_STORAGE_KEY].toLowerCase();
    for (const secret of [gclid, fbclid, msclkid, ttclid, ip, 'mozilla', 'l.php', 'plan=pro', 'utm_term', 'https://']) {
      expect(raw).not.toContain(secret.toLowerCase());
    }

    const ipReferrer = memoryStorage();
    expect(captureFirstTouch(ipReferrer, NOW, {
      search: `?gclid=${gclid}&fbclid=${fbclid}`,
      referrer: `https://${ip}/landing?q=tax&fbclid=${fbclid}`,
      pathname: `/?gclid=${gclid}`,
      hostname: 'writeoffapp.com',
    })).toBeNull();
    expect(ipReferrer.snapshot()).toEqual({});
  });

  it('stores the landing page as the pathname only', () => {
    const storage = memoryStorage();
    const captured = captureFirstTouch(storage, NOW, {
      search: '?utm_source=newsletter',
      referrer: '',
      pathname: '/blog/x?gclid=abc&fbclid=def#y',
      hostname: 'writeoffapp.com',
    });
    expect(captured?.landingPath).toBe('/blog/x');
    const stored = JSON.parse(storage.snapshot()[ACQUISITION_STORAGE_KEY]) as { landingPath: string };
    expect(stored.landingPath).toBe('/blog/x');
    expect(JSON.stringify(stored)).not.toContain('gclid');
    expect(JSON.stringify(stored)).not.toContain('fbclid');
    expect(JSON.stringify(stored)).not.toContain('#');

    const capped = memoryStorage();
    expect(captureFirstTouch(capped, NOW, {
      search: '?utm_source=newsletter',
      referrer: '',
      pathname: `/${'a'.repeat(80)}?gclid=abc#section`,
      hostname: 'writeoffapp.com',
    })?.landingPath).toBe(`/${'a'.repeat(63)}`);
  });

  it('stores ref as a flat creatorRef and falls back to utm_source for creator or affiliate links', () => {
    const explicit = memoryStorage();
    const captured = captureFirstTouch(explicit, NOW, {
      search: '?ref=Jane_Partner&utm_source=other&utm_medium=creator&email=person@example.com',
      referrer: '', pathname: '/', hostname: 'writeoffapp.com',
    });
    expect(captured).toMatchObject({
      creatorRef: 'jane_partner', utm_source: 'other', utm_medium: 'creator',
    });
    expect(typeof captured?.creatorRef).toBe('string');
    expect(captured).not.toHaveProperty('ref');
    expect(explicit.snapshot()[ACQUISITION_STORAGE_KEY]).not.toContain('@');
    expect(explicit.snapshot()[ACQUISITION_STORAGE_KEY]).not.toContain('http');

    const affiliate = memoryStorage();
    expect(captureFirstTouch(affiliate, NOW, {
      search: '?utm_source=Studio_One&utm_medium=Affiliate',
      referrer: '', pathname: '/welcome', hostname: 'writeoffapp.com',
    })).toMatchObject({ creatorRef: 'studio_one', utm_source: 'studio_one', utm_medium: 'affiliate' });

    const emailOnly = memoryStorage();
    expect(captureFirstTouch(emailOnly, NOW, SOURCE)?.creatorRef).toBeUndefined();

    const rejected = memoryStorage();
    const dropped = captureFirstTouch(rejected, NOW, {
      search: `?ref=${'person@example.com'}&utm_source=ok&utm_campaign=https://evil.test/a`,
      referrer: '', pathname: '/', hostname: 'writeoffapp.com',
    });
    expect(dropped).toMatchObject({ utm_source: 'ok' });
    expect(dropped?.creatorRef).toBeUndefined();
    expect(rejected.snapshot()[ACQUISITION_STORAGE_KEY]).not.toContain('creatorRef');
    expect(rejected.snapshot()[ACQUISITION_STORAGE_KEY]).not.toContain('@');

    const refOnly = memoryStorage();
    expect(captureFirstTouch(refOnly, NOW, {
      search: '?ref=partner_9', referrer: '', pathname: '/start', hostname: 'writeoffapp.com',
    })).toMatchObject({ creatorRef: 'partner_9', landingPath: '/start' });

    const fallback = memoryStorage();
    expect(captureFirstTouch(fallback, NOW, {
      search: '?ref=https://evil.test/a&utm_source=alex&utm_medium=creator',
      referrer: '', pathname: '/', hostname: 'writeoffapp.com',
    })?.creatorRef).toBe('alex');
  });

  it('ignores a same-site referrer and a referrer that is writeoffapp.com on another host', () => {
    const storage = memoryStorage();
    expect(captureFirstTouch(storage, NOW, {
      search: '', referrer: 'https://preview.example.test/in?x=1', pathname: '/', hostname: 'preview.example.test',
    })).toBeNull();
    expect(captureFirstTouch(storage, NOW, {
      search: '?utm_source=partner', referrer: 'https://writeoffapp.com/app/user@example.com', pathname: '/', hostname: 'preview.example.test',
    })).toMatchObject({ utm_source: 'partner' });
    expect(storage.snapshot()[ACQUISITION_STORAGE_KEY]).not.toContain('writeoffapp.com');
    expect(storage.snapshot()[ACQUISITION_STORAGE_KEY]).not.toContain('@');
  });
});

describe('sign_up event', () => {
  const env = { NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-TESTTAG12', NEXT_PUBLIC_APP_ENV: 'production' };
  const acquisition = {
    utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'spring_launch', utm_content: 'hero',
    referrerHost: 'news.ycombinator.com', landingPath: '/pricing', capturedAt: '2026-10-22T19:00:00.000Z',
  };

  it('does nothing when the measurement id is unset or the tag function is absent', () => {
    const gtag = () => { throw new Error('tag should not be called'); };
    expect(trackSignUp('email', 'user-1', acquisition, { env: {}, gtag })).toBe(false);
    expect(trackSignUp('email', 'user-1', acquisition, { env, gtag: null })).toBe(false);
    expect(trackSignUp('email', 'user-1', acquisition, {
      env: { NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-TESTTAG12', NEXT_PUBLIC_APP_ENV: 'staging' }, gtag,
    })).toBe(false);
    expect(trackSignUp('google', 'user-1', acquisition, { env: { NEXT_PUBLIC_GA_MEASUREMENT_ID: 'UA-12345-1' }, gtag })).toBe(false);
  });

  it('sends sign_up once, to the configured measurement id, with method and utm params', () => {
    const calls: unknown[][] = [];
    const storage = memoryStorage();
    const gtag = (...args: unknown[]) => { calls.push(args); };
    expect(trackSignUp('google', 'user-1', acquisition, { env, gtag, storage })).toBe(true);
    expect(trackSignUp('google', 'user-1', acquisition, { env, gtag, storage })).toBe(false);
    expect(calls).toEqual([['event', 'sign_up', {
      method: 'google', send_to: 'G-TESTTAG12',
      utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'spring_launch', utm_content: 'hero',
    }]]);
  });
});

describe('account creation handoff', () => {
  it('does not create a user profile when nothing was captured', async () => {
    await expect(attributeSignup('email', { uid: 'user-1', getIdToken: async () => 'token' }, {
      now: NOW, storage: memoryStorage(), gtag: null, env: { NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-TESTTAG12' },
    })).resolves.toBeUndefined();
  });

  it('does not write a user_profiles document at account creation, and still sends sign_up when the tag is present', async () => {
    const storage = memoryStorage();
    captureFirstTouch(storage, NOW, SOURCE);
    const calls: unknown[][] = [];
    await attributeSignup('email', { uid: 'user-1', getIdToken: async () => 'id-token' }, {
      now: NOW, storage,
      env: { NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-TESTTAG12' },
      gtag: (...args: unknown[]) => { calls.push(args); },
    });
    expect(calls[0]?.[1]).toBe('sign_up');
    expect(calls[0]?.[2]).toMatchObject({ method: 'email', send_to: 'G-TESTTAG12', utm_source: 'newsletter' });
  });
});
