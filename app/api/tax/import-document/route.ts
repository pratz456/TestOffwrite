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
import { redactIdentifierText } from '@/lib/security/identifier-redaction';
import { DOCUMENT_IMAGE_CONSENT_REQUIRED } from '@/lib/onboarding/document-import-consent';
import { documentImportConsentOnFile } from '@/lib/onboarding/document-import-consent-server';
import { readOrganizerDocument } from '@/lib/tax-organizer/organizer-server';

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

// ── Save extracted data to Firestore ─────────────────────────────────────────

async function saveW2(uid: string, data: Record<string, any>) {
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
  return { rawText, extracted: parseModelJson(rawText) };
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
    let rawText = '';
    let ssnLast4: string | null = null;
    let localEINs: string[] = [];
    let identifiersRedacted = 0;
    if (fallbackReason === null) {
      const redaction = redactIdentifierText(ocr!.text, { keepPrimarySSNLast4: true });
      ssnLast4 = redaction.ssnLast4;
      localEINs = redaction.eins.map(formatEIN);
      identifiersRedacted = redaction.count;
      ({ rawText, extracted } = await extractDocument('text', docType, { text: redaction.text }));
      if (extracted?.needs_image === true) { fallbackReason = 'model_requested_image'; extracted = null; }
    }

    // Step 4: the image leaves this server only with the request flag AND the signed consent on file.
    if (fallbackReason !== null) {
      const consentOnFile = await documentImportConsentOnFile(user.uid);
      if (!documentImageConsent || !consentOnFile) return consentRequired(fallbackReason, consentOnFile);
      disclosure = 'image';
      ({ rawText, extracted } = await extractDocument('image', docType, { dataUrl: `data:${mediaType};base64,${bytes.toString('base64')}` }));
    }

    if (!extracted || extracted.needs_image === true) {
      return NextResponse.json({
        error: 'Failed to parse document — image may be unclear or unsupported format',
        rawResponse: rawText.slice(0, 500),
        disclosure,
      }, { status: 422 });
    }

    // Override taxYear if provided
    if (taxYear) extracted.taxYear = taxYear;

    // Text path: identifiers were removed before the model saw the document, so the
    // employer/payer EIN comes from the local OCR read and the SSN is matched, not stored.
    const einNotes: string[] = [];
    if (disclosure === 'text') {
      const einField = extracted.docType === 'w2' || docType === 'w2' ? 'employerEIN' : extracted.docType === '1099' || docType === '1099' ? 'payerEIN' : null;
      if (einField) {
        extracted[einField] = localEINs[0] ?? null;
        if (localEINs.length > 1) einNotes.push(`Verify ${einField} — more than one EIN-shaped number was read from the document`);
      }
    }
    const documentOwner = await matchDocumentOwner(user.uid, extracted.taxYear || taxYear || new Date().getFullYear() - 1, ssnLast4);
    if (documentOwner === 'unmatched') {
      einNotes.push(`The Social Security number on this document (***-**-${ssnLast4}) does not match the taxpayer or spouse SSN saved in your Tax Organizer — confirm this document is yours before saving`);
    }

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
        extracted,
        imageIssues,
        committed: false,
        disclosure,
      }, { status: 422 });
    }

    // Build verification checklist for the UI
    const verificationRequired = [
      ...warnings,
      ...lowConfFields.map((f: string) => `Verify ${f} — low read confidence`),
      ...imageIssues.length > 0 ? [`Image issues detected: ${imageIssues.join(', ')}`] : [],
      ...einNotes,
    ];

    // Merge user edits into extracted data before saving
    const finalData = { ...extracted, ...overrideFields };

    // Save to Firestore if commit=true
    let saveResult: Record<string, any> = {};
    if (commit) {
      const detectedType = finalData.docType || docType;
      if (detectedType === 'w2') {
        saveResult = await saveW2(user.uid, finalData);
      } else if (detectedType === '1099') {
        saveResult = await save1099(user.uid, finalData);
      } else if (detectedType === 'platform_summary') {
        saveResult = await savePlatformSummary(user.uid, finalData);
      } else {
        // Auto-route based on extracted docType
        if (finalData.formVariant || finalData.form1099KAmount) {
          saveResult = await save1099(user.uid, finalData);
        } else if (finalData.box1Wages !== undefined) {
          saveResult = await saveW2(user.uid, finalData);
        } else if (finalData.grossEarnings !== undefined) {
          saveResult = await savePlatformSummary(user.uid, finalData);
        }
      }
    }

    return NextResponse.json({
      success: true,
      docType: extracted.docType,
      verificationRequired,
      imageIssues,
      lowConfidenceFields: lowConfFields,
      taxYear: extracted.taxYear,
      extracted,
      committed: commit,
      saveResult,
      summary: buildSummary(extracted),
      // What left this server: redacted OCR text, or the whole image under the signed consent.
      disclosure,
      identifiersRedacted,
      documentOwner,
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
