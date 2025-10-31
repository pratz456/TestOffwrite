import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    success: true,
    message: 'Firebase update test - use Firebase utilities directly',
    timestamp: new Date().toISOString()
  });
}