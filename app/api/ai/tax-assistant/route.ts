import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb } from '@/lib/firebase/admin';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ConversationMessage {
  role: string;
  content: string;
}

interface CategorySummary {
  category: string;
  total: number;
  count: number;
}

async function fetchTransactionsSummary(uid: string): Promise<{
  byCategory: CategorySummary[];
  totalExpenses: number;
  totalDeductible: number;
}> {
  const byCategoryMap = new Map<string, { total: number; count: number }>();
  let totalExpenses = 0;
  let totalDeductible = 0;

  try {
    const accountsSnapshot = await adminDb
      .collection('user_profiles')
      .doc(uid)
      .collection('accounts')
      .get();

    let totalFetched = 0;
    const maxPerAccount = 50;

    for (const accountDoc of accountsSnapshot.docs) {
      const accountId = accountDoc.id;
      const transactionsSnapshot = await adminDb
        .collection('user_profiles')
        .doc(uid)
        .collection('accounts')
        .doc(accountId)
        .collection('transactions')
        .orderBy('date', 'desc')
        .limit(maxPerAccount)
        .get();

      for (const txDoc of transactionsSnapshot.docs) {
        const data = txDoc.data();
        const amount = data.amount ?? data.amount_usd ?? 0;
        const category = data.category || data.personal_finance_category?.detailed || data.personal_finance_category?.primary || 'Uncategorized';
        const isDeductible = data.is_deductible === true || data.expense_type === 'business';

        // Positive amounts = expenses (money out), negative = income/refunds
        if (amount > 0) {
          totalExpenses += amount;
          if (isDeductible) totalDeductible += amount;

          const existing = byCategoryMap.get(category) || { total: 0, count: 0 };
          existing.total += amount;
          existing.count += 1;
          byCategoryMap.set(category, existing);
        }
        totalFetched++;
      }
    }

    const byCategory: CategorySummary[] = Array.from(byCategoryMap.entries())
      .map(([category, { total, count }]) => ({ category, total, count }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);

    return { byCategory, totalExpenses, totalDeductible };
  } catch (err) {
    console.log('🤖 [Tax Assistant] Error fetching transactions:', err);
    return { byCategory: [], totalExpenses: 0, totalDeductible: 0 };
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log('🤖 [Tax Assistant] OPENAI_API_KEY not configured');
      return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });
    }
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const { user, error: authError } = await getAuthenticatedUser(request);

    if (authError || !user) {
      console.log('🤖 [Tax Assistant] Unauthorized:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: { message?: string; conversationHistory?: ConversationMessage[] };
    try {
      body = await request.json();
    } catch {
      console.log('🤖 [Tax Assistant] Invalid JSON body');
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const conversationHistory: ConversationMessage[] = Array.isArray(body.conversationHistory)
      ? body.conversationHistory
      : [];

    console.log('🤖 [Tax Assistant] Request from user:', user.uid);

    // Fetch user profile
    const profileSnap = await adminDb.collection('user_profiles').doc(user.uid).get();
    const profile = profileSnap.exists ? profileSnap.data() : null;

    // Fetch transactions summary
    const { byCategory, totalExpenses, totalDeductible } = await fetchTransactionsSummary(user.uid);

    const profileContext = profile
      ? [
          `Profession: ${profile.profession || 'Not set'}`,
          `State: ${profile.state || 'Not set'}`,
          `Filing status: ${profile.filing_status || 'Not set'}`,
          `Business type: ${profile.business_entity_type || 'Not set'}`,
          `Income: ${profile.income || 'Not set'}`,
          profile.home_office_sqft != null ? `Home office: ${profile.home_office_sqft} sqft` : null,
          profile.vehicle_deduction_method ? `Vehicle deduction: ${profile.vehicle_deduction_method}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : 'No profile data available.';

    const expensesContext =
      byCategory.length > 0
        ? [
            `Total expenses (recent): $${totalExpenses.toFixed(2)}`,
            `Total deductible (recent): $${totalDeductible.toFixed(2)}`,
            'Top categories:',
            ...byCategory.slice(0, 10).map((c) => `  - ${c.category}: $${c.total.toFixed(2)} (${c.count} transactions)`),
          ].join('\n')
        : 'No recent transaction data available.';

    const systemPrompt = `You are a knowledgeable AI tax assistant for self-employed individuals and 1099 filers. You help with Schedule C deductions, estimated quarterly taxes, business expense classification, IRS rules, and tax optimization strategies. Always cite relevant IRS publications when applicable. Be specific to the user's situation. If you're unsure, recommend consulting a CPA. Keep answers concise but thorough.

## User context
${profileContext}

## Recent expenses summary (last 50 transactions per account)
${expensesContext}

## Instructions
- Tailor advice to the user's profession, state, and filing status.
- Reference their expense categories when relevant.
- Cite IRS publications (e.g., Pub 535, Pub 463, Pub 587) when giving deduction guidance.
- Do not provide legal or binding tax advice; recommend a CPA for complex situations.`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: message },
    ];

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0.3,
    });

    const reply = completion.choices[0]?.message?.content?.trim() || 'I could not generate a response. Please try again.';

    const updatedHistory: ConversationMessage[] = [
      ...conversationHistory,
      { role: 'user', content: message },
      { role: 'assistant', content: reply },
    ];

    console.log('🤖 [Tax Assistant] Response generated successfully');

    return NextResponse.json({
      reply,
      conversationHistory: updatedHistory,
    });
  } catch (err) {
    console.error('🤖 [Tax Assistant] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
