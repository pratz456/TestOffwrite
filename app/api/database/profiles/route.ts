import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb, FieldValue } from '@/lib/firebase/admin';
import { migrateLegacyPlaidConnection } from '@/lib/plaid/connections';
import { EDITABLE_PROFILE_FIELDS, publicProfile } from '@/lib/firebase/profile-fields';
import { parseConsentRecord } from '@/lib/onboarding/consents';

export async function GET(request: NextRequest) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await migrateLegacyPlaidConnection(user.uid);
    const snapshot = await adminDb.doc(`user_profiles/${user.uid}`).get();
    return NextResponse.json({ success: true, profile: snapshot.exists ? publicProfile(snapshot.data()!, user.uid) : null },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'A profile object is required' }, { status: 400 });
  }
  if (Object.keys(body).some(key => !EDITABLE_PROFILE_FIELDS.has(key))) {
    return NextResponse.json({ error: 'Profile contains fields that cannot be edited' }, { status: 400 });
  }
  if (JSON.stringify(body).length > 32_768) return NextResponse.json({ error: 'Profile is too large' }, { status: 413 });
  const stamps: Record<string, unknown> = {};
  if ('consents' in body) {
    const consents = parseConsentRecord(body.consents);
    if (!consents) return NextResponse.json({ error: 'Consent record is incomplete or not the current terms' }, { status: 400 });
    body.consents = consents;
    stamps.consents_recorded_at = FieldValue.serverTimestamp();
  }
  try {
    const ref = adminDb.doc(`user_profiles/${user.uid}`);
    await adminDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      // A merge keeps nested fields, so a withdrawn §7216 signature is removed explicitly.
      const stored = snapshot.exists ? snapshot.data()?.consents : undefined;
      const withdrawn = 'consents' in body && !body.consents.document_import_signature
        && stored && typeof stored === 'object' && 'document_import_signature' in stored;
      transaction.set(ref, { ...body, ...(withdrawn ? { consents: { ...body.consents, document_import_signature: FieldValue.delete() } } : {}),
        ...stamps, updated_at: FieldValue.serverTimestamp(),
        ...(!snapshot.exists ? { created_at: FieldValue.serverTimestamp() } : {}) }, { merge: true });
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 503 });
  }
}
