import { NextRequest, NextResponse } from 'next/server'
import { fetchTransactions } from '@/lib/api'
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { uid } = await getUserFromReqOrThrow(request);

    const result = await fetchTransactions(uid)
    
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true, 
      count: result.count 
    })
  } catch (error: any) {
    if (error?.message?.includes('Authorization')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Error fetching transactions:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
