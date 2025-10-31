import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';

export async function GET(request: NextRequest) {
  try {
    // Get the current user using Firebase Admin
    const { user, error: userError } = await getAuthenticatedUser(request);
    
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch categories from the database
    // For now, we'll return sample data since we don't have a categories table yet
    // In a real implementation, you would query your categories table
    
    const sampleCategories = [
      {
        id: '1',
        name: 'Travel',
        icon: 'Travel',
        is_deductible: true,
        transaction_count: 12,
        total_amount: 2500,
        subcategories: ['Flights', 'Hotels', 'Car Rental', 'Meals While Traveling'],
        user_id: user.uid
      },
      {
        id: '2',
        name: 'Meals',
        icon: 'Meals',
        is_deductible: true,
        transaction_count: 45,
        total_amount: 1200,
        subcategories: ['Business Meals', 'Client Entertainment', 'Coffee Meetings'],
        user_id: user.uid
      },
      {
        id: '3',
        name: 'Software',
        icon: 'Software',
        is_deductible: true,
        transaction_count: 8,
        total_amount: 800,
        subcategories: ['Accounting Software', 'Design Tools', 'Project Management', 'Communication Tools'],
        user_id: user.uid
      },
      {
        id: '4',
        name: 'Home Office',
        icon: 'Home Office',
        is_deductible: true,
        transaction_count: 15,
        total_amount: 1800,
        subcategories: ['Office Supplies', 'Furniture', 'Equipment', 'Internet'],
        user_id: user.uid
      },
      {
        id: '5',
        name: 'Utilities',
        icon: 'Utilities',
                    is_deductible: null,
        transaction_count: 24,
        total_amount: 3600,
        subcategories: ['Electricity', 'Water', 'Gas', 'Internet', 'Phone'],
        user_id: user.uid
      },
      {
        id: '6',
        name: 'Professional Services',
        icon: 'Professional Services',
        is_deductible: true,
        transaction_count: 6,
        total_amount: 3000,
        subcategories: ['Legal Services', 'Accounting', 'Consulting', 'Marketing'],
        user_id: user.uid
      },
      {
        id: '7',
        name: 'Supplies',
        icon: 'Supplies',
        is_deductible: true,
        transaction_count: 18,
        total_amount: 450,
        subcategories: ['Office Supplies', 'Paper Products', 'Cleaning Supplies'],
        user_id: user.uid
      },
      {
        id: '8',
        name: 'Transportation',
        icon: 'Transportation',
        is_deductible: true,
        transaction_count: 22,
        total_amount: 900,
        subcategories: ['Gas', 'Public Transit', 'Ride Share', 'Parking'],
        user_id: user.uid
      }
    ];

    // TODO: Replace with actual database query when categories table is created
    // const { data: categories, error } = await supabase
    //   .from('categories')
    //   .select('*')
    //   .eq('user_id', user.uid);

    return NextResponse.json({
      success: true,
      categories: sampleCategories
    });

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

    const { categoryId, is_deductible } = await request.json();

    if (!categoryId || typeof is_deductible !== 'boolean') {
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      );
    }

    // TODO: Update category in database when categories table is created
    // const { data, error } = await supabase
    //   .from('categories')
    //   .update({ is_deductible })
    //   .eq('id', categoryId)
    //   .eq('user_id', user.uid);

    // For now, just return success
    return NextResponse.json({
      success: true,
      message: 'Category updated successfully'
    });

  } catch (error) {
    console.error('Error updating category:', error);
    return NextResponse.json(
      { error: 'Failed to update category' },
      { status: 500 }
    );
  }
}
