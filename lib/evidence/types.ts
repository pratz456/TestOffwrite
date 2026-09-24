export interface EmailEvidenceAttachment { id: string; filename: string; mimeType: string; size: number; base64: string }
export interface EmailEvidencePreview { kind: 'email'; subject: string; sender: string; sentAt: string | null;
  textPreview: string; attachments: EmailEvidenceAttachment[]; skippedAttachments: number }
export interface CalendarEvidenceEvent { id: string; title: string; startsAt: string; timezone: string; location: string;
  attendees: string[]; recurring: boolean; proposedPurpose: string }
export interface CalendarEvidencePreview { kind: 'calendar'; events: CalendarEvidenceEvent[]; skippedEvents: number }
export type EvidencePreview = EmailEvidencePreview | CalendarEvidencePreview;
export const MAX_EMAIL_EVIDENCE_BYTES = 8 * 1024 * 1024;
export const MAX_CALENDAR_EVIDENCE_BYTES = 1024 * 1024;
