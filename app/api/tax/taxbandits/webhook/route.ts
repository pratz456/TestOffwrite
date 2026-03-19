export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { updateTaxFilingSession } from "@/lib/firebase/tax-filing-sessions";

function normalizeStatus(input: unknown): any {
  if (typeof input !== "string") return undefined;
  const s = input.toLowerCase();

  const map: Record<string, string> = {
    initiated: "initiated",
    redirected: "redirected",
    in_progress: "in_progress",
    inprogress: "in_progress",
    submitted: "submitted",
    accepted: "accepted",
    rejected: "rejected",
    error: "error",
  };

  return map[s] || undefined;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const sessionId =
      body?.sessionId ||
      body?.externalRef ||
      body?.external_id ||
      body?.session_id ||
      "";
    if (!sessionId) {
      // Nothing to update; still return 200 so TaxBandits doesn't retry forever.
      return NextResponse.json({ received: true, matched: false });
    }

    const status = normalizeStatus(body?.status);
    if (!status) {
      return NextResponse.json({ received: true, matched: true, updated: false });
    }

    await updateTaxFilingSession({
      sessionId,
      status,
      provider: "taxbandits",
      metadata: body?.metadata && typeof body.metadata === "object" ? body.metadata : undefined,
    });

    return NextResponse.json({ received: true, matched: true, updated: true });
  } catch (error) {
    console.error("[TaxBandits Webhook] Error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: "ok", service: "taxbandits-webhook" });
}

