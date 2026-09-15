// Ensure this runs on Node.js (Admin SDK doesn't work on Edge)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
export { GET } from '@/app/api/database/profiles/route';
import { adminDb } from '@/lib/firebase/admin';

function clean<T extends Record<string, any>>(obj: T) {
  // remove undefined / null (Firestore rejects undefined)
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
  ) as T;
}

export async function POST(req: Request) {
  // helpful default
  const err = (error: string, status = 400, details?: string) =>
    NextResponse.json({ ok: false, error, details }, { status });

  try {
    const { user } = await getAuthenticatedUser(req);
    if (!user) return err('Unauthorized', 401);
    const uid = user.uid;

    // 2) parse & validate JSON
    let body: any;
    try {
      body = await req.json();
    } catch {
      return err('invalid_json_body', 400);
    }

    // whitelist only the fields we expect from the form
    const {
      businessEntityType,
      primaryWorkLocation,
      workRelatedTravelPattern,
      annualIncomeRange,
    } = body ?? {};

    if (
      !businessEntityType ||
      !primaryWorkLocation ||
      !workRelatedTravelPattern ||
      !annualIncomeRange
    ) {
      return err('missing_required_fields', 422);
    }

    if ([businessEntityType, primaryWorkLocation, workRelatedTravelPattern, annualIncomeRange]
      .some(value => typeof value !== 'string' || value.length > 250)) return err('invalid_fields', 422);

    const doc = clean({
      userId: uid,
      businessEntityType,
      primaryWorkLocation,
      workRelatedTravelPattern,
      annualIncomeRange,
      updated_at: new Date(),
    });

    // 3) Admin write (bypasses security rules)
    try {
      await adminDb.collection('user_profiles').doc(uid).set(doc, { merge: true });
    } catch (e: any) {
      return err('firestore_write_failed', 500, String(e?.message ?? e));
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'unexpected_server_error', details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}