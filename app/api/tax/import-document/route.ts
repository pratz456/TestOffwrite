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

const W2_PROMPT = `You are a tax document parser. Extract data from this W-2 form image.
Return ONLY valid JSON, no markdown, no explanation.

Extract these fields exactly as they appear on the form:
{
  "docType": "w2",
  "employerName": "string — Box c employer name",
  "employerEIN": "string — Box b employer EIN (XX-XXXXXXX format)",
  "box1Wages": number,
  "box2FederalWithheld": number,
  "box3SocialSecurityWages": number,
  "box4SocialSecurityWithheld": number,
  "box5MedicareWages": number,
  "box6MedicareWithheld": number,
  "box12Codes": [{"code": "string", "amount": number}],
  "box16StateWages": number,
  "box17StateWithheld": number,
  "state": "string — 2-letter state code",
  "taxYear": number,
  "confidence": number
}

If a field is not visible or illegible, use null. taxYear should be inferred from the form or default to ${new Date().getFullYear() - 1}.`;

const FORM_1099_PROMPT = `You are a tax document parser. Extract data from this 1099 form image.
Return ONLY valid JSON, no markdown, no explanation.

Determine the form type (1099-NEC, 1099-K, 1099-MISC, 1099-INT, 1099-DIV) and extract:
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
    if ((extracted.confidence || 0) < 0.6) {
      return NextResponse.json({
        success: false,
        warning: 'Low confidence extraction — please verify all values before saving',
        extracted,
        committed: false,
      });
    }

    // Save to Firestore if commit=true
    let saveResult: Record<string, any> = {};
    if (commit) {
      const detectedType = extracted.docType || docType;
      if (detectedType === 'w2') {
        saveResult = await saveW2(user.uid, extracted);
      } else if (detectedType === '1099') {
        saveResult = await save1099(user.uid, extracted);
      } else if (detectedType === 'platform_summary') {
        saveResult = await savePlatformSummary(user.uid, extracted);
      } else {
        // Auto-route based on extracted docType
        if (extracted.formVariant || extracted.form1099KAmount) {
          saveResult = await save1099(user.uid, extracted);
        } else if (extracted.box1Wages !== undefined) {
          saveResult = await saveW2(user.uid, extracted);
        } else if (extracted.grossEarnings !== undefined) {
          saveResult = await savePlatformSummary(user.uid, extracted);
        }
      }
    }

    return NextResponse.json({
      success: true,
      docType: extracted.docType,
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
