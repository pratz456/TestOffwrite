"use client";

import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { Textarea } from '@/ui/textarea';
import { auth } from '@/lib/firebase/client';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { evidenceAttachmentFile, rankCalendarEvents } from '@/lib/evidence/client';
import { MAX_CALENDAR_EVIDENCE_BYTES, MAX_EMAIL_EVIDENCE_BYTES, type EvidencePreview } from '@/lib/evidence/types';

interface Props {
  kind: 'email' | 'calendar';
  transactionId: string;
  transactionDate: string;
  merchant: string;
  hasReceipt?: boolean;
  onAttachReceipt: (file: File) => Promise<void>;
  onConfirmPurpose: (purpose: string) => Promise<void>;
}

/** Evidence never changes a classification. The user reviews and saves one selected fact. */
export function EvidenceImportDialog({ kind, transactionId, transactionDate, merchant, hasReceipt, onAttachReceipt, onConfirmPurpose }: Props) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<EvidencePreview | null>(null);
  const [selected, setSelected] = useState('');
  const [purpose, setPurpose] = useState('');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const identity = useRef('');
  const active = useRef(true);
  const saving = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort(); }; }, []);
  const reset = () => { setPreview(null); setSelected(''); setPurpose(''); setReplace(false); setError(null); };
  const changeOpen = (next: boolean) => {
    if (saving.current) return;
    controller.current?.abort(); setBusy(null); reset(); setOpen(next);
    identity.current = next ? auth.currentUser?.uid || '' : '';
  };
  const stillOwner = () => active.current && !!identity.current && identity.current === auth.currentUser?.uid;
  const previewFile = async (file?: File) => {
    if (!file) return;
    reset();
    const maximum = kind === 'email' ? MAX_EMAIL_EVIDENCE_BYTES : MAX_CALENDAR_EVIDENCE_BYTES;
    if (!file.size || file.size > maximum || !(kind === 'email' ? /\.eml$/i : /\.ics$/i).test(file.name)) {
      setError(kind === 'email' ? 'Choose an .eml email file of at most 8 MB.' : 'Choose an .ics calendar file of at most 1 MB.'); return;
    }
    if (!stillOwner()) { setError('Sign in again before importing evidence.'); return; }
    const requestController = new AbortController(); controller.current?.abort(); controller.current = requestController;
    setBusy('preview');
    try {
      const form = new FormData(); form.append('file', file);
      const response = await makeAuthenticatedRequest(`/api/transactions/${encodeURIComponent(transactionId)}/evidence/preview`, { method: 'POST', body: form, signal: requestController.signal, cache: 'no-store' });
      const result = await response.json();
      if (requestController.signal.aborted || !stillOwner()) return;
      if (!response.ok) throw new Error(result.error || 'Could not preview this file.');
      if (result.kind !== kind) throw new Error('Choose the correct evidence file type.');
      setPreview(result);
    } catch (cause) {
      if (!requestController.signal.aborted && stillOwner()) setError(cause instanceof Error ? cause.message : 'Could not preview this file.');
    } finally { if (controller.current === requestController) setBusy(null); }
  };
  const save = async () => {
    if (busy || saving.current || !preview) return;
    if (!stillOwner()) { setError('Sign in again before saving evidence.'); return; }
    saving.current = true; setError(null); setBusy('save');
    try {
      if (preview.kind === 'email') {
        const attachment = preview.attachments.find(item => item.id === selected);
        if (!attachment || hasReceipt && !replace) throw new Error('Choose the receipt to attach.');
        await onAttachReceipt(evidenceAttachmentFile(attachment));
      } else {
        if (!preview.events.some(event => event.id === selected) || !purpose.trim()) throw new Error('Choose an event and confirm its business purpose.');
        await onConfirmPurpose(purpose.trim());
      }
      if (stillOwner()) { setOpen(false); reset(); }
    } catch (cause) { if (stillOwner()) setError(cause instanceof Error ? cause.message : 'Could not save. Please retry.'); }
    finally { saving.current = false; if (active.current) setBusy(null); }
  };
  const events = preview?.kind === 'calendar' ? rankCalendarEvents(preview.events, transactionDate) : [];
  const event = events.find(item => item.id === selected);
  const ready = preview?.kind === 'email' ? !!selected && (!hasReceipt || replace) : !!event && !!purpose.trim();
  return <>
    <Button variant="outline" className="min-h-11 w-full" onClick={() => changeOpen(true)}>
      {kind === 'email' ? <Mail className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
      {kind === 'email' ? 'Import email receipt' : 'Use calendar event'}
    </Button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto p-4 sm:p-5" onEscapeKeyDown={event => { if (busy === 'save') event.preventDefault(); }} onInteractOutside={event => { if (busy === 'save') event.preventDefault(); }}>
        <DialogTitle>{kind === 'email' ? 'Receipt from email' : 'Purpose from your calendar'}</DialogTitle>
        <DialogDescription>{kind === 'email' ? 'Open the receipt email, save it as .eml, then choose an attachment below.' : 'Export an event as .ics. Confirm what it was for before saving.'}</DialogDescription>
        <p className="text-xs text-muted-foreground break-words">{merchant} · {transactionDate.slice(0, 10)}</p>
        <label className="space-y-1 text-sm font-medium">{kind === 'email' ? 'Email file (.eml, up to 8 MB)' : 'Calendar file (.ics, up to 1 MB)'}
          <input aria-label={kind === 'email' ? 'Choose email file' : 'Choose calendar file'} type="file" accept={kind === 'email' ? '.eml,message/rfc822' : '.ics,text/calendar'} disabled={!!busy} className="block min-h-11 w-full rounded-lg border border-border p-2 text-sm" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void previewFile(file); }} />
        </label>
        {busy === 'preview' && <p role="status" className="text-sm">Reading selected file…</p>}
        {preview?.kind === 'email' && <div className="space-y-3">
          <div className="rounded-lg bg-muted p-3 text-sm break-words"><p className="font-medium">{preview.subject}</p><p className="text-xs text-muted-foreground">{preview.sender}</p></div>
          {preview.attachments.length ? <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Choose one receipt</legend>{preview.attachments.map(attachment => <label key={attachment.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border p-3 text-sm">
            <input type="radio" name={`evidence-attachment-${transactionId}`} value={attachment.id} checked={selected === attachment.id} disabled={!!busy} onChange={() => setSelected(attachment.id)} />
            <span className="min-w-0 break-words">{attachment.filename}<span className="block text-xs text-muted-foreground">{attachment.mimeType === 'application/pdf' ? 'PDF' : 'Image'} · {Math.max(1, Math.round(attachment.size / 1024))} KB</span></span>
          </label>)}</fieldset> : <p className="text-sm">No supported receipt attachments found. Save the receipt as a PDF or image and upload it in the Receipt tab.</p>}
          {preview.skippedAttachments > 0 && <p className="text-xs text-muted-foreground">{preview.skippedAttachments} inline or unsupported attachments skipped.</p>}
          {hasReceipt && preview.attachments.length > 0 && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={replace} disabled={!!busy} onChange={e => setReplace(e.target.checked)} />Replace the receipt currently attached to this transaction</label>}
        </div>}
        {preview?.kind === 'calendar' && <div className="space-y-3">
          {events.length ? <><label className="space-y-1 text-sm font-medium">Event (nearest dates first)<select aria-label="Calendar event" value={selected} disabled={!!busy} className="min-h-11 w-full rounded-lg border border-border bg-background px-2 text-base sm:text-sm" onChange={e => { const next = events.find(item => item.id === e.target.value); setSelected(e.target.value); setPurpose(next?.proposedPurpose || ''); }}>
            <option value="">Choose an event</option>{events.map(item => <option key={item.id} value={item.id}>{item.startsAt.slice(0, 10)} · {item.title}</option>)}
          </select></label>{event && <>
            <p className="text-xs text-muted-foreground">{event.startsAt.replace('T', ' ')} · {event.timezone}{event.recurring ? ' · Saved recurring event; occurrences are not expanded.' : ''}</p>
            {event.attendees.length > 0 && <details className="text-xs"><summary className="min-h-11 cursor-pointer py-3">{event.attendees.length} recorded attendees</summary><p className="break-words">{event.attendees.join(', ')}</p></details>}
            <label className="space-y-1 text-sm font-medium">Confirm business purpose<Textarea aria-label="Confirm business purpose" value={purpose} disabled={!!busy} onChange={e => setPurpose(e.target.value)} maxLength={500} className="min-h-20" /></label>
            <p className="text-xs text-muted-foreground">Check that this event relates to the purchase. Saving updates the purpose and requests a fresh AI review; it does not confirm a deduction.</p>
          </>}</> : <p className="text-sm">No dated events found. Export the individual event again.</p>}
          {preview.skippedEvents > 0 && <p className="text-xs text-muted-foreground">{preview.skippedEvents} cancelled or unsupported events skipped.</p>}
        </div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {preview && <Button className="min-h-11 w-full" disabled={!!busy || !ready} onClick={save}>{busy === 'save' ? 'Saving…' : kind === 'email' ? 'Attach selected receipt' : 'Save business purpose'}</Button>}
        <p className="text-xs text-muted-foreground">Only the file you choose is read. No inbox or calendar account access.</p>
      </DialogContent>
    </Dialog>
  </>;
}
