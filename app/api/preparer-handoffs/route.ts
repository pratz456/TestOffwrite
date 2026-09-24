export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { buildPreparerPackage, PreparerPackageError } from '@/lib/reports/preparer-package';
import { exportYear } from '@/lib/reports/transaction-export';
import { createPreparerHandoff, listPreparerHandoffs } from '@/lib/preparer/handoffs';
import { boundedPreparerBody, preparerOwner, preparerFailure, preparerJson } from '@/lib/preparer/http';
export async function GET(request: NextRequest) {
  // Owners can always inspect/revoke previously created links after their plan expires.
  const owner = await preparerOwner(request, { premium: false }); if (owner.denied) return owner.denied;
  try { return preparerJson({ handoffs: await listPreparerHandoffs(owner.uid!) }); } catch (error) { return preparerFailure(error); }
}
export async function POST(request: NextRequest) {
  const owner = await preparerOwner(request, { mutation: true, costly: true }); if (owner.denied) return owner.denied;
  try {
    const body = await boundedPreparerBody(request), year = exportYear(body.year), days = body.expiresInDays;
    if (year === undefined || !Number.isInteger(days) || Number(days) < 1 || Number(days) > 7 || body.confirmSharing !== true || Object.keys(body).some(key => !['year', 'expiresInDays', 'confirmSharing'].includes(key))) throw new PreparerPackageError('Confirm sharing and choose a tax year and expiry from 1 to 7 days.', 'HANDOFF_INVALID', 400);
    const created = await createPreparerHandoff(owner.uid!, await buildPreparerPackage(owner.uid!, year), Number(days));
    // A URL fragment never reaches HTTP access logs or referrer headers.
    return preparerJson({ id: created.id, path: `/preparer/${created.id}#token=${created.token}`, expiresAt: created.expiresAt, receiptIssues: created.receiptIssues,
      unresolvedQuestions: created.unresolvedQuestions, receiptFiles: created.receiptFiles }, 201);
  } catch (error) { return preparerFailure(error); }
}
