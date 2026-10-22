/**
 * Tax Document Import API
 * Extracts structured data from:
 *   - W-2 forms (photo or PDF scan)
 *   - 1099-NEC, 1099-K, 1099-MISC forms
 *   - Platform annual summaries (Uber, DoorDash, Etsy, Upwork, etc.)
 *
 * Redact-first pipeline (IRC §7216 review, docs/compliance/SECTION_7216_CONSENT_REVIEW_2026-09-17.md row 2):
 *   1. The image is read by local Tesseract OCR on this server.
 *   2. SSN/ITIN/EIN-shaped numbers and bare nine-digit runs are replaced with
 *      [redacted-id]; only the taxpayer's own SSN keeps its last four digits
 *      (***-**-1234) so the document can be matched to the organizer.
 *   3. The redacted TEXT, not the image, goes to the model with the extraction schema.
 *   4. The whole image is sent only when OCR is unusable or the model asks for it,
 *      and then only when the request carries documentImageConsent=true AND the
 *      account holds a signed, current §7216 consent (consents.document_import).
 *      Otherwise the route answers 403 DOCUMENT_IMAGE_CONSENT_REQUIRED.
 * Employer/payer EINs are read locally from the OCR text and never disclosed.
 * No identifier from the document is stored or logged.
 *
 * POST multipart/form-data:
 *   file: image/pdf file
 *   docType: 'w2' | '1099' | 'platform_summary' | 'auto'
 *   taxYear: number (optional, defaults to last year)
 *   commit: 'true' | 'false' (whether to save to Firestore)
 *   documentImageConsent: 'true' when the person authorized the image fallback for this document
 *   confirmedDocType: 'w2' | '1099' when the user picked which form a W-2 save is
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb } from '@/lib/firebase/admin';
import { getOpenAIClientOrThrow, getOpenAIModel } from '@/lib/openai/client';
import { MAX_RECEIPT_BYTES, ReceiptRequestError, receiptFormData, receiptMimeType, receiptSignatureMatches } from '@/lib/firebase/receipt-security';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';
import { documentOcrUsable, recognizeDocumentText } from '@/lib/ocr/document-text';
import { redactIdentifierText, redactPersonalDetails } from '@/lib/security/identifier-redaction';
import { DOCUMENT_IMAGE_CONSENT_REQUIRED } from '@/lib/onboarding/document-import-consent';
import { documentImportConsentOnFile } from '@/lib/onboarding/document-import-consent-server';
import { readOrganizerDocument } from '@/lib/tax-organizer/organizer-server';
import { ssnShapedExpression } from '@/lib/tax-organizer/identifiers';

// ── Extraction prompts per document type ─────────────────────────────────────

type DocumentSource = 'text' | 'image';

/** Prepended when the model receives redacted OCR text instead of the image. */
const TEXT_SOURCE_RULES = `The document is provided below as TEXT produced by local OCR, not as an image. Before this text was produced, Social Security numbers, ITINs and employer identification numbers were removed and appear as [redacted-id]; the taxpayer's own SSN may appear as ***-**-1234. Return null for every SSN, TIN or EIN field and never reconstruct or guess an identification number. OCR text can contain misread characters, so confirm each amount against its box label. If the text is too incomplete or garbled to read the box amounts, return exactly {"needs_image": true, "reason": "<short reason>"} instead of the schema.`;

const W2_PROMPT = `You are a tax document parser. Extract data from this W-2 form with EXTREME precision — errors affect someone's actual tax return.
Return ONLY valid JSON, no markdown, no explanation.

CRITICAL RULES:
- If you cannot clearly read a number, use null — NEVER guess or estimate
- Box numbers on a W-2 are labeled (Box 1, Box 2, etc.) — match them exactly
- Confirm each amount by re-reading the box label before including it
- SSNs and EINs: return null if partially obscured rather than guessing

{
  "docType": "w2",
  "employerName": "string — Box c",
  "employerEIN": "string — Box b (XX-XXXXXXX) or null if obscured",
  "box1Wages": number or null,
  "box2FederalWithheld": number or null,
  "box3SocialSecurityWages": number or null,
  "box4SocialSecurityWithheld": number or null,
  "box5MedicareWages": number or null,
  "box6MedicareWithheld": number or null,
  "box12Codes": [{"code": "string", "amount": number}],
  "box16StateWages": number or null,
  "box17StateWithheld": number or null,
  "state": "string — 2-letter or null",
  "taxYear": number or null,
  "confidence": number,
  "fieldConfidence": {
    "box1Wages": number,
    "box2FederalWithheld": number,
    "box3SocialSecurityWages": number,
    "box5MedicareWages": number
  },
  "imageQualityIssues": ["list any: blur, shadow, rotation, cropping, glare, handwriting"],
  "verificationWarnings": ["list fields that should be manually verified"]
}

taxYear should be inferred from the YEAR field on the form. confidence = 0 means illegible, 1 means crystal clear.`;

const FORM_1099_PROMPT = `You are a tax document parser. Extract data from this 1099 form with EXTREME precision.
Return ONLY valid JSON, no markdown, no explanation.

CRITICAL RULES:
- If you cannot clearly read a dollar amount, return null — NEVER guess
- Confirm the form variant from the header (NEC, K, MISC, INT, DIV) before extracting
- Box 1 on 1099-NEC is nonemployee compensation; Box 1 on 1099-K is gross payments — they are DIFFERENT
- Return null for any field that is unclear rather than estimating

Determine the exact form type from the form header and extract:
{
  "docType": "1099",
  "formVariant": "NEC|K|MISC|INT|DIV",
  "payerName": "string",
  "payerEIN": "string",
  "recipientName": "string",
  "box1Amount": number,
  "box2FederalWithheld": number,
  "box4FederalWithheld": number,
  "grossAmount": number,
  "taxYear": number,
  "platform": "string — e.g. Uber, DoorDash, Etsy, Upwork (if identifiable)",
  "confidence": number
}

For 1099-K: box1Amount is gross payment card/third-party network transactions.
For 1099-NEC: box1Amount is nonemployee compensation.
taxYear should be inferred from the form or default to ${new Date().getFullYear() - 1}.`;

const PLATFORM_SUMMARY_PROMPT = `You are a tax document parser. Extract earnings data from this platform annual earnings/tax summary.
Return ONLY valid JSON, no markdown, no explanation.

This may be from Uber, DoorDash, Instacart, Lyft, Etsy, Upwork, Fiverr, Amazon, or similar.
Extract:
{
  "docType": "platform_summary",
  "platform": "string — platform name",
  "taxYear": number,
  "grossEarnings": number,
  "platformFees": number,
  "netEarnings": number,
  "milesDriven": number,
  "onlineHours": number,
  "trips": number,
  "form1099KAmount": number,
  "form1099NECAmount": number,
  "federalWithheld": number,
  "breakdown": {
    "baseEarnings": number,
    "tips": number,
    "bonuses": number,
    "promotions": number,
    "otherIncome": number
  },
  "confidence": number
}

Use null for fields not present in the document. taxYear should be inferred from the document.`;

const AUTO_DETECT_PROMPT = `You are a tax document classifier and parser. Read this document and:
1. Identify what type of tax document it is: W-2, 1099-NEC, 1099-K, 1099-MISC, platform summary, or unknown
2. Extract all relevant financial data

Return ONLY valid JSON:
{
  "docType": "w2|1099|platform_summary|unknown",
  "formVariant": "string or null",
  "platform": "string or null",
  "taxYear": number,
  "primaryAmount": number,
  "federalWithheld": number,
  "employerOrPayerName": "string",
  "allExtractedData": {},
  "confidence": number,
  "notes": "string — any important caveats"
}`;

/** The record that will be saved: the model's type, otherwise the request, otherwise the boxes that decide it. */
function savedDocumentType(data: Record<string, unknown>, requested: string): 'w2' | '1099' | 'platform_summary' | null {
  const detected = (typeof data.docType === 'string' && data.docType) || requested;
  if (detected === 'w2' || detected === '1099' || detected === 'platform_summary') return detected;
  if (data.formVariant || data.form1099KAmount) return '1099';
  if (data.box1Wages !== undefined) return 'w2';
  if (data.grossEarnings !== undefined) return 'platform_summary';
  return null;
}

/** Fields a 1099 carries and a W-2 does not. A photo counts when the model sent one of these. */
const FORM_1099_ONLY_FIELDS = ['formVariant', 'payerName', 'payerEIN', 'recipientName', 'recipientTIN', 'box1Amount', 'box4FederalWithheld', 'grossAmount'] as const;
const TYPE_CHOICE_REQUIRED = 'Choose W-2 or 1099 before saving this document.';

function confirmedDocumentChoice(value: FormDataEntryValue | null): 'w2' | '1099' | null {
  return value === 'w2' || value === '1099' ? value : null;
}

/** A line names a payer, a recipient, or a 1099 box. "taxpayer" does not count as payer. */
function textSuggests1099(text: string): boolean {
  return text.split(/\r?\n/).some(line => (
    /\bpayer\b/i.test(line)
    || /\brecipient(?:['\u2019]s)\b/i.test(line)
    || /\brecipient\s+tin\b/i.test(line)
    || /nonemployee compensation|form 1099|1099-nec|1099-misc|1099-k|payment card and third party network transactions/i.test(line)
  ));
}

function modelReturned1099OnlyField(data: Record<string, unknown>): boolean {
  return FORM_1099_ONLY_FIELDS.some(field => {
    if (!Object.prototype.hasOwnProperty.call(data, field)) return false;
    const value = data[field];
    return value !== null && value !== undefined && value !== '';
  });
}

/** Point a confirmed 1099 at the same fields a native 1099 import saves. */
function applyConfirmed1099(data: Record<string, any>): void {
  if (!data.payerName && data.employerName) data.payerName = data.employerName;
  if (!data.payerEIN && data.employerEIN) data.payerEIN = data.employerEIN;
  if ((data.box1Amount === null || data.box1Amount === undefined) && data.box1Wages != null) data.box1Amount = data.box1Wages;
  if ((data.grossAmount === null || data.grossAmount === undefined) && data.box1Amount != null) data.grossAmount = data.box1Amount;
  if ((data.box4FederalWithheld === null || data.box4FederalWithheld === undefined) && data.box2FederalWithheld != null) data.box4FederalWithheld = data.box2FederalWithheld;
  if (!data.formVariant) data.formVariant = 'NEC';
  data.docType = '1099';
}

/** A W-2 preview's edits, mapped onto the 1099 fields a native import would receive. */
function overridesForConfirmed1099(overrides: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  const next = { ...overrides };
  const copy = (from: string, to: string) => {
    if (Object.prototype.hasOwnProperty.call(next, from) && !Object.prototype.hasOwnProperty.call(next, to)) next[to] = next[from];
  };
  copy('employerName', 'payerName');
  copy('employerEIN', 'payerEIN');
  copy('box1Wages', 'box1Amount');
  copy('box2FederalWithheld', 'box4FederalWithheld');
  delete next.docType;
  return next;
}

// ── Save extracted data to Firestore ─────────────────────────────────────────

async function saveW2(uid: string, data: Record<string, any>, options?: { typeConfirmedByUser?: boolean }) {
  const taxYear = data.taxYear || new Date().getFullYear() - 1;
  const existing = await adminDb
    .collection('w2_income')
    .where('userId', '==', uid)
    .where('taxYear', '==', taxYear)
    .where('employerEIN', '==', data.employerEIN || '')
    .limit(1)
    .get();

  const record = {
    userId: uid,
    taxYear,
    employer: data.employerName || 'Unknown Employer',
    employerEIN: data.employerEIN || '',
    box1Wages: data.box1Wages || 0,
    wages: data.box1Wages || 0, // alias
    box2FederalWithheld: data.box2FederalWithheld || 0,
    federalWithheld: data.box2FederalWithheld || 0, // alias
    box3SocialSecurityWages: data.box3SocialSecurityWages || 0,
    box4SocialSecurityWithheld: data.box4SocialSecurityWithheld || 0,
    box5MedicareWages: data.box5MedicareWages || 0,
    box6MedicareWithheld: data.box6MedicareWithheld || 0,
    box12Codes: data.box12Codes || [],
    box16StateWages: data.box16StateWages || 0,
    box17StateWithheld: data.box17StateWithheld || 0,
    state: data.state || '',
    source: 'document_import',
    ...(options?.typeConfirmedByUser ? { typeConfirmedByUser: true } : {}),
    importedAt: new Date(),
    updatedAt: new Date(),
  };

  if (existing.empty) {
    const ref = await adminDb.collection('w2_income').add({ ...record, createdAt: new Date() });
    return { id: ref.id, action: 'created' };
  } else {
    await existing.docs[0].ref.set(record, { merge: true });
    return { id: existing.docs[0].id, action: 'updated' };
  }
}

async function save1099(uid: string, data: Record<string, any>) {
  const taxYear = data.taxYear || new Date().getFullYear() - 1;
  const record = {
    userId: uid,
    taxYear,
    payer: data.payerName || 'Unknown Payer',
    payerEIN: data.payerEIN || '',
    formType: `1099-${data.formVariant || 'NEC'}`,
    amount: data.grossAmount || data.box1Amount || 0,
    box1Amount: data.box1Amount || 0,
    federalWithheld: data.box4FederalWithheld || data.box2FederalWithheld || 0,
    platform: data.platform || null,
    source: 'document_import',
    importedAt: new Date(),
    updatedAt: new Date(),
  };

  const ref = await adminDb.collection('income_1099').add({ ...record, createdAt: new Date() });
  return { id: ref.id, action: 'created' };
}

async function savePlatformSummary(uid: string, data: Record<string, any>) {
  const taxYear = data.taxYear || new Date().getFullYear() - 1;

  // Save as gross receipt
  const incomeRecord = {
    userId: uid,
    taxYear,
    amount: data.grossEarnings || data.netEarnings || 0,
    source: data.platform || 'Platform',
    type: 'platform_income',
    platform: data.platform || 'unknown',
    platformFees: data.platformFees || 0,
    netEarnings: data.netEarnings || 0,
    milesDriven: data.milesDriven || 0,
    onlineHours: data.onlineHours || 0,
    trips: data.trips || 0,
    breakdown: data.breakdown || {},
    source_detail: 'document_import',
    importedAt: new Date(),
    createdAt: new Date(),
  };
  const ref = await adminDb.collection('gross_receipts').add(incomeRecord);

  // Also save as 1099 if amount present
  if (data.form1099KAmount || data.form1099NECAmount) {
    await adminDb.collection('income_1099').add({
      userId: uid,
      taxYear,
      payer: data.platform || 'Unknown',
      formType: data.form1099KAmount ? '1099-K' : '1099-NEC',
      grossReceiptId: ref.id, // Same imported earnings: documentary evidence, not additional receipts.
      amount: data.form1099KAmount || data.form1099NECAmount || 0,
      federalWithheld: data.federalWithheld || 0,
      platform: data.platform,
      source: 'document_import',
      createdAt: new Date(),
    });
  }

  return { id: ref.id, action: 'created', incomeAdded: incomeRecord.amount };
}

// ── Redact-first extraction ───────────────────────────────────────────────────

const PROMPTS: Record<string, string> = {
  w2: W2_PROMPT,
  '1099': FORM_1099_PROMPT,
  platform_summary: PLATFORM_SUMMARY_PROMPT,
  auto: AUTO_DETECT_PROMPT,
};

type ImageFallbackReason = 'ocr_unavailable' | 'ocr_low_confidence' | 'model_requested_image';

/** Parses the model's JSON (markdown fences stripped); null when it is not JSON. */
function parseModelJson(rawText: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** One extraction call. Text mode sends the redacted OCR text; image mode sends the whole image (consent verified by the caller). */
async function extractDocument(source: DocumentSource, docType: string, payload: { text?: string; dataUrl?: string }) {
  const prompt = PROMPTS[docType] || AUTO_DETECT_PROMPT;
  const content = source === 'text'
    ? [{ type: 'text' as const, text: `${TEXT_SOURCE_RULES}\n\n${prompt}\n\nDOCUMENT TEXT (identification numbers removed):\n${payload.text}` }]
    : [{ type: 'text' as const, text: prompt }, { type: 'image_url' as const, image_url: { url: payload.dataUrl!, detail: 'high' as const } }];
  const response = await getOpenAIClientOrThrow().chat.completions.create({
    model: getOpenAIModel('document'),
    max_tokens: 1500,
    store: false,
    messages: [{ role: 'user', content }],
  });
  const rawText = response.choices[0]?.message?.content || '{}';
  return parseModelJson(rawText);
}

/** Dashed employer/payer form. A bare 9-digit run is not this shape. */
const DASHED_PAYER_NUMBER = /^\d{2}-\d{7}$/;
/** Nine digits with no separator. Kept only from an employer or EIN line that does not say payer. */
const BARE_PAYER_NUMBER = /^\d{9}$/;
const BLOCKED_PAYER_LABEL = /recipient|employee|payee/i;
const EMPLOYER_OR_EIN_LABEL = /employer|\bEIN\b/i;
const PAYER_WORD = /payer/i;
const PAYER_ID_CHECK = 'Check the employer/payer ID';

function payerNumberOrBlank(value: unknown): string | null {
  return typeof value === 'string' && (DASHED_PAYER_NUMBER.test(value) || BARE_PAYER_NUMBER.test(value)) ? value : null;
}

/**
 * A labeled number on its own line. A dashed NN-NNNNNNN stays when the label is not
 * recipient, employee, or payee. A bare 9-digit run stays only when that same line
 * names the employer or EIN and does not say payer. A 3-2-4 value is never kept.
 */
function labeledPayerNumbers(text: string): { kept: string[] } {
  const pattern = /(^|\n)([^\n]*?)(\bEIN\b|identification number|payer(?:'s)? TIN)([^\n\d]{0,60})(\d{2}-\d{7}|\d{9})(?!\d)/gi;
  const kept: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const number = match[5];
    const label = `${match[2]} ${match[3]} ${match[4]}`;
    if (BLOCKED_PAYER_LABEL.test(label)) continue;
    if (DASHED_PAYER_NUMBER.test(number)) {
      kept.push(number);
      continue;
    }
    const at = (match.index ?? 0) + match[0].lastIndexOf(number);
    const lineStart = text.lastIndexOf('\n', at) + 1;
    const lineBreak = text.indexOf('\n', at);
    const line = text.slice(lineStart, lineBreak === -1 ? text.length : lineBreak);
    if (BARE_PAYER_NUMBER.test(number) && EMPLOYER_OR_EIN_LABEL.test(line) && !PAYER_WORD.test(line)) kept.push(number);
  }
  return { kept };
}

/**
 * Every number on a recipient, employee, or payee line, in any format.
 * The line does not also have to say EIN, identification number, or TIN.
 */
function blockedLineDigits(text: string): Set<string> {
  const blocked = new Set<string>();
  const numberPattern = /\d{2}[-\u2010-\u2015. ]\d{7}|\d{3}[- ]\d{2}[- ]\d{4}|\d{9}/g;
  for (const line of text.split('\n')) {
    if (!BLOCKED_PAYER_LABEL.test(line)) continue;
    for (const match of line.matchAll(numberPattern)) blocked.add(match[0].replace(/\D/g, ''));
  }
  return blocked;
}

function addPayerIdCheck(data: Record<string, unknown>): void {
  const current = Array.isArray(data.verificationWarnings) ? data.verificationWarnings : [];
  const warnings = current.filter((item): item is string => typeof item === 'string');
  if (!warnings.includes(PAYER_ID_CHECK)) warnings.push(PAYER_ID_CHECK);
  data.verificationWarnings = warnings;
}

/** Drop the payer check, then put it back only when the saved ID is empty. The saved document and the response share this. */
function syncPayerIdCheck(data: Record<string, unknown>, idEmpty: boolean): void {
  if (!Array.isArray(data.verificationWarnings)) return;
  const warnings = data.verificationWarnings.filter((item: unknown) => item !== PAYER_ID_CHECK);
  if (idEmpty) warnings.push(PAYER_ID_CHECK);
  data.verificationWarnings = warnings;
}

/** A typed employer or payer value is kept only as NN-NNNNNNN. Anything else is cleared, and a non-empty edit asks the user to check it. */
function applyPayerNumberEdits(data: Record<string, unknown>, overrides: Record<string, string | number | boolean | null>): void {
  let rejected = false;
  for (const field of PAYER_NUMBER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(overrides, field)) continue;
    const edited = overrides[field];
    const kept = typeof edited === 'string' && DASHED_PAYER_NUMBER.test(edited) ? edited : null;
    data[field] = kept;
    if (!kept && edited !== null && edited !== undefined && edited !== '') rejected = true;
  }
  if (rejected) addPayerIdCheck(data);
}

/** Photos keep a dashed NN-NNNNNNN only. Any other employer or payer value is cleared and the user is asked to check it. */
function rejectUndashedImagePayerNumbers(data: Record<string, unknown>): void {
  let rejected = false;
  for (const field of PAYER_NUMBER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    const value = data[field];
    if (typeof value === 'string' && DASHED_PAYER_NUMBER.test(value)) continue;
    if (value !== null && value !== undefined && value !== '') rejected = true;
    data[field] = null;
  }
  if (rejected) addPayerIdCheck(data);
}

/** Formats a locally captured EIN as XX-XXXXXXX; the model never sees it. */
function formatEIN(ein: string): string {
  const digits = ein.replace(/\D/g, '');
  return digits.length === 9 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : ein;
}

/**
 * Matches the document's SSN last four against the owner's organizer (decrypted
 * server-side through the Gap 1 read path). Advisory only; nothing is stored.
 */
async function matchDocumentOwner(uid: string, taxYear: number, ssnLast4: string | null): Promise<'taxpayer' | 'spouse' | 'unmatched' | 'unknown'> {
  if (!ssnLast4) return 'unknown';
  try {
    const snap = await adminDb.collection('tax_organizers').where('userId', '==', uid).where('taxYear', '==', taxYear).limit(1).get();
    if (snap.empty) return 'unknown';
    const organizer = await readOrganizerDocument(snap.docs[0]);
    const last4 = (value: unknown) => typeof value === 'string' && value ? value.replace(/\D/g, '').slice(-4) : '';
    const taxpayer = last4(organizer.taxpayerSSN), spouse = last4(organizer.spouseSSN);
    if (!taxpayer && !spouse) return 'unknown';
    if (taxpayer === ssnLast4) return 'taxpayer';
    if (spouse === ssnLast4) return 'spouse';
    return 'unmatched';
  } catch {
    return 'unknown';
  }
}

/** Names the account holder is known by (profile name and organizer taxpayer/spouse names); a read failure redacts nothing extra. */
async function accountHolderNames(uid: string): Promise<string[]> {
  try {
    const profile = await adminDb.collection('user_profiles').doc(uid).get();
    const data = profile.data() ?? {};
    const names = [data.name, data.full_name, data.displayName, [data.first_name, data.last_name].filter(Boolean).join(' '), data.taxpayerName, data.spouseName];
    return names.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  } catch {
    return [];
  }
}

const DOCUMENT_IDENTIFIER_KEYS = new Set([
  'employeessn', 'employeesocialsecuritynumber', 'ssn', 'socialsecuritynumber', 'boxa',
  'recipienttin', 'recipientssn', 'recipientsocialsecuritynumber', 'tin', 'payeetin', 'payeessn', 'employeetin', 'ssnortin',
]);
const W2_PUBLIC_FIELDS = ['docType', 'employerName', 'employerEIN', 'box1Wages', 'box2FederalWithheld', 'box3SocialSecurityWages', 'box4SocialSecurityWithheld', 'box5MedicareWages', 'box6MedicareWithheld', 'box12Codes', 'box16StateWages', 'box17StateWithheld', 'state', 'taxYear', 'confidence', 'fieldConfidence', 'imageQualityIssues', 'verificationWarnings'] as const;
const FORM_1099_PUBLIC_FIELDS = ['docType', 'formVariant', 'payerName', 'payerEIN', 'recipientName', 'box1Amount', 'box2FederalWithheld', 'box4FederalWithheld', 'grossAmount', 'taxYear', 'platform', 'confidence', 'imageQualityIssues', 'verificationWarnings'] as const;
const PLATFORM_PUBLIC_FIELDS = ['docType', 'platform', 'taxYear', 'grossEarnings', 'platformFees', 'netEarnings', 'milesDriven', 'onlineHours', 'trips', 'form1099KAmount', 'form1099NECAmount', 'federalWithheld', 'breakdown', 'confidence', 'imageQualityIssues', 'verificationWarnings'] as const;
const AUTO_PUBLIC_FIELDS = ['docType', 'formVariant', 'platform', 'taxYear', 'primaryAmount', 'federalWithheld', 'employerOrPayerName', 'confidence'] as const;
const BREAKDOWN_FIELDS = ['baseEarnings', 'tips', 'bonuses', 'promotions', 'otherIncome'] as const;
const FIELD_CONFIDENCE_FIELDS = ['box1Wages', 'box2FederalWithheld', 'box3SocialSecurityWages', 'box5MedicareWages'] as const;

const PAYER_NUMBER_FIELDS = new Set(['employerEIN', 'payerEIN']);

function scrubImportText(value: string): string {
  return value.replace(ssnShapedExpression(), '');
}

/** Known document fields only. The set follows the record that will be saved, so an untyped 1099 keeps its payer fields and an untyped W-2 keeps its employer fields. */
function publicDocument(data: Record<string, unknown>, requested = ''): Record<string, unknown> {
  const savedType = savedDocumentType(data, requested);
  const fields = savedType === '1099' ? FORM_1099_PUBLIC_FIELDS
    : savedType === 'platform_summary' ? PLATFORM_PUBLIC_FIELDS
    : savedType === 'w2' ? W2_PUBLIC_FIELDS
    : AUTO_PUBLIC_FIELDS;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) continue;
    const value = data[field];
    if (field === 'box12Codes' && Array.isArray(value)) {
      out[field] = value.filter(item => item !== null && typeof item === 'object').map(item => {
        const row = item as Record<string, unknown>;
        const next: Record<string, unknown> = {};
        if (typeof row.code === 'string') next.code = scrubImportText(row.code);
        if (typeof row.amount === 'number') next.amount = row.amount;
        return next;
      });
      continue;
    }
    if (field === 'breakdown' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const row = value as Record<string, unknown>;
      out[field] = Object.fromEntries(BREAKDOWN_FIELDS.filter(key => typeof row[key] === 'number').map(key => [key, row[key]]));
      continue;
    }
    if (field === 'fieldConfidence' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const row = value as Record<string, unknown>;
      out[field] = Object.fromEntries(FIELD_CONFIDENCE_FIELDS.filter(key => typeof row[key] === 'number').map(key => [key, row[key]]));
      continue;
    }
    if ((field === 'imageQualityIssues' || field === 'verificationWarnings') && Array.isArray(value)) {
      out[field] = value.filter((item): item is string => typeof item === 'string').map(scrubImportText);
      continue;
    }
    if (PAYER_NUMBER_FIELDS.has(field)) { out[field] = payerNumberOrBlank(value); continue; }
    if (typeof value === 'string') { out[field] = scrubImportText(value); continue; }
    if (typeof value === 'number' || value === null || typeof value === 'boolean') out[field] = value;
  }
  return out;
}

/** Removes employee/recipient identification values before a document result is stored or returned. Employer and payer EINs stay. */
function dropDocumentIdentifiers<T>(value: T): T {
  if (typeof value === 'string') return scrubImportText(value) as T;
  if (Array.isArray(value)) return value.map(item => dropDocumentIdentifiers(item)) as T;
  if (value !== null && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const cleaned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (DOCUMENT_IDENTIFIER_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) continue;
      if (PAYER_NUMBER_FIELDS.has(key)) { cleaned[key] = payerNumberOrBlank(entry); continue; }
      cleaned[key] = dropDocumentIdentifiers(entry);
    }
    return cleaned as T;
  }
  return value;
}

function consentRequired(reason: ImageFallbackReason, consentOnFile: boolean) {
  return NextResponse.json({
    error: reason === 'model_requested_image' || reason === 'ocr_low_confidence'
      ? 'WriteOff could not read this document reliably as text on its own server. Reading the full image requires your signed consent to disclose it to OpenAI.'
      : 'WriteOff cannot read this file type as text on its own server. Reading the full document requires your signed consent to disclose it to OpenAI.',
    code: DOCUMENT_IMAGE_CONSENT_REQUIRED,
    reason,
    consentOnFile,
  }, { status: 403 });
}

// ── Main handler ──────────────────────────────────────────────────────────────

const DOC_TYPES = ['w2', '1099', 'platform_summary', 'auto'] as const;
/** The vision model reads photos; a PDF scan must be exported as an image first. */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
const MAX_OVERRIDE_JSON_BYTES = 16 * 1024;

/** Inline edits from the UI: a small flat JSON object of scalar fields. */
function parseOverrideFields(raw: FormDataEntryValue | null): Record<string, string | number | boolean | null> | null {
  if (raw === null || raw === '') return {};
  if (typeof raw !== 'string' || raw.length > MAX_OVERRIDE_JSON_BYTES) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > 64 || entries.some(([key, value]) => key.length > 64 || (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) || (typeof value === 'string' && value.length > 500))) return null;
  return Object.fromEntries(entries) as Record<string, string | number | boolean | null>;
}

export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // One vision-model call per upload; bound it per owner before the body is read.
    const limit = await enforceRateLimit({ ...RATE_LIMITS.taxDocumentImport, key: user.uid });
    if (!limit.allowed) return rateLimitResponse(limit, { error: 'Too many document scans. Please wait a few minutes and try again.' });
    // Bounded multipart read (10 MB) that refuses non-multipart bodies with 400.
    const formData = await receiptFormData(request);
    const file = formData.get('file');
    const docType = String(formData.get('docType') || 'auto');
    const commit = formData.get('commit') !== 'false';
    const taxYearRaw = formData.get('taxYear');
    const taxYear = taxYearRaw ? parseInt(String(taxYearRaw), 10) : null;
    const documentImageConsent = formData.get('documentImageConsent') === 'true';
    // User-edited field overrides (from inline editing in the UI)
    const overrideFields = parseOverrideFields(formData.get('overrideFields'));

    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!DOC_TYPES.includes(docType as typeof DOC_TYPES[number])) return NextResponse.json({ error: 'docType must be w2, 1099, platform_summary or auto' }, { status: 400 });
    if (taxYear !== null && (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100)) return NextResponse.json({ error: 'taxYear must be a four-digit year' }, { status: 400 });
    if (!overrideFields) return NextResponse.json({ error: 'overrideFields must be a small JSON object of edited values' }, { status: 400 });
    if (!file.size || file.size > MAX_RECEIPT_BYTES) return NextResponse.json({ error: 'Upload a nonempty file under 10 MB.' }, { status: 413 });
    const mediaType = receiptMimeType(file.type);
    if (!mediaType || !IMAGE_TYPES.includes(mediaType as typeof IMAGE_TYPES[number])) {
      return NextResponse.json({ error: 'Upload a JPEG, PNG, GIF or WebP photo of the document.' }, { status: 415 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (!receiptSignatureMatches(bytes, mediaType)) return NextResponse.json({ error: 'The file contents do not match its image type.' }, { status: 415 });

    // Step 1-3: local OCR, redaction, text extraction.
    const ocr = await recognizeDocumentText(bytes, mediaType);
    let fallbackReason: ImageFallbackReason | null = ocr === null ? 'ocr_unavailable' : documentOcrUsable(ocr) ? null : 'ocr_low_confidence';
    let disclosure: DocumentSource = 'text';
    let extracted: Record<string, any> | null = null;
    let ssnLast4: string | null = null;
    let localEINs: string[] = [];
    let identifiersRedacted = 0;
    if (fallbackReason === null) {
      const redaction = redactIdentifierText(ocr!.text, { keepPrimarySSNLast4: true });
      ssnLast4 = redaction.ssnLast4;
      const blockedDigits = blockedLineDigits(ocr!.text);
      const labeled = labeledPayerNumbers(ocr!.text);
      localEINs = redaction.eins.map(formatEIN).filter(value => {
        const digits = value.replace(/\D/g, '');
        return DASHED_PAYER_NUMBER.test(value) && !blockedDigits.has(digits);
      });
      for (const value of labeled.kept) {
        const digits = value.replace(/\D/g, '');
        if (blockedDigits.has(digits)) continue;
        if (!localEINs.some(existing => existing.replace(/\D/g, '') === digits)) localEINs.push(value);
      }
      // The no-consent path also keeps the account holder's name and postal addresses on this server;
      // the boxes the model extracts are numeric and the employer name stays for labeling.
      const personal = redactPersonalDetails(redaction.text, await accountHolderNames(user.uid));
      identifiersRedacted = redaction.count + personal.count;
      extracted = await extractDocument('text', docType, { text: personal.text });
      if (extracted?.needs_image === true) { fallbackReason = 'model_requested_image'; extracted = null; }
    }

    // Step 4: the image leaves this server only with the request flag AND the signed consent on file.
    if (fallbackReason !== null) {
      const consentOnFile = await documentImportConsentOnFile(user.uid);
      if (!documentImageConsent || !consentOnFile) return consentRequired(fallbackReason, consentOnFile);
      disclosure = 'image';
      extracted = await extractDocument('image', docType, { dataUrl: `data:${mediaType};base64,${bytes.toString('base64')}` });
    }

    if (!extracted || extracted.needs_image === true) {
      return NextResponse.json({
        error: 'Failed to parse the document. The image may be unclear or use an unsupported format.',
        disclosure,
      }, { status: 422 });
    }

    // Override taxYear if provided
    if (taxYear) extracted.taxYear = taxYear;

    // A W-2 that still reads like a 1099 is not saved until the user picks the form.
    const confirmedDocType = confirmedDocumentChoice(formData.get('confirmedDocType'));
    const needsTypeConfirmation = savedDocumentType(extracted, docType) === 'w2' && (
      textSuggests1099(ocr?.text ?? '') || (disclosure === 'image' && modelReturned1099OnlyField(extracted))
    );
    const typeConfirmedByUser = needsTypeConfirmation && confirmedDocType === 'w2';
    if (needsTypeConfirmation && confirmedDocType === '1099') applyConfirmed1099(extracted);

    // Text path: identifiers were removed before the model saw the document, so the
    // employer/payer EIN comes from the local OCR read and the SSN is matched, not stored.
    const einNotes: string[] = [];
    if (disclosure === 'text') {
      // The model saw redacted text. Drop both numbers before the local read fills the field that will be saved.
      extracted.employerEIN = null;
      extracted.payerEIN = null;
      const savedType = savedDocumentType(extracted, docType);
      const einField = savedType === 'w2' ? 'employerEIN' : savedType === '1099' ? 'payerEIN' : null;
      if (einField) {
        // A payer line never contributes a bare number. A 1099 record also keeps only a dashed NN-NNNNNNN.
        const accepted = savedType === '1099' ? localEINs.filter(value => DASHED_PAYER_NUMBER.test(value)) : localEINs;
        extracted[einField] = accepted.length ? payerNumberOrBlank(accepted[0]) : null;
        if (!extracted[einField]) addPayerIdCheck(extracted);
        else if (accepted.length > 1) einNotes.push(`Verify ${einField}. More than one EIN-shaped number was read from the document.`);
      }
    }
    if (disclosure === 'image') rejectUndashedImagePayerNumbers(extracted);
    const documentOwner = await matchDocumentOwner(user.uid, extracted.taxYear || taxYear || new Date().getFullYear() - 1, ssnLast4);
    if (documentOwner === 'unmatched') {
      einNotes.push('The identification number on this document does not match the taxpayer or spouse record saved in your Tax Organizer. Confirm this document is yours before saving.');
    }
    extracted = publicDocument(dropDocumentIdentifiers(extracted), docType);

    // Low confidence warning
    // Check for quality issues
    const confidence = extracted.confidence || 0;
    const imageIssues = extracted.imageQualityIssues || [];
    const warnings = extracted.verificationWarnings || [];
    const fieldConf = extracted.fieldConfidence || {};
    const lowConfFields = Object.entries(fieldConf)
      .filter(([, v]) => (v as number) < 0.8)
      .map(([k]) => k);

    if (confidence < 0.5) {
      return NextResponse.json({
        success: false,
        warning: 'Image quality too low for reliable extraction. Try a clearer photo with better lighting.',
        tips: [
          'Lay the document flat on a white surface',
          'Use the rear camera in good natural light',
          'Avoid shadows and glare',
          'Make sure all 4 corners are visible',
        ],
        extracted: publicDocument(extracted, docType),
        imageIssues,
        committed: false,
        disclosure,
      }, { status: 422 });
    }

    // Build verification checklist for the UI
    const verificationRequired = [
      ...warnings,
      ...lowConfFields.map((f: string) => `Verify ${f}. The read confidence is low.`),
      ...imageIssues.length > 0 ? [`Image issues detected: ${imageIssues.join(', ')}`] : [],
      ...einNotes,
    ];

    // Merge user edits into extracted data before saving. Identifier keys are already removed from extracted.
    // A confirmed 1099 uses the same edit fields a native 1099 import would, even when the preview was a W-2.
    const fieldEdits = needsTypeConfirmation && confirmedDocType === '1099' ? overridesForConfirmed1099(overrideFields) : overrideFields;
    const finalData = publicDocument(dropDocumentIdentifiers({ ...extracted, ...fieldEdits }), docType);
    if (disclosure === 'image') rejectUndashedImagePayerNumbers(finalData);
    // A typed value that is not NN-NNNNNNN is saved blank. payerNumberOrBlank would already have dropped a 3-2-4, so check the raw edit.
    applyPayerNumberEdits(finalData, fieldEdits);
    const savedType = savedDocumentType(finalData, docType);
    const savedIdField = savedType === 'w2' ? 'employerEIN' : savedType === '1099' ? 'payerEIN' : null;
    const responseExtracted: Record<string, unknown> = { ...extracted };
    for (const field of PAYER_NUMBER_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(fieldEdits, field)) responseExtracted[field] = finalData[field];
    }
    // The scan can add the check before a typed value replaces it. For a saved W-2 or 1099 the prompt matches the saved ID only.
    if (savedIdField) {
      const empty = !finalData[savedIdField];
      for (let i = verificationRequired.length - 1; i >= 0; i -= 1) {
        if (verificationRequired[i] === PAYER_ID_CHECK) verificationRequired.splice(i, 1);
      }
      if (empty) verificationRequired.push(PAYER_ID_CHECK);
      syncPayerIdCheck(finalData, empty);
      syncPayerIdCheck(responseExtracted, empty);
    }

    // Save to Firestore if commit=true. A triggered W-2 writes nothing until the user picks.
    if (commit && needsTypeConfirmation && !confirmedDocType) {
      return NextResponse.json({ error: TYPE_CHOICE_REQUIRED }, { status: 400 });
    }
    let saveResult: Record<string, any> = {};
    if (commit) {
      if (savedType === 'w2') {
        saveResult = await saveW2(user.uid, finalData, { typeConfirmedByUser });
      } else if (savedType === '1099') {
        saveResult = await save1099(user.uid, finalData);
      } else if (savedType === 'platform_summary') {
        saveResult = await savePlatformSummary(user.uid, finalData);
      }
    }

    return NextResponse.json({
      success: true,
      docType: extracted.docType,
      verificationRequired,
      imageIssues,
      lowConfidenceFields: lowConfFields,
      taxYear: extracted.taxYear,
      extracted: publicDocument(responseExtracted, docType),
      committed: commit,
      saveResult,
      summary: buildSummary(extracted),
      // What left this server: redacted OCR text, or the whole image under the signed consent.
      disclosure,
      identifiersRedacted,
      documentOwner,
      ...(needsTypeConfirmation ? { needsTypeConfirmation: true } : {}),
    });
  } catch (error) {
    if (error instanceof ReceiptRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Document processing failed' }, { status: 500 });
  }
}

function buildSummary(data: Record<string, any>): string {
  if (data.docType === 'w2') {
    return `W-2 from ${data.employerName || 'employer'}: $${(data.box1Wages || 0).toLocaleString()} wages, $${(data.box2FederalWithheld || 0).toLocaleString()} withheld`;
  }
  if (data.docType === '1099') {
    return `1099-${data.formVariant || 'NEC'} from ${data.payerName || 'payer'}: $${(data.grossAmount || data.box1Amount || 0).toLocaleString()} income`;
  }
  if (data.docType === 'platform_summary') {
    return `${data.platform || 'Platform'} summary: $${(data.grossEarnings || 0).toLocaleString()} gross earnings`;
  }
  return `Document extracted: $${(data.primaryAmount || 0).toLocaleString()}`;
}
