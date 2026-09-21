import { NextRequest, NextResponse } from 'next/server';
import { POST as createLinkToken } from '../create-link-token/route';

/** Legacy response spelling; authentication and ownership stay in the canonical route. */
export async function POST(request: NextRequest) {
  const response = await createLinkToken(request);
  if (!response.ok) return response;
  const data = await response.json();
  return NextResponse.json({ ...data, linkToken: data.link_token }, { status: response.status, headers: response.headers });
}
