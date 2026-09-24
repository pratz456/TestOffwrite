import { NextResponse } from "next/server";
import { readJsonObject } from "@/app/api/_lib/body";
import { adminDb } from "@/lib/firebase/admin";
import { anonymousRateLimitKey, enforceRateLimit, RATE_LIMITS, rateLimitResponse } from "@/lib/security/rate-limit";
import { sanitizeString } from "@/lib/security/utils";

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "writeoffapp@gmail.com";

export type ContactRequestBody = {
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
};

/** Upper bounds for the public form so a future mailer never relays unbounded text. */
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
    const limit = await enforceRateLimit({ ...RATE_LIMITS.contact, key: anonymousRateLimitKey(request) });
    if (!limit.allowed) return rateLimitResponse(limit, { error: "Too many contact requests. Please try again later." });
    const body = await readJsonObject(request);
    if (!validateBody(body)) {
      return NextResponse.json(
        { error: "Invalid or missing fields: name, email, subject, category, message are required." },
        { status: 400 },
      );
    }

    const contact = {
      name: sanitizeString(body.name, LIMITS.name),
      email: body.email.trim().toLowerCase(),
      subject: sanitizeString(body.subject, LIMITS.subject),
      category: sanitizeString(body.category, LIMITS.category),
      message: sanitizeString(body.message, LIMITS.message),
    };
    const record = await adminDb.collection("support_requests").add({
      ...contact,
      status: "new",
      deliveryStatus: process.env.RESEND_API_KEY ? "pending" : "manual_review",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000),
    });

    let delivery: "sent" | "queued" = "queued";
    if (process.env.RESEND_API_KEY) {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "WriteOff Support <notifications@writeoffapp.com>",
            to: [SUPPORT_EMAIL],
            reply_to: contact.email,
            subject: `[${contact.category || "Contact"}] ${contact.subject}`,
            text: [`From: ${contact.name} <${contact.email}>`, "", contact.message, "", `Request ID: ${record.id}`].join("\n"),
          }),
        });
        if (response.ok) {
          delivery = "sent";
          await record.update({ deliveryStatus: "sent", deliveredAt: new Date() });
        } else {
          await record.update({ deliveryStatus: "failed", deliveryHttpStatus: response.status });
        }
      } catch {
        await record.update({ deliveryStatus: "failed" }).catch(() => undefined);
      }
    }

    return NextResponse.json({ success: true, requestId: record.id, delivery }, {
      status: 202,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Failed to store the request. Please try again." }, { status: 503 });
  }
}
