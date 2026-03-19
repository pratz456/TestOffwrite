export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserFromReqOrThrow } from "@/app/api/_lib/auth";
import { getTaxFilingSessionById } from "@/lib/firebase/tax-filing-sessions";
import type { TaxFilingSessionRecord } from "@/lib/firebase/tax-filing-sessions";

export async function GET(request: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(request);

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId") || "";
    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    const session = (await getTaxFilingSessionById(sessionId)) as
      | (TaxFilingSessionRecord & { summary?: any })
      | null;

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.userId !== uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      session: {
        sessionId: session.sessionId,
        provider: session.provider,
        taxYear: session.taxYear,
        status: session.status,
        redirectAttemptCount: session.redirectAttemptCount,
        createdAt: session.createdAt,
        lastUpdatedAt: session.lastUpdatedAt,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to get status";
    console.error("[TaxBandits] status error:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

