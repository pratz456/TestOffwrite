import type { CalendarEvidenceEvent, EmailEvidenceAttachment } from './types';

/** Compare the recorded calendar day, without shifting all-day/local events through UTC. */
export function rankCalendarEvents(events: CalendarEvidenceEvent[], transactionDate: string): CalendarEvidenceEvent[] {
  const day = Date.parse(`${transactionDate.slice(0, 10)}T12:00:00Z`);
  const distance = (event: CalendarEvidenceEvent) => {
    const eventDay = Date.parse(`${event.startsAt.slice(0, 10)}T12:00:00Z`);
    return Number.isFinite(day) && Number.isFinite(eventDay) ? Math.abs(day - eventDay) : Infinity;
  };
  return [...events].sort((a, b) => distance(a) - distance(b) || a.startsAt.localeCompare(b.startsAt));
}

export function evidenceAttachmentFile(attachment: EmailEvidenceAttachment): File {
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'].includes(attachment.mimeType) ||
      attachment.size <= 0 || attachment.size > 8 * 1024 * 1024 || attachment.base64.length > 12 * 1024 * 1024) {
    throw new Error('This attachment is not a supported receipt.');
  }
  const binary = atob(attachment.base64);
  if (binary.length !== attachment.size) throw new Error('The attachment is incomplete. Preview the email again.');
  return new File([Uint8Array.from(binary, character => character.charCodeAt(0))], attachment.filename, { type: attachment.mimeType });
}
