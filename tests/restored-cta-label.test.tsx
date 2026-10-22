import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ user: null as { id: string } | null, loading: true }));

vi.mock('@/lib/firebase/auth-context', () => ({
  useAuth: () => auth,
}));

import { CtaButton } from '@/components/landing/restored/cta-button';

function signUpLabel(html: string): string {
  const match = html.match(/<a\b[^>]*href="\/auth\/sign-up"[^>]*>([^<]*)</);
  if (!match) throw new Error(`no sign-up anchor in ${html}`);
  return match[1];
}

describe('restored landing sign-up label', () => {
  it('keeps the signed-out label the same while auth loads and after it finishes', () => {
    auth.user = null;
    auth.loading = true;
    const loadingLabel = signUpLabel(renderToStaticMarkup(<CtaButton />));
    auth.loading = false;
    const readyLabel = signUpLabel(renderToStaticMarkup(<CtaButton />));
    expect(loadingLabel).toBe(readyLabel);
    expect(loadingLabel).toBe('Get Started Free');
  });
});
