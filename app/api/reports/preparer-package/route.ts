export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { buildPreparerPackage, PreparerPackageError } from '@/lib/reports/preparer-package';
import { exportYear } from '@/lib/reports/transaction-export';
import { boundedPreparerBody, preparerOwner, preparerFailure, PREPARER_HEADERS } from '@/lib/preparer/http';
export async function POST(request: NextRequest) {
  const owner = await preparerOwner(request, { mutation: true, costly: true }); if (owner.denied) return owner.denied;
  try {
    const body = await boundedPreparerBody(request);
    const year = exportYear(body.year);
    if (year === undefined || Object.keys(body).some(key => key !== 'year')) throw new PreparerPackageError('Provide a tax year.', 'HANDOFF_INVALID', 400);
    const bundle = await buildPreparerPackage(owner.uid!, year);
    return new NextResponse(new Uint8Array(bundle.bytes), { headers: { ...PREPARER_HEADERS, 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${bundle.filename}"`,
      'X-Receipt-Issues': String(bundle.manifest.receiptIssues), 'X-Unresolved-Transactions': String(bundle.manifest.unresolvedQuestions) } });
  } catch (error) { return preparerFailure(error); }
}
