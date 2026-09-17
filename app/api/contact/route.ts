import { NextResponse } from "next/server";
import { readJsonObject } from "@/app/api/_lib/body";

const SUPPORT_EMAIL = "writeoffapp@gmail.com";

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
    const body = await readJsonObject(request);
    if (!validateBody(body)) {
      return NextResponse.json(
        { error: "Invalid or missing fields: name, email, subject, category, message are required." },
        { status: 400 },
      );
    }

    // Optional: send email via Resend, SendGrid, or Nodemailer using SUPPORT_EMAIL
    // For now we only validate and return success; you can add email sending here.
    if (process.env.NODE_ENV === "development") {
      console.log("[Contact] Support request:", {
        name: body.name,
        email: body.email,
        subject: body.subject,
        category: body.category,
        message: body.message.slice(0, 100) + (body.message.length > 100 ? "…" : ""),
      });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to process request." }, { status: 500 });
  }
}
