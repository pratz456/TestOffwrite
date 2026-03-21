/**
 * Tax Document Import API
 * Uses GPT-4o vision to extract structured data from:
 *   - W-2 forms (photo or PDF scan)
 *   - 1099-NEC, 1099-K, 1099-MISC forms
 *   - Platform annual summaries (Uber, DoorDash, Etsy, Upwork, etc.)
 *
 * POST multipart/form-data:
 *   file: image/pdf file
 *   docType: 'w2' | '1099' | 'platform_summary' | 'auto'
 *   taxYear: number (optional, defaults to last year)
 *   commit: 'true' | 'false' (whether to save to Firestore)
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb } from '@/lib/firebase/admin';
import { getOpenAIClientOrThrow } from '@/lib/openai/client';

// ── Extraction prompts per document type ─────────────────────────────────────

const W2_PROMPT = `You are a tax document parser. Extract data from this W-2 form image with EXTREME precision — errors affect someone's actual tax return.
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

const FORM_1099_PROMPT = `You are a tax document parser. Extract data from this 1099 form image with EXTREME precision.
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

const AUTO_DETECT_PROMPT = `You are a tax document classifier and parser. Look at this document and:
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
      amount: data.form1099KAmount || data.form1099NECAmount || 0,
      federalWithheld: data.federalWithheld || 0,
      platform: data.platform,
      source: 'document_import',
      createdAt: new Date(),
    });
  }

  return { id: ref.id, action: 'created', incomeAdded: incomeRecord.amount };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const docType = String(formData.get('docType') || 'auto');
    const commit = formData.get('commit') !== 'false';
    const taxYear = formData.get('taxYear') ? parseInt(String(formData.get('taxYear')), 10) : null;
    // User-edited field overrides (from inline editing in the UI)
    const overrideFieldsRaw = formData.get('overrideFields');
    const overrideFields: Record<string, any> = overrideFieldsRaw ? JSON.parse(String(overrideFieldsRaw)) : {};

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    // Convert to base64 for GPT-4o vision
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mediaType = file.type || 'image/jpeg';

    // Select prompt
    const prompts: Record<string, string> = {
      w2: W2_PROMPT,
      '1099': FORM_1099_PROMPT,
      platform_summary: PLATFORM_SUMMARY_PROMPT,
      auto: AUTO_DETECT_PROMPT,
    };
    const systemPrompt = prompts[docType] || AUTO_DETECT_PROMPT;

    // Call GPT-4o vision
    const openai = getOpenAIClientOrThrow();
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: systemPrompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mediaType};base64,${base64}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
    });

    const rawText = response.choices[0]?.message?.content || '{}';

    // Parse JSON response (strip any markdown fences)
    let extracted: Record<string, any>;
    try {
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extracted = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({
        error: 'Failed to parse document — image may be unclear or unsupported format',
        rawResponse: rawText.slice(0, 500),
      }, { status: 422 });
    }

    // Override taxYear if provided
    if (taxYear) extracted.taxYear = taxYear;

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
      }, { status: 422 });
    }

    // Build verification checklist for the UI
    const verificationRequired = [
      ...warnings,
      ...lowConfFields.map((f: string) => `Verify ${f} — low read confidence`),
      ...imageIssues.length > 0 ? [`Image issues detected: ${imageIssues.join(', ')}`] : [],
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
    });
  } catch (err) {
    console.error('[Document Import]', err);
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
