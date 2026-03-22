import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/firebase/api-auth';
import { adminDb } from '@/lib/firebase/admin';
import { calcScheduleSE } from '@/lib/reports/calcSE';
import { calculateStateTax } from '@/lib/tax-rules/state-tax';
import { calculateFederalIncomeTax, calculateEffectiveTaxRate, STANDARD_DEDUCTIONS_2025 } from '@/lib/tax-rules/federal-brackets';
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

// Fetch comprehensive transaction data
async function fetchFinancialSummary(uid: string) {
  const byCategoryMap = new Map<string, { total: number; count: number }>();
  let totalExpenses = 0;
  let totalDeductible = 0;
  let grossIncome = 0;
  let totalTransactions = 0;
  let needsReviewCount = 0;
  let unanalyzedCount = 0;
  const recentMerchants: string[] = [];

  try {
    const accountsSnapshot = await adminDb
      .collection('user_profiles').doc(uid).collection('accounts').get();

    for (const accountDoc of accountsSnapshot.docs) {
      const txSnap = await adminDb
        .collection('user_profiles').doc(uid)
        .collection('accounts').doc(accountDoc.id)
        .collection('transactions')
        .orderBy('date', 'desc')
        .limit(100)
        .get();

      for (const txDoc of txSnap.docs) {
        const data = txDoc.data();
        const amount = data.amount ?? 0;
        const category = data.category || data.personal_finance_category?.detailed || 'Uncategorized';
        const isDeductible = data.is_deductible === true;
        totalTransactions++;

        if (data.deduction_score === undefined || data.deduction_score === null) unanalyzedCount++;
        if (data.needs_review === true || (!data.is_deductible && data.deduction_score !== undefined)) needsReviewCount++;

        if (amount > 0) {
          totalExpenses += amount;
          if (isDeductible) totalDeductible += amount;
          const existing = byCategoryMap.get(category) || { total: 0, count: 0 };
          existing.total += amount;
          existing.count += 1;
          byCategoryMap.set(category, existing);
        } else if (amount < 0) {
          grossIncome += Math.abs(amount);
        }

        if (data.merchant_name && recentMerchants.length < 20) {
          recentMerchants.push(data.merchant_name);
        }
      }
    }
  } catch (err) {
    console.log('🤖 [Tax Assistant] Error fetching transactions:', err);
  }

  const byCategory: CategorySummary[] = Array.from(byCategoryMap.entries())
    .map(([category, { total, count }]) => ({ category, total, count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  return { byCategory, totalExpenses, totalDeductible, grossIncome, totalTransactions, needsReviewCount, unanalyzedCount, recentMerchants };
}

// Fetch W-2 income
async function fetchW2Income(uid: string, year: number) {
  try {
    const snap = await adminDb.collection('w2_income')
      .where('userId', '==', uid).where('taxYear', '==', year).get();
    let totalWages = 0, totalWithheld = 0;
    const employers: string[] = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      totalWages += d.wages || 0;
      totalWithheld += d.federalWithheld || 0;
      if (d.employer) employers.push(d.employer);
    }
    return { totalWages, totalWithheld, employers, count: snap.size };
  } catch { return { totalWages: 0, totalWithheld: 0, employers: [], count: 0 }; }
}

// Fetch deductions
async function fetchDeductions(uid: string, year: number) {
  try {
    const snap = await adminDb.collection('tax_deductions')
      .where('userId', '==', uid).where('taxYear', '==', year).limit(1).get();
    if (snap.empty) return null;
    return snap.docs[0].data();
  } catch { return null; }
}

// Fetch 1099 forms
async function fetch1099s(uid: string, year: number) {
  try {
    const snap = await adminDb.collection('income_1099')
      .where('userId', '==', uid).get();
    const forms = snap.docs.map(d => d.data()).filter(f => f.taxYear === year);
    const total = forms.reduce((s, f) => s + (f.amount || 0), 0);
    return { forms: forms.map(f => `${f.formType}: ${f.payerName} - $${f.amount?.toFixed(2)}`), total, count: forms.length };
  } catch { return { forms: [], total: 0, count: 0 }; }
}

// Fetch quarterly payments
async function fetchQuarterlyPayments(uid: string, year: number) {
  try {
    const snap = await adminDb.collection('user_profiles').doc(uid)
      .collection('quarterly_payments').get();
    const payments = snap.docs.map(d => d.data()).filter(p => p.year === year);
    return payments.map(p => `Q${p.quarter}: $${(p.paidAmount || 0).toFixed(0)} paid of $${(p.estimatedAmount || 0).toFixed(0)} estimated (${p.status})`);
  } catch { return []; }
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });
    }
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const { user, error: authError } = await getAuthenticatedUser(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: { message?: string; conversationHistory?: ConversationMessage[] };
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const message = body.message?.trim();
    if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 });

    const conversationHistory: ConversationMessage[] = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];

    const taxYear = new Date().getFullYear();

    // Fetch ALL user data in parallel
    const profileSnap = await adminDb.collection('user_profiles').doc(user.uid).get();
    const profile = profileSnap.exists ? profileSnap.data() : null;

    const [financial, w2, deductions, income1099, quarterlyPayments] = await Promise.all([
      fetchFinancialSummary(user.uid),
      fetchW2Income(user.uid, taxYear),
      fetchDeductions(user.uid, taxYear),
      fetch1099s(user.uid, taxYear),
      fetchQuarterlyPayments(user.uid, taxYear),
    ]);

    // Calculate real tax numbers
    const scheduleCProfit = Math.max(0, financial.grossIncome - financial.totalExpenses);
    const filingStatus = profile?.filing_status || 'single';
    const seCalc = calcScheduleSE({ scheduleCNetProfit: scheduleCProfit, taxYear }, filingStatus);
    const totalIncome = scheduleCProfit + w2.totalWages;
    const standardDed = STANDARD_DEDUCTIONS_2025[filingStatus as keyof typeof STANDARD_DEDUCTIONS_2025] || 15750;
    const aboveLineDed = (deductions?.healthInsurancePremiums || 0) + (deductions?.sepIraContribution || 0) +
      (deductions?.solo401kEmployeeContribution || 0) + (deductions?.solo401kEmployerContribution || 0) +
      (deductions?.hsaContribution || 0) + (deductions?.studentLoanInterest || 0);
    const agi = Math.max(0, totalIncome - seCalc.halfSEDeduction - aboveLineDed);
    const taxableIncome = Math.max(0, agi - standardDed);
    const federalTax = calculateFederalIncomeTax(taxableIncome, filingStatus);
    const totalFederalTax = federalTax + seCalc.totalSETax;
    const effectiveRate = totalIncome > 0 ? ((totalFederalTax / totalIncome) * 100).toFixed(1) : '0';
    const estimatedQuarterly = Math.max(0, totalFederalTax / 4);

    // State tax
    const stateResult = profile?.state ? calculateStateTax(profile.state, agi, filingStatus) : null;

    // Build rich context
    const userName = profile?.name?.split(' ')[0] || 'there';

    const sections: string[] = [];

    // Identity
    sections.push(`## About ${userName}`);
    const identityLines = [
      profile?.name ? `Name: ${profile.name}` : null,
      profile?.profession ? `Profession: ${profile.profession}` : null,
      profile?.state ? `State: ${profile.state}` : null,
      `Filing status: ${filingStatus.replace(/_/g, ' ')}`,
      profile?.business_entity_type ? `Business entity: ${profile.business_entity_type}` : null,
      profile?.business_start_date ? `Business started: ${profile.business_start_date}` : null,
      profile?.num_dependents ? `Dependents: ${profile.num_dependents}` : null,
    ].filter(Boolean);
    sections.push(identityLines.join('\n'));

    // Income picture
    sections.push(`## ${taxYear} Income`);
    const incomeLines = [
      `Self-employment gross income: $${financial.grossIncome.toFixed(0)}`,
      `Total business expenses: $${financial.totalExpenses.toFixed(0)}`,
      `Schedule C net profit: $${scheduleCProfit.toFixed(0)}`,
      w2.count > 0 ? `W-2 wages: $${w2.totalWages.toFixed(0)} (from ${w2.employers.join(', ')})` : null,
      w2.count > 0 ? `W-2 federal withheld: $${w2.totalWithheld.toFixed(0)}` : null,
      income1099.count > 0 ? `1099 forms (${income1099.count}): ${income1099.forms.join('; ')}` : null,
      `Combined total income: $${totalIncome.toFixed(0)}`,
    ].filter(Boolean);
    sections.push(incomeLines.join('\n'));

    // Deductions
    sections.push(`## Deductions & Write-offs`);
    const dedLines = [
      `Total deductible expenses confirmed: $${financial.totalDeductible.toFixed(0)}`,
      `Deduction capture rate: ${financial.totalTransactions > 0 ? ((financial.totalDeductible / financial.totalExpenses) * 100).toFixed(0) : 0}%`,
      deductions?.healthInsurancePremiums ? `Health insurance premiums: $${deductions.healthInsurancePremiums}` : null,
      deductions?.sepIraContribution ? `SEP-IRA contribution: $${deductions.sepIraContribution}` : null,
      deductions?.solo401kEmployeeContribution ? `Solo 401(k): $${deductions.solo401kEmployeeContribution}` : null,
      deductions?.hsaContribution ? `HSA contribution: $${deductions.hsaContribution}` : null,
      deductions?.studentLoanInterest ? `Student loan interest: $${deductions.studentLoanInterest}` : null,
      deductions?.charitableCashDonations ? `Charitable donations (cash): $${deductions.charitableCashDonations}` : null,
      deductions?.charitableNonCashDonations ? `Charitable donations (non-cash): $${deductions.charitableNonCashDonations}` : null,
      profile?.home_office_sqft ? `Home office: ${profile.home_office_sqft} sqft (${profile.home_office_method || 'simplified'} method)` : null,
      profile?.vehicle_deduction_method ? `Vehicle: ${profile.vehicle_deduction_method} method${profile.vehicle_business_use_percentage ? `, ${profile.vehicle_business_use_percentage}% business use` : ''}` : null,
    ].filter(Boolean);
    sections.push(dedLines.join('\n'));

    // Tax estimate
    sections.push(`## ${taxYear} Tax Estimate`);
    const taxLines = [
      `Adjusted gross income (AGI): $${agi.toFixed(0)}`,
      `Standard deduction: $${standardDed.toFixed(0)}`,
      `Taxable income: $${taxableIncome.toFixed(0)}`,
      `Federal income tax: $${federalTax.toFixed(0)}`,
      `Self-employment tax: $${seCalc.totalSETax.toFixed(0)} (Social Security: $${seCalc.socialSecurityTax.toFixed(0)}, Medicare: $${seCalc.medicareTax.toFixed(0)})`,
      `Half SE deduction: $${seCalc.halfSEDeduction.toFixed(0)}`,
      `Total federal tax: $${totalFederalTax.toFixed(0)}`,
      `Effective tax rate: ${effectiveRate}%`,
      stateResult?.isSupported ? `State tax (${stateResult.stateName}): $${stateResult.stateTax.toFixed(0)} (${stateResult.effectiveRate}% effective)` : stateResult?.note || null,
      stateResult?.isSupported ? `Combined federal + state: $${(totalFederalTax + stateResult.stateTax).toFixed(0)}` : null,
      w2.totalWithheld > 0 ? `W-2 withholding applied: -$${w2.totalWithheld.toFixed(0)}` : null,
      `Estimated quarterly payment needed: ~$${estimatedQuarterly.toFixed(0)}`,
    ].filter(Boolean);
    sections.push(taxLines.join('\n'));

    // Quarterly status
    if (quarterlyPayments.length > 0) {
      sections.push(`## Quarterly Payments\n${quarterlyPayments.join('\n')}`);
    }

    // Expense breakdown
    if (financial.byCategory.length > 0) {
      sections.push(`## Top Expense Categories`);
      sections.push(financial.byCategory.map(c =>
        `- ${c.category}: $${c.total.toFixed(0)} (${c.count} transactions)`
      ).join('\n'));
    }

    // Action items
    const actionLines = [];
    if (financial.unanalyzedCount > 0) actionLines.push(`${financial.unanalyzedCount} transactions haven't been analyzed by AI yet`);
    if (financial.needsReviewCount > 0) actionLines.push(`${financial.needsReviewCount} transactions are pending user review`);
    if (!deductions?.healthInsurancePremiums && !profile?.health_insurance_premiums) actionLines.push(`No health insurance premiums entered — if self-employed, this is a valuable above-the-line deduction`);
    if (!deductions?.sepIraContribution && !deductions?.solo401kEmployeeContribution) actionLines.push(`No retirement contributions entered — SEP-IRA or Solo 401(k) can significantly reduce taxable income`);
    if (!profile?.home_office_sqft) actionLines.push(`No home office deduction set up — worth $1,500/year with simplified method`);
    if (actionLines.length > 0) {
      sections.push(`## Opportunities & Action Items\n${actionLines.map(l => `- ${l}`).join('\n')}`);
    }

    const fullContext = sections.join('\n\n');

    const systemPrompt = `You are ${userName}'s personal AI tax advisor inside WriteOff, a tax platform for self-employed professionals. You have complete access to their financial data, which is shown below. Use it to give specific, personalized advice.

${fullContext}

## Your Role
- You are warm, knowledgeable, and direct. Address ${userName} by name.
- Give specific dollar amounts and percentages from their actual data — never give generic advice when you have real numbers.
- When they ask "how much do I owe?" or "what's my tax situation?", use the exact numbers above.
- Proactively spot opportunities: missed deductions, retirement contribution room, quarterly payment gaps.
- Cite IRS publications (Pub 535, 463, 587, 505, 596) when relevant.
- If a question is outside your scope (legal advice, state-specific edge cases), recommend a CPA.
- Keep responses concise but thorough. Use bullet points for clarity.
- Never fabricate numbers — only reference data from the context above.
- If data is missing (e.g., "Not set"), suggest they update their profile in Settings.`;

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

    return NextResponse.json({ reply, conversationHistory: updatedHistory });
  } catch (err) {
    console.error('🤖 [Tax Assistant] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
