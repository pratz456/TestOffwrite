import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const harness = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], request: vi.fn(), auth: { currentUser: { uid: 'owner' } as { uid: string } | null } }));
vi.mock('@/lib/firebase/client', () => ({ auth: harness.auth }));
vi.mock('@/lib/firebase/api-client', () => ({ makeAuthenticatedRequest: harness.request }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const hooks = {
    useState(initial: unknown) { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = typeof initial === 'function' ? initial() : initial; return [harness.slots[index], (next: unknown) => { harness.slots[index] = typeof next === 'function' ? next(harness.slots[index]) : next; }]; },
    useRef(initial: unknown) { const index = harness.cursor++; if (!(index in harness.slots)) harness.slots[index] = { current: initial }; return harness.slots[index]; },
    useEffect(effect: () => void | (() => void), deps: unknown[]) { const index = harness.cursor++; const previous = harness.slots[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) { const next: any = { deps }; harness.slots[index] = next; harness.effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); }); } },
  };
  return { ...actual, ...hooks, default: { ...actual.default, ...hooks } };
});
import { EvidenceImportDialog } from '@/components/evidence-import-dialog';

type Element = ReactElement<Record<string, any>>;
function walk(node: any): Element[] { if (Array.isArray(node)) return node.flatMap(walk); return node && typeof node === 'object' ? [node, ...walk(node.props?.children)] : []; }
function text(node: any): string { if (Array.isArray(node)) return node.map(text).join(''); if (node && typeof node === 'object') return text(node.props?.children); return typeof node === 'string' ? node : ''; }
const attach = vi.fn(), purpose = vi.fn();
let kind: 'email' | 'calendar', hasReceipt: boolean;
function render() { harness.cursor = 0; const tree = EvidenceImportDialog({ kind, transactionId: 'transaction', merchant: 'Vendor', transactionDate: '2026-09-23', hasReceipt, onAttachReceipt: attach, onConfirmPurpose: purpose }); harness.effects.splice(0).forEach(effect => effect()); return tree; }
function button(label: string) { return walk(render()).find(node => node.props?.onClick && text(node).trim() === label)!; }
async function preview() {
  button(kind === 'email' ? 'Import email receipt' : 'Use calendar event').props.onClick();
  const input = walk(render()).find(node => node.props?.type === 'file')!;
  input.props.onChange({ target: { files: [new File(['fixture'], kind === 'email' ? 'receipt.eml' : 'event.ics')], value: '' } });
  await new Promise(resolve => setImmediate(resolve));
}
beforeEach(() => {
  harness.slots = []; harness.effects = []; harness.cursor = 0; harness.auth.currentUser = { uid: 'owner' };
  kind = 'email'; hasReceipt = false; attach.mockReset().mockResolvedValue(undefined); purpose.mockReset().mockResolvedValue(undefined);
  harness.request.mockReset().mockResolvedValue(Response.json({ kind: 'email', subject: '<script>do not render</script>', sender: 'Vendor', sentAt: null, textPreview: '', skippedAttachments: 0, attachments: [{ id: 'attachment', filename: 'receipt.png', mimeType: 'image/png', size: 1, base64: 'YQ==' }] }));
});

describe('evidence confirmation UI handlers', () => {
  it('previews only, requires an attachment choice, and confirms exactly that file', async () => {
    await preview(); expect(attach).not.toHaveBeenCalled(); expect(purpose).not.toHaveBeenCalled();
    expect(harness.request).toHaveBeenCalledWith('/api/transactions/transaction/evidence/preview', expect.objectContaining({ method: 'POST', cache: 'no-store' }));
    expect(button('Attach selected receipt').props.disabled).toBe(true);
    walk(render()).find(node => node.props?.type === 'radio')!.props.onChange();
    await button('Attach selected receipt').props.onClick();
    expect(attach).toHaveBeenCalledOnce(); expect(attach.mock.calls[0][0].name).toBe('receipt.png'); expect(purpose).not.toHaveBeenCalled();
  });
  it('requires explicit replacement of an already attached receipt', async () => {
    hasReceipt = true; await preview();
    walk(render()).find(node => node.props?.type === 'radio')!.props.onChange();
    expect(button('Attach selected receipt').props.disabled).toBe(true);
    await button('Attach selected receipt').props.onClick(); expect(attach).not.toHaveBeenCalled();
    walk(render()).find(node => node.props?.type === 'checkbox')!.props.onChange({ target: { checked: true } });
    await button('Attach selected receipt').props.onClick(); expect(attach).toHaveBeenCalledOnce();
  });
  it('requires an event choice and saves the edited purpose without inferring classification', async () => {
    kind = 'calendar'; harness.request.mockResolvedValue(Response.json({ kind: 'calendar', skippedEvents: 0, events: [{ id: 'event', title: 'Client lunch', startsAt: '2026-09-23T12:00:00', timezone: 'Recorded', attendees: [], location: '', recurring: false, proposedPurpose: 'Client lunch' }] }));
    await preview(); expect(button('Save business purpose').props.disabled).toBe(true); expect(purpose).not.toHaveBeenCalled();
    walk(render()).find(node => node.type === 'select')!.props.onChange({ target: { value: 'event' } });
    walk(render()).find(node => node.props?.['aria-label'] === 'Confirm business purpose')!.props.onChange({ target: { value: 'Discuss the client website project' } });
    await button('Save business purpose').props.onClick();
    expect(purpose).toHaveBeenCalledWith('Discuss the client website project'); expect(attach).not.toHaveBeenCalled();
  });
  it('blocks save after the signed-in owner changes', async () => {
    await preview(); walk(render()).find(node => node.props?.type === 'radio')!.props.onChange();
    harness.auth.currentUser = { uid: 'another-owner' }; await button('Attach selected receipt').props.onClick();
    expect(attach).not.toHaveBeenCalled(); expect(text(render())).toContain('Sign in again before saving');
  });
  it('keeps the preview and error for retry when saving fails', async () => {
    await preview(); walk(render()).find(node => node.props?.type === 'radio')!.props.onChange();
    attach.mockRejectedValueOnce(new Error('Upload service is unavailable'));
    await button('Attach selected receipt').props.onClick();
    expect(text(render())).toContain('Upload service is unavailable'); expect(button('Attach selected receipt').props.disabled).toBe(false);
  });
  it('aborts a preview when the dialog closes and does not expose late results', async () => {
    let resolve!: (result: Response) => void; harness.request.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    await preview(); const signal = harness.request.mock.calls[0][1].signal;
    walk(render()).find(node => node.props?.onOpenChange)!.props.onOpenChange(false);
    expect(signal.aborted).toBe(true);
    resolve(Response.json({ kind: 'email', subject: 'late private data', attachments: [], skippedAttachments: 0 }));
    await new Promise(done => setImmediate(done)); expect(text(render())).not.toContain('late private data');
  });
});
