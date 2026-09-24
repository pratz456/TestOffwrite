import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb, FieldValue } from '@/lib/firebase/admin';
import { migrateLegacyPlaidConnection } from '@/lib/plaid/connections';
import { EDITABLE_PROFILE_FIELDS, publicProfile } from '@/lib/firebase/profile-fields';
import { parseConsentRecord, storedDocumentImportSignature } from '@/lib/onboarding/consents';
import { encryptSensitive } from '@/lib/security/utils';
import { isLocalAccountPreview } from '@/lib/firebase/local-account-preview';

class ProfileInputError extends Error {}

function encryptedEinUpdate(value: unknown, existingLast4?: unknown): { error?: string; fields?: Record<string, unknown>; omit?: boolean } {
  if (typeof value !== 'string') return { error: 'EIN must be a string' };
  const trimmed = value.trim();
  const masked = /^\*{2}-\*{3}(\d{4})$/.exec(trimmed);
  if (masked) {
    return existingLast4 === masked[1] ? { omit: true } : { error: 'The masked EIN does not match the stored value' };
  }
  if (!trimmed) {
    return { fields: { ein: FieldValue.delete(), ein_encrypted: FieldValue.delete(), ein_last4: FieldValue.delete() } };
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length !== 9 || digits === '000000000') {
    return { error: 'EIN must contain exactly nine digits' };
  }
  return {
    fields: {
      ein: FieldValue.delete(),
      ein_encrypted: encryptSensitive(digits),
      ein_last4: digits.slice(-4),
    },
  };
}

export async function GET(request: NextRequest) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await migrateLegacyPlaidConnection(user.uid);
    const ref = adminDb.doc(`user_profiles/${user.uid}`);
    let snapshot = await ref.get();
    // A preview reads the live account without running identifier migrations.
    // publicProfile still masks legacy values in the response.
    if (!isLocalAccountPreview() && snapshot.exists && Object.hasOwn(snapshot.data()!, 'ein')) {
      // Re-read under the transaction lock: a profile save or another migration may
      // have replaced/cleared the EIN since the first read. Never restore that stale value.
      await adminDb.runTransaction(async transaction => {
        const current = await transaction.get(ref);
        const data = current.data();
        if (!current.exists || !data || !Object.hasOwn(data, 'ein')) return;
        const fields: Record<string, unknown> = { ein: FieldValue.delete() };
        const legacyEin = typeof data.ein === 'string' ? data.ein.trim() : '';
        // An encrypted value takes precedence over leftover plaintext or a saved mask.
        // Empty/invalid legacy fields must also be removed: client read rules block
        // the field's presence, regardless of its value.
        if (legacyEin && !(typeof data.ein_encrypted === 'string' && data.ein_encrypted.trim())) {
          const migration = encryptedEinUpdate(legacyEin, data.ein_last4);
          const legacyDigits = legacyEin.replace(/\D/g, '');
          Object.assign(fields, migration.fields ?? {
            ein_encrypted: encryptSensitive(legacyEin),
            ...(legacyDigits.length >= 4 ? { ein_last4: legacyDigits.slice(-4) } : {}),
          });
        }
        transaction.update(ref, fields);
      });
      snapshot = await ref.get();
    }
    return NextResponse.json({ success: true, profile: snapshot.exists ? publicProfile(snapshot.data()!, user.uid) : null },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let parsedBody;
  try { parsedBody = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return NextResponse.json({ error: 'A profile object is required' }, { status: 400 });
  }
  const body: Record<string, any> = { ...parsedBody };
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
      const ein = 'ein' in body ? encryptedEinUpdate(body.ein, snapshot.data()?.ein_last4) : null;
      if (ein?.error) throw new ProfileInputError(ein.error);
      const profileFields = { ...body };
      delete profileFields.ein;
      const stored = snapshot.exists ? snapshot.data()?.consents : undefined;
      let consents = 'consents' in body ? body.consents : undefined;
      // Re-acknowledging updated terms re-collects the acknowledgments, not the separately signed §7216
      // document consent: a current signature travels into the new record. A withdrawal (same terms
      // version, signature omitted) still removes it.
      const storedVersion = stored && typeof stored === 'object' ? (stored as Record<string, unknown>).version : undefined;
      const carried = consents && consents.source === 'reacknowledgment' && !consents.document_import_signature
        && storedVersion !== consents.version ? storedDocumentImportSignature(stored) : null;
      if (consents && carried) consents = { ...consents, document_import: true, document_import_signature: carried };
      // A merge keeps nested fields, so a withdrawn §7216 signature is removed explicitly.
      const withdrawn = consents && !consents.document_import_signature
        && stored && typeof stored === 'object' && 'document_import_signature' in stored;
      transaction.set(ref, { ...profileFields, ...(ein?.fields ?? {}),
        ...(consents ? { consents: withdrawn ? { ...consents, document_import_signature: FieldValue.delete() } : consents } : {}),
        ...stamps, updated_at: FieldValue.serverTimestamp(),
        ...(!snapshot.exists ? { created_at: FieldValue.serverTimestamp() } : {}) }, { merge: true });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ProfileInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 503 });
  }
}
