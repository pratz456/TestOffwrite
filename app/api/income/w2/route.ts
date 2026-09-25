/**
 * W-2 Income API — stores employer W-2 data for users with both salary + self-employment income.
 * Flows into quarterly tax calculator (combined income bracket) and tax organizer.
 * Collection: w2_income/{docId}  fields: userId, taxYear, employer, wages, federalWithheld, stateWithheld, box12, box14
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

const amountInput = z.union([z.number(), z.string().trim().min(1)]).transform(Number).pipe(z.number().finite().nonnegative());
const yearInput = z.union([z.number(), z.string().trim().min(1)]).transform(Number).pipe(z.number().int().min(2000).max(2100));
const w2Input = z.object({
  employer: z.string().trim().min(1).max(500), wages: amountInput,
  federalWithheld: amountInput.default(0), socialSecurityWages: amountInput, medicareWages: amountInput,
  stateWages: amountInput.optional(), stateWithheld: amountInput.optional(), state: z.string().trim().max(100).optional(),
  taxYear: yearInput.default(() => new Date().getFullYear()),
});

export interface W2Entry {
  id: string;
  userId: string;
  taxYear: number;
  employer: string;
  wages: number;              // Box 1: Wages, tips, other compensation
  federalWithheld: number;    // Box 2: Federal income tax withheld
  socialSecurityWages?: number; // Box 3; missing on a legacy row blocks mixed-income SE calculations
  medicareWages?: number;      // Box 5; missing on a legacy row blocks mixed-income SE calculations
  stateWages?: number;        // Box 16
  stateWithheld?: number;     // Box 17
  state?: string;
  createdAt?: string;
}

export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const parsedYear = yearInput.safeParse(request.nextUrl.searchParams.get('year') ?? new Date().getFullYear());
    if (!parsedYear.success) return NextResponse.json({ error: 'Provide a valid tax year.' }, { status: 400 });
    const year = parsedYear.data;
    // Query without orderBy to avoid needing a composite index
    const snap = await adminDb.collection('w2_income').where('userId', '==', user.uid).where('taxYear', '==', year).get();
    const entries: W2Entry[] = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id, userId: d.userId, taxYear: d.taxYear, employer: d.employer,
        wages: d.wages, federalWithheld: d.federalWithheld,
        socialSecurityWages: typeof d.socialSecurityWages === 'number' ? d.socialSecurityWages : undefined,
        medicareWages: typeof d.medicareWages === 'number' ? d.medicareWages : undefined,
        stateWages: d.stateWages, stateWithheld: d.stateWithheld, state: d.state,
        createdAt: d.createdAt?.toDate?.()?.toISOString?.() || '',
      };
    });
    // Sort in JS instead of Firestore to avoid composite index requirement
    entries.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const totalWages = entries.reduce((s, e) => s + e.wages, 0);
    const totalWithheld = entries.reduce((s, e) => s + e.federalWithheld, 0);
    return NextResponse.json({ entries, totalWages, totalWithheld, taxYear: year });
  } catch (err) {
    console.error('[W-2 GET] Error:', err);
    return NextResponse.json({ error: 'Failed to load W-2 data' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const parsed = w2Input.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Provide an employer, a valid tax year, and finite nonnegative W-2 amounts.' }, { status: 400 });
    const { employer, wages, federalWithheld, socialSecurityWages, medicareWages, stateWages, stateWithheld, state, taxYear: year } = parsed.data;
    const ref = await adminDb.collection('w2_income').add({ userId: user.uid, taxYear: year, employer: employer.trim(), wages: Number(wages), federalWithheld: Number(federalWithheld || 0), socialSecurityWages: Number(socialSecurityWages), medicareWages: Number(medicareWages), stateWages: stateWages ?? null, stateWithheld: stateWithheld ?? null, state: state || null, createdAt: new Date() });
    return NextResponse.json({ success: true, id: ref.id }, { status: 201 });
  } catch (err) {
    console.error('[W-2 POST] Error:', err);
    return NextResponse.json({ error: 'Failed to save W-2' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(request);
    if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const doc = await adminDb.collection('w2_income').doc(id).get();
    if (!doc.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (doc.data()?.userId !== user.uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    await adminDb.collection('w2_income').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[W-2 DELETE] Error:', err);
    return NextResponse.json({ error: 'Failed to delete W-2' }, { status: 500 });
  }
}
