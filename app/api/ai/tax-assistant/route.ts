import { NextRequest, NextResponse } from 'next/server';
import { getOpenAIClientOrThrow, getOpenAIModel, hasOpenAIAPIKey } from '@/lib/openai/client';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { assistantRequestSchema, isSupportedImage, readAssistantBody } from '@/lib/tax-assistant/contract';
import { buildGuidanceMessages, guidanceResponse, validateAssessment } from '@/lib/tax-assistant/guidance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await readAssistantBody(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RangeError ? 'Request is too large. Use a photo under 2 MB.' : 'Invalid request body' }, { status: error instanceof RangeError ? 413 : 400 });
  }
  const parsed = assistantRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Use tax year 2026 or 2027, a question under 4,000 characters, and at most 12 recent messages.' }, { status: 400 });
  const input = parsed.data;
  if (input.imageDataUrl && !isSupportedImage(input.imageDataUrl)) {
    return NextResponse.json({ error: 'Attach a valid JPEG, PNG, or WebP photo under 2 MB.' }, { status: 400 });
  }
  if (!hasOpenAIAPIKey()) {
    return NextResponse.json({ error: 'The tax assistant is not configured yet. Your question has not been sent for analysis.' }, { status: 503 });
  }

  try {
    const openai = getOpenAIClientOrThrow({ timeout: 45000, maxRetries: 0 });
    const completion = await openai.chat.completions.create({
      model: getOpenAIModel('assistant'),
      messages: buildGuidanceMessages(input),
      response_format: { type: 'json_object' },
      max_completion_tokens: 1800,
      store: false,
    });
    const choice = completion.choices[0];
    if (choice?.finish_reason !== 'stop' || choice.message.refusal) {
      return NextResponse.json({ error: 'The assistant could not complete this assessment. Try a clearer photo or a more specific question.' }, { status: 502 });
    }
    let assessment: unknown;
    try { assessment = JSON.parse(choice.message.content || ''); } catch { assessment = null; }
    return NextResponse.json(guidanceResponse(input, validateAssessment(assessment, input)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    // Provider errors may contain request/photo data. Do not log or return their raw payloads.
    return NextResponse.json({ error: 'The assistant is temporarily unavailable. Your draft is ready to retry.' }, { status: 503 });
  }
}
