/**
 * W-2 Income API — stores employer W-2 data for users with both salary + self-employment income.
 * Flows into quarterly tax calculator (combined income bracket) and tax organizer.
 * Collection: w2_income/{docId}  fields: userId, taxYear, employer, wages, federalWithheld, stateWithheld, box12, box14
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

export interface W2Entry {
  id: string;
  userId: string;
  taxYear: number;
  employer: string;
  wages: number;              // Box 1: Wages, tips, other compensation
  federalWithheld: number;    // Box 2: Federal income tax withheld
  socialSecurityWages: number; // Box 3
  medicareWages: number;      // Box 5
  stateWages?: number;        // Box 16
  stateWithheld?: number;     // Box 17
  state?: string;
  createdAt?: string;
}

export async function GET(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const year = parseInt(request.nextUrl.searchParams.get('year') || String(new Date().getFullYear()), 10);
  const snap = await adminDb.collection('w2_income').where('userId', '==', user.uid).where('taxYear', '==', year).orderBy('createdAt', 'desc').get();
  const entries: W2Entry[] = snap.docs.map(doc => {
    const d = doc.data();
    return { id: doc.id, userId: d.userId, taxYear: d.taxYear, employer: d.employer, wages: d.wages, federalWithheld: d.federalWithheld, socialSecurityWages: d.socialSecurityWages || 0, medicareWages: d.medicareWages || 0, stateWages: d.stateWages, stateWithheld: d.stateWithheld, state: d.state, createdAt: d.createdAt?.toDate?.()?.toISOString?.() || '' };
  });
  const totalWages = entries.reduce((s, e) => s + e.wages, 0);
  const totalWithheld = entries.reduce((s, e) => s + e.federalWithheld, 0);
  return NextResponse.json({ entries, totalWages, totalWithheld, taxYear: year });
}

export async function POST(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json();
  const { employer, wages, federalWithheld, socialSecurityWages, medicareWages, stateWages, stateWithheld, state, taxYear } = body;
  if (!employer?.trim()) return NextResponse.json({ error: 'Employer name required' }, { status: 400 });
  if (!wages || isNaN(Number(wages)) || Number(wages) < 0) return NextResponse.json({ error: 'Wages required' }, { status: 400 });
  const year = taxYear ? parseInt(String(taxYear), 10) : new Date().getFullYear();
  const ref = await adminDb.collection('w2_income').add({ userId: user.uid, taxYear: year, employer: employer.trim(), wages: Number(wages), federalWithheld: Number(federalWithheld || 0), socialSecurityWages: Number(socialSecurityWages || 0), medicareWages: Number(medicareWages || 0), stateWages: stateWages ? Number(stateWages) : null, stateWithheld: stateWithheld ? Number(stateWithheld) : null, state: state || null, createdAt: new Date() });
  return NextResponse.json({ success: true, id: ref.id }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { user, error } = await getAuthenticatedUser(request);
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const doc = await adminDb.collection('w2_income').doc(id).get();
  if (!doc.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.data()?.userId !== user.uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  await adminDb.collection('w2_income').doc(id).delete();
  return NextResponse.json({ success: true });
}
