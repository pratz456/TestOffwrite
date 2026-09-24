import { simpleParser } from 'mailparser';
import ICAL from 'ical.js';
import { receiptMimeType, receiptSignatureMatches, safeReceiptName } from '@/lib/firebase/receipt-security';
import { MAX_EMAIL_EVIDENCE_BYTES, MAX_CALENDAR_EVIDENCE_BYTES, type EvidencePreview, type CalendarEvidenceEvent, type EmailEvidenceAttachment } from './types';

export class EvidenceImportError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const cleanText = (value: unknown, maximum: number) => typeof value === 'string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, maximum) : '';

/** Offline MIME parsing only. HTML, remote links, nested emails and active attachments never render. */
export async function previewEmailEvidence(bytes: Buffer): Promise<EvidencePreview> {
  if (!bytes.length || bytes.length > MAX_EMAIL_EVIDENCE_BYTES) throw new EvidenceImportError('Choose an email file of at most 8 MB.', 413);
  const source = bytes.toString('utf8');
  if (!/^(?:[\w-]+:[^\r\n]*\r?\n|[ \t]+[^\r\n]*\r?\n)+\r?\n/m.test(source.slice(0, 65536))) throw new EvidenceImportError('This is not a readable .eml email file.');
  if ((source.match(/^Content-Type:\s*multipart\//gim) || []).length > 16 || (source.match(/^Content-Disposition:/gim) || []).length > 32) {
    throw new EvidenceImportError('This email has too many MIME parts. Save the receipt attachment and upload it directly.');
  }
  let parsed;
  try { parsed = await simpleParser(bytes, { skipHtmlToText: true, skipTextToHtml: true, skipTextLinks: true, skipImageLinks: true, keepCidLinks: true }); }
  catch { throw new EvidenceImportError('This email could not be read. Save the receipt attachment and upload it directly.'); }
  if (parsed.attachments.length > 20) throw new EvidenceImportError('Choose an email with at most 20 attachments.');
  const attachments: EmailEvidenceAttachment[] = [];
  let skippedAttachments = 0;
  let totalBytes = 0;
  for (const [index, attachment] of parsed.attachments.entries()) {
    const type = receiptMimeType(attachment.contentType);
    // Ignore inline tracking images/logos, HTML, SVG, executables, nested email and external-body references.
    if (attachment.contentDisposition === 'inline' || attachment.related || !type || !receiptSignatureMatches(attachment.content, type)) { skippedAttachments++; continue; }
    totalBytes += attachment.content.length;
    if (attachments.length >= 10 || totalBytes > MAX_EMAIL_EVIDENCE_BYTES) throw new EvidenceImportError('Choose an email with at most 10 receipt attachments totaling 8 MB.', 413);
    attachments.push({ id: String(index), filename: safeReceiptName(attachment.filename || `receipt-${index + 1}`),
      mimeType: type, size: attachment.content.length, base64: attachment.content.toString('base64') });
  }
  return { kind: 'email', subject: cleanText(parsed.subject, 300) || 'Untitled email', sender: cleanText(parsed.from?.text, 300),
    sentAt: parsed.date && Number.isFinite(parsed.date.getTime()) ? parsed.date.toISOString() : null,
    textPreview: cleanText(parsed.text, 1200), attachments, skippedAttachments };
}

/** Single saved event instances only; never expands RRULEs, follows URLs, or infers a business expense. */
export function previewCalendarEvidence(bytes: Buffer): EvidencePreview {
  if (!bytes.length || bytes.length > MAX_CALENDAR_EVIDENCE_BYTES) throw new EvidenceImportError('Choose a calendar file of at most 1 MB.', 413);
  const source = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (!/^BEGIN:VCALENDAR\r?\n/i.test(source)) throw new EvidenceImportError('Choose a readable .ics calendar file.');
  const lines = source.split(/\r?\n/);
  if (lines.length > 15000 || lines.some(line => line.length > 16000) || (source.match(/^BEGIN:/gim) || []).length > 1000) throw new EvidenceImportError('Export a smaller calendar selection, with at most 100 events.');
  let depth = 0;
  for (const line of lines) { if (/^BEGIN:/i.test(line) && ++depth > 5) throw new EvidenceImportError('This calendar contains unsupported nested data.'); if (/^END:/i.test(line)) depth--; }
  let calendar: ICAL.Component;
  try { calendar = new ICAL.Component(ICAL.parse(source)); } catch { throw new EvidenceImportError('This calendar file could not be read.'); }
  const components = calendar.getAllSubcomponents('vevent');
  if (components.length > 100) throw new EvidenceImportError('Export a smaller calendar selection, with at most 100 events.');
  const events: CalendarEvidenceEvent[] = [];
  let skippedEvents = 0;
  for (const [index, event] of components.entries()) {
    try {
      if (String(event.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED') { skippedEvents++; continue; }
      const start = event.getFirstPropertyValue('dtstart');
      if (!(start instanceof ICAL.Time)) { skippedEvents++; continue; }
      const startsAt = start.toString();
      if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z?)?$/.test(startsAt)) { skippedEvents++; continue; }
      const title = cleanText(event.getFirstPropertyValue('summary'), 250).trim() || 'Untitled event';
      const location = cleanText(event.getFirstPropertyValue('location'), 250);
      const attendees = event.getAllProperties('attendee').slice(0, 30).map(property => cleanText(property.getParameter('cn') || String(property.getFirstValue()).replace(/^mailto:/i, ''), 150)).filter(Boolean);
      const timezone = cleanText(event.getFirstProperty('dtstart')?.getParameter('tzid'), 100) || (start.isDate ? 'All day' : startsAt.endsWith('Z') ? 'UTC' : 'Time as recorded');
      events.push({ id: String(index), title, startsAt, timezone, location, attendees,
        recurring: event.hasProperty('rrule') || event.hasProperty('rdate'),
        proposedPurpose: `Business purpose: ${title}${location ? ` at ${location}` : ''}`.slice(0, 500) });
    } catch { skippedEvents++; }
  }
  return { kind: 'calendar', events, skippedEvents };
}
