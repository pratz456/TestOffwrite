import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateSandboxSession } from '../lib/tax-filing/column-browser';

describe('Column browser session validation', () => {
  it('accepts only the exact selected sandbox season and documented HTTPS host', () => {
    const userUrl = 'https://app-sandbox.columnapi.com/start?token=synthetic';
    expect(validateSandboxSession({ environment: 'sandbox', taxYear: 2025, userUrl }, 2025)).toBe(userUrl);
  });
  it.each([
    { environment: 'production' }, { taxYear: 2026 }, { taxYear: '2025' }, { userUrl: 'http://app-sandbox.columnapi.com' },
    { userUrl: 'https://app-sandbox.columnapi.com.evil.invalid' }, { userUrl: 'https://app.columnapi.com' },
    { userUrl: 'https://user:password@app-sandbox.columnapi.com' }, { userUrl: 'https://app-sandbox.columnapi.com:8443' },
    { userUrl: 'https://unverified.env.bz' }, { userUrl: 'javascript:alert(1)' }, { userUrl: 'https://app-sandbox.columnapi.com\\@evil.invalid' },
  ])('rejects unsafe or stale session contract %j', override => {
    expect(() => validateSandboxSession({ environment: 'sandbox', taxYear: 2025, userUrl: 'https://app-sandbox.columnapi.com', ...override }, 2025)).toThrow('The filing session could not be verified.');
  });
});

describe('Column SDK loader with a simulated DOM', () => {
  let elements: any[];
  let append: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules(); vi.useFakeTimers(); elements = []; append = vi.fn(); vi.stubGlobal('window', {});
    vi.stubGlobal('document', { createElement: vi.fn((tag: string) => { expect(tag).toBe('script'); const element = { src: '', async: false, referrerPolicy: '', remove: vi.fn(), onload: null, onerror: null }; elements.push(element); return element; }), head: { appendChild: append } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('coalesces concurrent loads and uses only the fixed sandbox script without a referrer', async () => {
    const { loadColumnSandbox } = await import('../lib/tax-filing/column-browser');
    const first = loadColumnSandbox(), second = loadColumnSandbox();
    expect(first).toBe(second); expect(append).toHaveBeenCalledOnce();
    expect(elements[0]).toMatchObject({ src: 'https://app-sandbox.columnapi.com/column-tax.js', async: true, referrerPolicy: 'no-referrer' });
    const sdk = { openModule: vi.fn() }; window.ColumnTax = sdk; elements[0].onload();
    expect(await first).toBe(sdk); expect(await loadColumnSandbox()).toBe(sdk); expect(append).toHaveBeenCalledOnce();
  });
  it('times out, removes failed script and retries with a new promise/script', async () => {
    const { loadColumnSandbox } = await import('../lib/tax-filing/column-browser');
    const first = loadColumnSandbox().catch(error => error);
    await vi.advanceTimersByTimeAsync(15000); expect((await first).message).toContain('could not load'); expect(elements[0].remove).toHaveBeenCalledOnce();
    const second = loadColumnSandbox(); expect(elements).toHaveLength(2);
    const sdk = { openModule: vi.fn() }; window.ColumnTax = sdk; elements[1].onload(); expect(await second).toBe(sdk);
  });
  it('clears failed network loads so retry can succeed', async () => {
    const { loadColumnSandbox } = await import('../lib/tax-filing/column-browser');
    const first = loadColumnSandbox().catch(error => error); elements[0].onerror(); expect((await first).message).toContain('could not load');
    const second = loadColumnSandbox(); const sdk = { openModule: vi.fn() }; window.ColumnTax = sdk; elements[1].onload(); expect(await second).toBe(sdk);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects a loaded script lacking the documented SDK entrypoint and permits retry', async () => {
    const { loadColumnSandbox } = await import('../lib/tax-filing/column-browser');
    const first = loadColumnSandbox().catch(error => error); elements[0].onload(); expect((await first).message).toContain('could not load');
    const second = loadColumnSandbox(); const sdk = { openModule: vi.fn() }; window.ColumnTax = sdk; elements[1].onload(); expect(await second).toBe(sdk);
  });
});
