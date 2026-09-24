export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { revokePreparerHandoff } from '@/lib/preparer/handoffs';
import { preparerOwner, preparerFailure, preparerJson } from '@/lib/preparer/http';
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const owner = await preparerOwner(request, { mutation: true, premium: false }); if (owner.denied) return owner.denied;
  try { const { id } = await params; return await revokePreparerHandoff(owner.uid!, id) ? preparerJson({ revoked: true }) : preparerJson({ error: 'Link not found.' }, 404); }
  catch (error) { return preparerFailure(error); }
}
