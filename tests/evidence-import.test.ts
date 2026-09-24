import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ adminApp: {}, adminAuth: {} }));
vi.mock('@/lib/firebase/api-auth', () => ({ getAuthenticatedUser: mocks.auth }));
vi.mock('@/lib/firebase/transactions-server', () => ({ getTransactionServer: mocks.transaction }));
vi.mock('@/lib/security/rate-limit-store', () => import('./fixtures/rate-limit-store'));
import { previewCalendarEvidence, previewEmailEvidence } from '@/lib/evidence/parse';
import { evidenceAttachmentFile, rankCalendarEvents } from '@/lib/evidence/client';
import { POST } from '@/app/api/transactions/[id]/evidence/preview/route';
import { failRateLimitStore, resetRateLimitStore } from './fixtures/rate-limit-store';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const email = (parts = [`Content-Type: image/png\r\nContent-Disposition: attachment; filename="receipt.png"\r\nContent-Transfer-Encoding: base64\r\n\r\n${PNG.toString('base64')}`]) => Buffer.from(`From: Vendor <vendor@example.com>\r\nTo: owner@example.com\r\nSubject: Your receipt\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="evidence"\r\n\r\n${parts.map(part => `--evidence\r\n${part}\r\n`).join('')}--evidence--\r\n`);
const event = (date = '20260923T120000', extras = '') => `BEGIN:VEVENT\r\nUID:event-${date}\r\nDTSTART;TZID=America/Los_Angeles:${date}\r\nSUMMARY:Client lunch\r\nLOCATION:Cafe\r\nATTENDEE;CN=Client Smith:mailto:client@example.com\r\n${extras}END:VEVENT\r\n`;
const calendar = (events = event()) => Buffer.from(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}END:VCALENDAR\r\n`);
function request(file = new File([email()], 'receipt.eml'), options: { id?: string; headers?: HeadersInit; extra?: boolean; duplicate?: boolean } = {}) {
  const body = new FormData(); body.append('file', file);
  if (options.extra) body.append('userId', 'victim');
  if (options.duplicate) body.append('file', file);
  return POST(new NextRequest('https://writeoff.example/api/transactions/tx/evidence/preview', { method: 'POST', body, headers: options.headers || { authorization: 'Bearer test' } }), { params: Promise.resolve({ id: options.id ?? 'tx' }) });
}
beforeEach(() => { vi.clearAllMocks(); resetRateLimitStore(); mocks.auth.mockResolvedValue({ user: { uid: 'owner' }, error: null }); mocks.transaction.mockResolvedValue({ data: { userId: 'owner' }, error: null }); });
afterEach(() => vi.unstubAllGlobals());

describe('offline email evidence', () => {
  it('extracts exact receipt bytes without rendering HTML or contacting linked resources', async () => {
    const fetch = vi.fn(() => { throw new Error('No remote access permitted'); }); vi.stubGlobal('fetch', fetch);
    const preview = await previewEmailEvidence(email([
      'Content-Type: text/html\r\n\r\n<img src="https://attacker.example/tracker"><script>alert(1)</script>',
      `Content-Type: image/png\r\nContent-Disposition: attachment; filename="receipt.png"\r\nContent-Transfer-Encoding: base64\r\n\r\n${PNG.toString('base64')}`,
    ]));
    expect(preview.kind).toBe('email'); if (preview.kind !== 'email') return;
    expect(preview.attachments).toHaveLength(1); expect(preview.textPreview).toBe('');
    expect(preview.attachments[0].base64).toBe(PNG.toString('base64'));
    expect(fetch).not.toHaveBeenCalled();
    const file = evidenceAttachmentFile(preview.attachments[0]);
    expect(Buffer.from(await file.arrayBuffer())).toEqual(PNG);
  });
  it('skips inline images, executable and signature-spoofed attachments', async () => {
    const result = await previewEmailEvidence(email([
      `Content-Type: image/png\r\nContent-Disposition: inline; filename="tracking.png"\r\nContent-Transfer-Encoding: base64\r\n\r\n${PNG.toString('base64')}`,
      'Content-Type: application/x-msdownload\r\nContent-Disposition: attachment; filename="run.exe"\r\n\r\nMZ',
      'Content-Type: image/png\r\nContent-Disposition: attachment; filename="fake.png"\r\n\r\n<script>active</script>',
    ]));
    expect(result).toMatchObject({ kind: 'email', attachments: [], skippedAttachments: 3 });
  });
  it('accepts original PDFs and bounds malformed/excessive MIME', async () => {
    const result = await previewEmailEvidence(email(['Content-Type: application/pdf\r\nContent-Disposition: attachment; filename="receipt.pdf"\r\n\r\n%PDF-1.4 synthetic']));
    expect(result).toMatchObject({ attachments: [{ mimeType: 'application/pdf' }] });
    await expect(previewEmailEvidence(Buffer.from('not email'))).rejects.toThrow('readable .eml');
    await expect(previewEmailEvidence(Buffer.alloc(8 * 1024 * 1024 + 1))).rejects.toThrow('8 MB');
    await expect(previewEmailEvidence(email(Array(33).fill('Content-Type: application/pdf\r\nContent-Disposition: attachment\r\n\r\n%PDF-1.4')))).rejects.toThrow('too many MIME parts');
  });
  it('rejects corrupted preview bytes before creating a client File', () => {
    expect(() => evidenceAttachmentFile({ id: '1', filename: 'file', mimeType: 'text/html', size: 1, base64: 'YQ==' })).toThrow('supported receipt');
    expect(() => evidenceAttachmentFile({ id: '1', filename: 'file', mimeType: 'image/png', size: 5, base64: 'YQ==' })).toThrow('incomplete');
  });
});

describe('calendar evidence does not establish tax eligibility', () => {
  it('preserves recorded timezone/attendees, ignores URLs and never expands recurring events', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const preview = previewCalendarEvidence(calendar(event('20260923T120000', 'RRULE:FREQ=SECONDLY;COUNT=999999999\r\nURL:https://attacker.example\r\nATTACH:https://attacker.example/file\r\n')));
    expect(preview.kind).toBe('calendar'); if (preview.kind !== 'calendar') return;
    expect(preview.events).toHaveLength(1);
    expect(preview.events[0]).toMatchObject({ startsAt: '2026-09-23T12:00:00', timezone: 'America/Los_Angeles', attendees: ['Client Smith'], recurring: true });
    expect(preview.events[0]).not.toHaveProperty('is_deductible');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('ranks calendar days near the transaction and skips cancelled or undated events', () => {
    const preview = previewCalendarEvidence(calendar(event('20260101T120000') + event('20260923T120000') + event('20260924T120000', 'STATUS:CANCELLED\r\n') + 'BEGIN:VEVENT\r\nSUMMARY:No date\r\nEND:VEVENT\r\n'));
    if (preview.kind !== 'calendar') throw new Error('wrong kind');
    expect(preview.skippedEvents).toBe(2);
    expect(rankCalendarEvents(preview.events, '2026-09-23')[0].startsAt).toContain('2026-09-23');
    expect(preview.events[0].startsAt).toContain('2026-01-01');
  });
  it('rejects oversized, deeply nested and too many events', () => {
    expect(() => previewCalendarEvidence(Buffer.alloc(1024 * 1024 + 1))).toThrow('1 MB');
    expect(() => previewCalendarEvidence(calendar(event().repeat(101)))).toThrow('100 events');
    expect(() => previewCalendarEvidence(Buffer.from('BEGIN:VCALENDAR\n' + 'BEGIN:VALARM\n'.repeat(8)))).toThrow('nested');
  });
});

describe('private evidence preview route', () => {
  it('requires sign-in and owner-scoped lookup before parsing', async () => {
    mocks.auth.mockResolvedValueOnce({ user: null, error: 'Unauthorized' });
    expect((await request()).status).toBe(401); expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.transaction.mockResolvedValueOnce({ data: { userId: 'victim' }, error: null });
    expect((await request()).status).toBe(404);
    expect(mocks.transaction).toHaveBeenCalledWith('owner', 'tx');
  });
  it('returns a private preview and exposes no raw parser/provider errors', async () => {
    const response = await request(); expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private, no-store');
    expect(await response.json()).toMatchObject({ kind: 'email', subject: 'Your receipt' });
    mocks.transaction.mockRejectedValueOnce(new Error('credential secret'));
    const failure = await request(); expect(failure.status).toBe(500); expect(await failure.text()).not.toContain('secret');
  });
  it('fails closed on record and rate-limit outages', async () => {
    mocks.transaction.mockResolvedValueOnce({ data: null, error: new Error('unavailable') });
    expect((await request()).status).toBe(503);
    failRateLimitStore(); expect((await request()).status).toBe(503);
  });
  it('rejects cross-site cookie requests, owner parameters, duplicate files and invalid IDs', async () => {
    expect((await request(undefined, { headers: { cookie: '__session=mock', origin: 'https://attacker.example' } })).status).toBe(403);
    expect((await request(undefined, { extra: true })).status).toBe(400);
    expect((await request(undefined, { duplicate: true })).status).toBe(400);
    expect((await request(undefined, { id: '../victim' })).status).toBe(400);
  });
  it('validates extension, actual calendar bytes, and the calendar-specific byte bound', async () => {
    expect((await request(new File([email()], 'wrong.html'))).status).toBe(400);
    expect((await request(new File([email()], 'fake.ics'))).status).toBe(400);
    expect((await request(new File([Buffer.alloc(1024 * 1024 + 1)], 'huge.ics'))).status).toBe(413);
    expect((await request(new File([calendar()], 'event.ics'))).status).toBe(200);
  });
});
