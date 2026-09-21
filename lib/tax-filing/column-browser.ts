type ColumnSdk = { openModule(options: { userUrl: string; environment: 'sandbox'; onClose: () => void }): void };
declare global { interface Window { ColumnTax?: ColumnSdk } }
const SDK_URL = 'https://app-sandbox.columnapi.com/column-tax.js';
let pending: Promise<ColumnSdk> | null = null;

export function validateSandboxSession(value: unknown, year: number): string {
  const data = value as { environment?: unknown; taxYear?: unknown; userUrl?: unknown } | null;
  if (data?.environment !== 'sandbox' || data.taxYear !== year || typeof data.userUrl !== 'string'
    || data.userUrl.length > 16384 || /[\s\\]/.test(data.userUrl)) throw new Error('The filing session could not be verified.');
  let url: URL;
  try { url = new URL(data.userUrl); } catch { throw new Error('The filing session could not be verified.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'app-sandbox.columnapi.com' || url.port || url.username || url.password)
    throw new Error('The filing session could not be verified.');
  return data.userUrl;
}

/** Load only after a successful, explicitly consented sandbox launch. No tokens are stored. */
export function loadColumnSandbox(): Promise<ColumnSdk> {
  if (window.ColumnTax?.openModule) return Promise.resolve(window.ColumnTax);
  if (pending) return pending;
  pending = new Promise<ColumnSdk>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL; script.async = true; script.referrerPolicy = 'no-referrer';
    const fail = () => { clearTimeout(timer); script.remove(); pending = null; reject(new Error('The filing sandbox could not load. Please retry.')); };
    const timer = setTimeout(fail, 15_000);
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      if (!window.ColumnTax?.openModule) { fail(); return; }
      resolve(window.ColumnTax);
    };
    document.head.appendChild(script);
  });
  return pending;
}
