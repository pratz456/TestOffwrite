import { NextResponse } from "next/server";

const SUPPORT_EMAIL = "writeoffapp@gmail.com";

export type ContactRequestBody = {
  name: string;
  email: string;
  subject: string;
  category: string;
  message: string;
};

function validateBody(body: unknown): body is ContactRequestBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.name === "string" &&
    b.name.trim().length > 0 &&
    typeof b.email === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) &&
    typeof b.subject === "string" &&
    b.subject.trim().length > 0 &&
    typeof b.category === "string" &&
    typeof b.message === "string" &&
    b.message.trim().length > 0
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
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
