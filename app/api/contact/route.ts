import { NextResponse } from "next/server";
import { readJsonObject } from "@/app/api/_lib/body";
import { createHash } from "node:crypto";
import { anonymousRateLimitKey, enforceRateLimit, rateLimitResponse } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORT_EMAIL = "writeoffapp@gmail.com";

export type ContactRequestBody = {
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
};

/** Bound the public form before sending its contents to the support inbox. */
const LIMITS = { name: 200, email: 254, subject: 300, category: 64, message: 10_000 } as const;

function validateBody(body: unknown): body is ContactRequestBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const within = (field: keyof typeof LIMITS) => typeof b[field] === "string" && (b[field] as string).length <= LIMITS[field];
  return (
    within("name") &&
    (b.name as string).trim().length > 0 &&
    within("email") &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email as string) &&
    within("subject") &&
    (b.subject as string).trim().length > 0 &&
    within("category") &&
    within("message") &&
    (b.message as string).trim().length > 0
  );
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    if (!validateBody(body)) {
      return NextResponse.json(
        { error: "Invalid or missing fields: name, email, subject, category, message are required." },
        { status: 400 },
      );
    }

    const limit = await enforceRateLimit({ scope: 'support.contact', key: anonymousRateLimitKey(request),
      limit: 5, windowMs: 60 * 60_000, onUnavailable: 'deny' });
    if (!limit.allowed) return rateLimitResponse(limit, { error: 'Please wait before sending another message, or email writeoffapp@gmail.com.' });
    const key = process.env.RESEND_API_KEY?.trim();
    if (!key) return unavailable();
    const fields = Object.fromEntries(Object.keys(LIMITS).map(name => [name, body[name as keyof ContactRequestBody].trim()])) as ContactRequestBody;
    // Retry the same message safely after a lost response; never accept a caller-selected recipient.
    const idempotencyKey = 'contact-' + createHash('sha256').update(JSON.stringify(fields)).digest('hex');
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ from: 'WriteOff Support <notifications@writeoffapp.com>', to: [SUPPORT_EMAIL], reply_to: fields.email,
          subject: `WriteOff support: ${fields.subject.replace(/[\r\n]/g, ' ')}`,
          text: [`Name: ${fields.name}`, `Email: ${fields.email}`, `Category: ${fields.category}`, '', fields.message].join('\n') }),
      });
      if (!response.ok) return unavailable();
      const result = await response.json();
      if (typeof result.id !== 'string' || !result.id) return unavailable();
    } catch { return unavailable(); }

    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Failed to process request." }, { status: 500 });
  }
}

function unavailable() {
  return NextResponse.json({ error: 'Your message could not be sent. Please retry or email writeoffapp@gmail.com.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
