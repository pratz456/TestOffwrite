'use client';

import { useEffect } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { analyticsAllowedOnPath } from '@/lib/analytics/ga-measurement-id';

declare global {
  interface Window { gtag?: (...args: unknown[]) => void; dataLayer?: unknown[] }
}

/**
 * Google Analytics for public pages only. The tag is first loaded from a public page with
 * automatic page views disabled; page views are then sent by this component solely for
 * allowed paths, so a later client-side navigation into the signed-in app, sign-in or
 * checkout is never reported. Protected routes visited directly never load the tag at all.
 */
export function GoogleTag({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const allowed = analyticsAllowedOnPath(pathname);

  useEffect(() => {
    if (!allowed || typeof window.gtag !== 'function') return;
    window.gtag('event', 'page_view', { page_path: pathname, page_location: window.location.href });
  }, [allowed, pathname]);

  if (!allowed) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`} strategy="afterInteractive" />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          gtag('config', ${JSON.stringify(measurementId)}, { send_page_view: false, anonymize_ip: true });
          gtag('event', 'page_view', { page_path: window.location.pathname, page_location: window.location.href });
        `}
      </Script>
    </>
  );
}
