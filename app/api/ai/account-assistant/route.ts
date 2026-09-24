import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { getOpenAIClientOrThrow, getOpenAIModel, hasOpenAIAPIKey } from '@/lib/openai/client';
import { enforceRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/security/rate-limit';
import { assistantRequestSchema, isSupportedImage, readAssistantBody } from '@/lib/tax-assistant/contract';
import { accountIntentSchema, accountRouterMessages, accountResultSchema, type AccountResult } from '@/lib/tax-assistant/account-contract';
import { extractTaxPosition, taxPositionResult, transactionAccountResult } from '@/lib/tax-assistant/account-tools';
import { saveTaxPosition } from '@/lib/tax-assistant/account-history';
import { readAssistantTransactions } from '@/lib/tax-assistant/account-records';
import { POST as taxGuidance } from '@/app/api/ai/tax-assistant/route';
import { GET as computeTax } from '@/app/api/tax/compute-1040/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return json({ error: 'Unauthorized' }, 401);
  let raw: unknown;
  try { raw = await readAssistantBody(request); }
  catch (err) { return json({ error: err instanceof RangeError ? 'Request is too large.' : 'Invalid request body.' }, err instanceof RangeError ? 413 : 400); }
  const parsed = assistantRequestSchema.safeParse(raw);
  if (!parsed.success || parsed.data.imageDataUrl && !isSupportedImage(parsed.data.imageDataUrl)) return json({ error: 'Use a valid question, tax year, and photo under 2 MB.' }, 400);
  const input = parsed.data;
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  const guidance = () => taxGuidance(new NextRequest(new URL('/api/ai/tax-assistant', request.url), { method: 'POST', headers, body: JSON.stringify(input) }));
  // Photos retain the established bounded, source-backed guidance path.
  if (input.imageDataUrl) return guidance();
  const limit = await enforceRateLimit({ ...RATE_LIMITS.aiTaxAssistant, key: `account:${user.uid}` });
  if (!limit.allowed) return rateLimitResponse(limit, { error: 'Too many assistant requests. Please retry in a few minutes.' });
  if (!hasOpenAIAPIKey()) return json({ error: 'The assistant is not configured. Your draft is ready to retry.' }, 503);
  try {
    const client = getOpenAIClientOrThrow({ timeout: 30000, maxRetries: 0 });
    const result = await client.chat.completions.create({ model: getOpenAIModel('assistant'), messages: accountRouterMessages(input),
      response_format: { type: 'json_object' }, max_completion_tokens: 120, store: false });
    const choice = result.choices[0];
    if (choice?.finish_reason !== 'stop' || choice.message.refusal) return json({ error: 'The assistant could not choose a safe action. Try a more specific question.' }, 502);
    let selection: unknown;
    try { selection = JSON.parse(choice.message.content || ''); } catch { selection = null; }
    const selected = accountIntentSchema.safeParse(selection);
    if (!selected.success) return json({ error: 'The assistant could not choose a safe action. Try a more specific question.' }, 502);
    const intent = selected.data.intent;
    if (intent === 'tax_guidance') return guidance();
    const now = new Date();
    let response: { reply: string; account: AccountResult };
    if (intent === 'review_transactions' || intent === 'missing_receipts') {
      const records = await readAssistantTransactions(user.uid);
      response = transactionAccountResult({ intent, rows: records, uid: user.uid, taxYear: input.taxYear, now });
    } else if (intent === 'prepare_handoff') {
      response = { reply: 'Build a preparer package with your records, original receipts and an unresolved-items checklist. You choose whether to download it or create a temporary sharing link.', account: {
        title: 'Your accountant handoff', asOf: now.toISOString(), scope: `Select ${input.taxYear} in Filing Hub and review the package before sharing.`, metrics: [], items: [],
        actions: [{ label: 'Prepare accountant package', href: '/protected?screen=tax-filing-hub' }],
        notes: ['Packages and new sharing links require Premium or an active trial. Basic retains extended history. Creating a package does not file a return or send anything to your accountant.'],
      } };
    } else {
      const taxResponse = await computeTax(new NextRequest(new URL(`/api/tax/compute-1040?year=${input.taxYear}`, request.url), { headers }));
      const body = await taxResponse.json();
      if (!taxResponse.ok) {
        if (![400, 422].includes(taxResponse.status)) return json({ error: 'Your tax calculation could not be loaded. Retry before relying on an estimate.' }, 503);
        response = { reply: typeof body.error === 'string' ? body.error : 'Your saved tax inputs need review before an estimate is available.', account: {
          title: 'Resolve this before estimating tax', asOf: now.toISOString(), scope: `No tax amount was calculated for ${input.taxYear}.`, metrics: [], items: [],
          actions: [{ label: 'Review tax inputs', href: '/protected?screen=tax-preview' }, { label: 'Open tax organizer', href: '/protected?screen=tax-organizer' }],
          notes: [typeof body.code === 'string' ? `Review reference: ${body.code}` : 'Review the saved inputs and try again.'],
        } };
      } else {
        const current = extractTaxPosition(body, user.uid, input.taxYear, now);
        if (!current) return json({ error: 'The tax estimate was incomplete. Please retry.' }, 503);
        const previous = await saveTaxPosition(current);
        response = taxPositionResult(current, previous, intent === 'tax_changes', Array.isArray(body.form1040?.calculationWarnings) ? body.form1040.calculationWarnings.filter((value: unknown) => typeof value === 'string') : []);
      }
    }
    return json({ ...response, account: accountResultSchema.parse(response.account) });
  } catch {
    // Never log provider requests, saved financial records, or raw infrastructure errors.
    return json({ error: 'The assistant is temporarily unavailable. Your draft is ready to retry.' }, 503);
  }
}
