import { NextRequest, NextResponse } from 'next/server';
import { getPaginatedTransactionsServer } from '@/lib/firebase/transactions-server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

export async function GET(request: NextRequest) {
  try {
    console.log('🔄 [Paginated Transactions API] Starting request...');
    
    // Get the authenticated user
    const { user, error: authError } = await getAuthenticatedUser(request);
    
    if (authError || !user) {
      console.error('❌ [Paginated Transactions API] Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ [Paginated Transactions API] User authenticated:', user.uid);

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status'); // 'all', 'deductible', 'personal', 'pending'
    const search = searchParams.get('search') || '';
    const sortBy = searchParams.get('sortBy') || 'updated_at';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const dateFrom = searchParams.get('dateFrom') || undefined;
    const dateTo = searchParams.get('dateTo') || undefined;
    const category = searchParams.get('category') || undefined;
    const amountMin = searchParams.get('amountMin') ? parseFloat(searchParams.get('amountMin')!) : undefined;
    const amountMax = searchParams.get('amountMax') ? parseFloat(searchParams.get('amountMax')!) : undefined;

    console.log('📋 [Paginated Transactions API] Query params:', {
      page,
      limit,
      status,
      search,
      sortBy,
      sortOrder,
      dateFrom,
      dateTo,
      category,
      amountMin,
      amountMax,
    });

    // Validate parameters
    if (page < 1 || limit < 1 || limit > 100) {
      return NextResponse.json({
        error: 'Invalid pagination parameters',
      }, { status: 400 });
    }

    // Get paginated transactions (date range and filters are display-only; fetch length is always 730 on import)
    const { data, error, pagination } = await getPaginatedTransactionsServer(
      user.uid,
      {
        page,
        limit,
        status: status || undefined,
        search,
        sortBy,
        sortOrder: sortOrder as 'desc' | 'asc' | undefined,
        dateFrom,
        dateTo,
        category,
        amountMin,
        amountMax,
      }
    );

    if (error) {
      console.error('❌ [Paginated Transactions API] Error fetching transactions:', error);
      return NextResponse.json({ 
        error: error.message || 'Failed to fetch transactions' 
      }, { status: 500 });
    }

    console.log('✅ [Paginated Transactions API] Successfully fetched transactions:', {
      count: data?.length || 0,
      pagination,
      userId: user.uid
    });

    const response = NextResponse.json({
      success: true,
      transactions: data || [],
      pagination,
      filters: {
        status,
        search,
        sortBy,
        sortOrder,
        dateFrom,
        dateTo,
        category,
        amountMin,
        amountMax,
      },
    });

    // Add cache headers for better performance
    response.headers.set('Cache-Control', 'private, max-age=60'); // 1 minute
    response.headers.set('ETag', `"${user.uid}-${page}-${limit}-${status || 'all'}"`);

    return response;
  } catch (error) {
    console.error('❌ [Paginated Transactions API] Unexpected error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch transactions',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

