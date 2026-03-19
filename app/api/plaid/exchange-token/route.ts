import { NextRequest, NextResponse } from 'next/server'
import { exchangePublicToken, removePlaidConnection } from '@/lib/api'
import { getUserFromReqOrThrow } from '@/app/api/_lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { uid } = await getUserFromReqOrThrow(request);
    const { publicToken } = await request.json()
    
    if (!publicToken) {
      return NextResponse.json({ error: 'Public token is required' }, { status: 400 })
    }

    const result = await exchangePublicToken(publicToken, uid)
    
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true, 
      itemId: result.itemId 
    })
  } catch (error: any) {
    if (error?.message?.includes('Authorization')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Error exchanging token:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { uid } = await getUserFromReqOrThrow(request);

    const result = await removePlaidConnection(uid)
    
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error?.message?.includes('Authorization')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Error removing Plaid connection:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
