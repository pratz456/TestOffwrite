import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { invalidJsonResponse, readJsonObject } from '@/app/api/_lib/body';
import { getTransactionsServer } from '@/lib/firebase/transactions-server';
import { REVIEW_CATEGORIES, reviewCategory } from '@/lib/transactions/ai-review-contract';

export async function GET(request: NextRequest) {
  try {
    // Get the current user using Firebase Admin
    const { user, error: userError } = await getAuthenticatedUser(request);
    
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: transactions, error } = await getTransactionsServer(user.uid, {
      fields: ['category', 'amount', 'pending', 'is_deductible', 'review_status'],
    });
    if (error) return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 503 });
    const aggregates = new Map<string, { count: number; amount: number; deductible: number }>();
    for (const transaction of transactions) {
      if (transaction.pending === true || !(Number(transaction.amount) > 0)) continue;
      const category = reviewCategory(transaction.category);
      if (!category) continue;
      const current = aggregates.get(category.value) ?? { count: 0, amount: 0, deductible: 0 };
      current.count += 1;
      current.amount += Math.abs(Number(transaction.amount));
      if (transaction.review_status === 'confirmed' && transaction.is_deductible === true) current.deductible += 1;
      aggregates.set(category.value, current);
    }
    const categories = REVIEW_CATEGORIES.map((category) => {
      const aggregate = aggregates.get(category.value) ?? { count: 0, amount: 0, deductible: 0 };
      return {
        id: category.value,
        name: category.label,
        icon: category.value,
        // Eligibility belongs to each confirmed transaction, never to the category as a whole.
        is_deductible: null,
        transaction_count: aggregate.count,
        deductible_count: aggregate.deductible,
        total_amount: Math.round(aggregate.amount * 100) / 100,
        subcategories: [],
        user_id: user.uid,
      };
    });

    return NextResponse.json({
      success: true,
      categories,
    }, { headers: { 'Cache-Control': 'private, no-store' } });

  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // Get the current user using Firebase Admin
    const { user, error: userError } = await getAuthenticatedUser(request);
    
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await readJsonObject(request);
    if (!body) return invalidJsonResponse();
    const { categoryId, is_deductible } = body;

    if (!categoryId || typeof is_deductible !== 'boolean') {
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: false,
      code: 'CATEGORY_OVERRIDE_UNAVAILABLE',
      error: 'Review deductibility on each transaction. A category-wide tax override is not supported.',
    }, { status: 410 });

  } catch (error) {
    console.error('Error updating category:', error);
    return NextResponse.json(
      { error: 'Failed to update category' },
      { status: 500 }
    );
  }
}
