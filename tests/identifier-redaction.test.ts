import { describe, expect, it } from 'vitest';
import { containsIdentifierShapedDigits, REDACTED_ID, redactIdentifierStrings, redactIdentifierText, redactPersonalDetails } from '../lib/security/identifier-redaction';

// Redaction runs on OCR text before any model call and on organizer free text
// before storage. Every value here is synthetic.
describe('taxpayer-identifier redaction', () => {
  it.each([
    ['SSN with dashes', 'Employee SSN 123-45-6789 on Box a'],
    ['SSN with spaces', 'a Employee social security number 123 45 6789'],
    ['SSN with dots', 'SSN 123.45.6789'],
    ['SSN with a unicode dash', 'SSN 123‑45‑6789'],
    ['ITIN (9xx)', "Recipient's TIN 912-70-1234"],
    ['a bare nine-digit run', 'control number 987654321 listed'],
    ['a nine-digit run after an OCR-misread colon (period)', 'SSN.123456789 on Box a'],
    ['a nine-digit run after an OCR-misread colon (comma)', 'SSN,123456789 on Box a'],
    ['a nine-digit run in parentheses', 'Employee (123456789) listed'],
    ['a nine-digit run glued to a label', 'SSN123456789'],
  ])('replaces %s with the marker', (_label, text) => {
    const result = redactIdentifierText(text);
    expect(result.count).toBe(1);
    expect(result.text).toContain(REDACTED_ID);
    expect(result.text).not.toMatch(/\d{3}[-\s.‑]?\d{2}[-\s.‑]?\d{4}/);
    expect(containsIdentifierShapedDigits(text)).toBe(true);
  });

  it('replaces EIN-shaped values and reports them for server-side use only', () => {
    const result = redactIdentifierText("Employer identification number 12-3456789. Payer's TIN 98 7654321. Same EIN 12-3456789 again.");
    expect(result.text).toBe(`Employer identification number ${REDACTED_ID}. Payer's TIN ${REDACTED_ID}. Same EIN ${REDACTED_ID} again.`);
    expect(result.count).toBe(3);
    expect(result.eins).toEqual(['12-3456789', '98-7654321']);
  });

  it.each([
    ['a dollar amount over nine digits', 'Gross payments $123,456,789'],
    ['a dollar amount with cents', 'Wages $123456789.00 total'],
    ['a comma-grouped number', 'Total 123,456,789 units'],
    ['a decimal nine-digit number', 'Rate 123456789.5 applied'],
    ['a short number', 'Box 12a code D 12345'],
    ['a date', 'Issued 2025-01-31 for tax year 2025'],
    ['a phone number', 'Call 555-123-4567'],
    ['a ZIP+4 code', 'Austin TX 78701-1234'],
    ['a ten-digit number', 'Account 1234567890'],
    ['a nine-digit decimal fraction', 'Rate 0.123456789 applied'],
    ['an amount after a stray comma', 'Total,123456789.00 due'],
    ['a version-like number', 'Build v2.123456789'],
  ])('leaves %s alone', (_label, text) => {
    const result = redactIdentifierText(text);
    expect(result.text).toBe(text);
    expect(result.count).toBe(0);
    expect(containsIdentifierShapedDigits(text)).toBe(false);
  });

  it('keeps only the primary SSN last four for owner matching when asked, and never by default', () => {
    const text = 'Employee SSN 123-45-6789 Spouse SSN 987-65-4321 EIN 12-3456789 Wages $65,000.00';
    const kept = redactIdentifierText(text, { keepPrimarySSNLast4: true });
    expect(kept.text).toBe(`Employee SSN ***-**-6789 Spouse SSN ${REDACTED_ID} EIN ${REDACTED_ID} Wages $65,000.00`);
    expect(kept.ssnLast4).toBe('6789');
    expect(kept.count).toBe(3);
    expect(kept.eins).toEqual(['12-3456789']);
    const plain = redactIdentifierText(text);
    expect(plain.text).toBe(`Employee SSN ${REDACTED_ID} Spouse SSN ${REDACTED_ID} EIN ${REDACTED_ID} Wages $65,000.00`);
    expect(plain.ssnLast4).toBeNull();
  });

  it('never leaves any nine digits of a redacted identifier in the output', () => {
    const text = 'W-2 2025 a 123-45-6789 b 12-3456789 d 555444333 1 65,000.00 2 7,250.10 $1,234,567.89 16 65000.00';
    const { text: redacted } = redactIdentifierText(text, { keepPrimarySSNLast4: true });
    for (const identifier of ['123456789', '123-45-6789', '12-3456789', '555444333']) expect(redacted).not.toContain(identifier);
    for (const amount of ['65,000.00', '7,250.10', '$1,234,567.89', '65000.00', '2025']) expect(redacted).toContain(amount);
  });

  it('redacts every string nested in a JSON-like payload and leaves other values untouched', () => {
    const when = new Date('2026-05-04T00:00:00Z');
    const payload = {
      note: 'Paid 123-45-6789 for $1,250.00',
      amount_usd: 123456789, date_iso: '2026-05-04', flag: true, empty: null,
      attendees: ['Jane 987-65-4321', 'Client EIN 12-3456789', 'Bob'],
      mileage_details: { miles: 12.5, business_purpose: 'Drove to see payer 987654321' },
      when,
    };
    const redacted = redactIdentifierStrings(payload);
    expect(redacted).toEqual({
      note: `Paid ${REDACTED_ID} for $1,250.00`,
      amount_usd: 123456789, date_iso: '2026-05-04', flag: true, empty: null,
      attendees: [`Jane ${REDACTED_ID}`, `Client EIN ${REDACTED_ID}`, 'Bob'],
      mileage_details: { miles: 12.5, business_purpose: `Drove to see payer ${REDACTED_ID}` },
      when,
    });
    expect(redacted.when).toBe(when);
    expect(payload.note).toContain('123-45-6789');
  });
});

describe('account holder name and postal address redaction (no-consent document text path)', () => {
  const text = [
    "c Employer's name Synthetic Employer LLC 100 Main St Austin TX 78701-1234",
    "e Employee's first name and initial Last name Jordan Demo f Employee's address and ZIP code 42 Oak Avenue Apt 3 Austin, TX 78702",
    'Prepared by Demo, Jordan A. for tax year 2025', 'P.O. Box 1187 Round Rock, TX 78680',
    '1 Wages, tips, other compensation 65,000.00 2 Federal income tax withheld 7,250.10 15 State TX 16 State wages 65000.00',
  ].join('\n');
  it('removes the holder name in either order and every street, PO box and city/state/ZIP line while keeping amounts and the employer name', () => {
    const { text: output, count } = redactPersonalDetails(text, ['Jordan Demo']);
    for (const leaked of ['Jordan', 'Demo, Jordan', '100 Main St', '42 Oak Avenue', '78701', '78702', 'P.O. Box 1187', 'Round Rock']) expect(output).not.toContain(leaked);
    expect(output).toContain('Synthetic Employer LLC');
    for (const kept of ['65,000.00', '7,250.10', '65000.00', 'tax year 2025', '15 State TX 16 State wages']) expect(output).toContain(kept);
    expect(output.match(/\[redacted-address\]/g)).toHaveLength(6);
    expect(output.match(/\[redacted-name\]/g)).toHaveLength(2);
    expect(count).toBe(8);
  });
  it('ignores single-word or empty names and tolerates missing values', () => {
    const { text: output } = redactPersonalDetails('Owner paid 1,200.00 to Main Street Bakery on 5 May 2026', ['Owner', '', null, undefined, 'A B']);
    expect(output).toBe('Owner paid 1,200.00 to Main Street Bakery on 5 May 2026');
  });
});
