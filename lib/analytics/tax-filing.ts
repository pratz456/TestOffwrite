export type TaxFilingEventName =
  | "file_taxes_tab_viewed"
  | "provider_clicked"
  | "redirect_confirmed"
  | "redirect_cancelled"
  | "tax_summary_downloaded";

export type TaxFilingEventParams = Record<string, unknown>;

function safeGtagCall(args: any[]) {
  try {
    const w = window as any;
    const g = typeof w?.gtag === "function" ? w.gtag : (globalThis as any).gtag;
    if (typeof g === "function") {
      g(...args);
      return;
    }

    if (Array.isArray(w?.dataLayer)) {
      w.dataLayer.push({ event: args[1], ...(args[2] || {}) });
    }
  } catch {
    // ignore analytics failures
  }
}

export function trackTaxFilingEvent(
  name: TaxFilingEventName,
  params: TaxFilingEventParams = {}
) {
  if (typeof window === "undefined") return;
  safeGtagCall(["event", name, params]);
}

