export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUserFromReqOrThrow } from "@/app/api/_lib/auth";
import { checkHistoricalAccess } from "@/lib/subscriptions/historical-access";
import { getTransactionsServer } from "@/lib/firebase/transactions-server";
import { getUserProfileServer } from "@/lib/firebase/profiles-server";
import { getTaxProvider } from "@/lib/tax-provider";
import { aggregateScheduleC } from "@/lib/schedule-c/aggregate";
import type { TaxFilingSummary } from "@/lib/tax-provider/types";

function mapAggregationToSummary(aggregation: ReturnType<typeof aggregateScheduleC>, taxYear: string): TaxFilingSummary {
  return {
    taxYear,
    totalExpenses: aggregation.totalExpenses,
    totalDeductible: aggregation.totalDeductible,
    lineItemCount: aggregation.lineItemsArray.length,
    deductibleTransactionCount: aggregation.counts.deductible,
    lineItems: aggregation.lineItemsArray.map((item) => ({
      lineCode: item.lineCode,
      lineName: item.lineName,
      transactionCount: item.transactionCount,
      deductible: item.deductible,
    })),
  };
}

export async function POST(request: Request) {
  try {
    const { uid } = await getUserFromReqOrThrow(request);

    const access = await checkHistoricalAccess(uid);
    if (!access.hasAccess) {
      return NextResponse.json(
        {
          error: "Subscription required",
          requiresSubscription: true,
          message:
            "An active subscription is required to access TaxBandits filing workflows.",
        },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as { year?: unknown };
    const yearNum = typeof body.year === "number" ? body.year : Number(body.year);
    if (!yearNum || Number.isNaN(yearNum)) {
      return NextResponse.json(
        { error: "Tax year is required" },
        { status: 400 }
      );
    }
    const taxYear = String(Math.trunc(yearNum));

    const [{ data: profile }, { data: transactions }] = await Promise.all([
      getUserProfileServer(uid),
      getTransactionsServer(uid),
    ]);

    if (!profile) {
      return NextResponse.json(
        { error: "User profile not found" },
        { status: 400 }
      );
    }

    const aggregation = aggregateScheduleC(transactions || [], taxYear);
    if (!aggregation.lineItemsArray || aggregation.lineItemsArray.length === 0) {
      return NextResponse.json(
        { error: "No deductible expense categories found for this year" },
        { status: 400 }
      );
    }

    const summary = mapAggregationToSummary(aggregation, taxYear);
    const provider = await getTaxProvider();

    const result = await provider.startFiling({
      userId: uid,
      email: profile.email,
      taxYear,
      summary,
    });

    return NextResponse.json({
      success: true,
      redirectUrl: result.redirectUrl,
      sessionId: result.sessionId,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to start filing";
    console.error("[TaxBandits] start-filing error:", error);
    return NextResponse.json(
      { error: msg, details: msg },
      { status: 500 }
    );
  }
}

