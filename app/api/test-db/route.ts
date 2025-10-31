import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Firebase database test - connection configured',
    timestamp: new Date().toISOString()
  });
}