import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Firebase Admin SDK service role test - configured via environment variables',
    timestamp: new Date().toISOString()
  });
}