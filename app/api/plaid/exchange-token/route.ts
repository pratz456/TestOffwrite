import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/http/json-body';
import { POST as exchange } from '../exchange-public-token/route';
export { DELETE } from '../items/route';
export async function POST(request: Request) {
  const raw = await readJsonBody(request);
  if (raw instanceof NextResponse && raw.status === 413) return raw;
  const body = raw instanceof NextResponse || !raw || typeof raw !== 'object' || Array.isArray(raw) ? {} : raw as Record<string, unknown>;
  return exchange(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify({ public_token: body.publicToken ?? body.public_token }) }));
}
