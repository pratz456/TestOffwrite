import { openaiClient } from './client'
import { getTransactionsServer, updateTransactionServerWithUserId } from '../firebase/transactions-server'

export type AIAnalysis = {
  is_deductible: boolean | null;
  deduction_score: number | null;     // 0..1
  status_label: 'Likely Deductible' | 'Possibly Deductible' | 'Unlikely Deductible' | 'Income' | 'Refund' | 'Unknown';
  reasoning: string | null;
  irs_publication: string | null;
  irs_section: string | null;
  required_docs: string[];
  key_analysis_factors?: {
    business_purpose: string;
    ordinary_necessary: string;
    documentation_required: string[];
    audit_risk: 'Low' | 'Medium' | 'High';
    specific_rules: string[];
    limitations: string[];
    deduction_status: 'Likely Deductible' | 'Possibly Deductible' | 'Unlikely Deductible' | 'Income' | 'Refund';
    deduction_percentage: number; // 0-100
    reasoning_summary: string; // 2-line reasoning specific to user profile
    irs_reference: string; // Specific IRS publication and section
  };
  model?: string;
};

function buildPrompt(tx: any, userContext?: any) {
  const name = tx?.name ?? tx?.merchant_name ?? 'Unknown';
  const amount = Number(tx?.amount ?? 0);
  const date = tx?.date ?? tx?.authorized_date ?? 'unknown date';
  const category = Array.isArray(tx?.category) ? tx.category.join(' > ') : (tx?.category || 'Uncategorized');
  const notes = tx?.description || tx?.memo || '';

  // Build user context string
  const contextString = userContext ? `
User Profile Context:
- Profession: ${userContext.profession || 'Not specified'}
- Annual Income: ${userContext.income ? `$${userContext.income.toLocaleString()}` : 'Not specified'}
- State: ${userContext.state || 'Not specified'}
- Filing Status: ${userContext.filing_status || 'Not specified'}

` : '';

  return `
You are a U.S. small-business tax assistant. Decide deductibility for the transaction and output ONLY JSON.

${contextString}Rules:
- Use IRS concepts (e.g., Pub 535, Section 162).
- Consider the user's profession, income level, and filing status when determining deductibility.
- "deduction_score" must be 0..1 (probability-style confidence).
- "status_label" mapping:
  - deduction_score >= 0.75 → "Likely Deductible"
  - 0.40..0.74 → "Possibly Deductible"
  - < 0.40 → "Unlikely Deductible"
- Transaction amount analysis:
  - Negative amounts are typically expenses (money going out of account)
  - Positive amounts are typically income or refunds (money coming into account)
  - Use "Refund" for legitimate refunds, not "Income"
  - Use "Income" only for actual business income/revenue
- For key_analysis_factors:
  - "deduction_percentage" should be 0-100 (convert deduction_score * 100)
  - "reasoning_summary" should be exactly 3 lines, specific to user's profession, timing context, and business context
  - "irs_reference" should include specific publication and section (e.g., "IRS Publication 535, Section 162")

Return ONLY this JSON object (no prose):
{
  "is_deductible": boolean | null,
  "deduction_score": number(0..1) | null,
  "status_label": "Likely Deductible" | "Possibly Deductible" | "Unlikely Deductible" | "Income" | "Refund" | "Unknown",
  "reasoning": string | null,
  "irs_publication": string | null,
  "irs_section": string | null,
  "required_docs": string[], 
  "key_analysis_factors": {
    "business_purpose": "Brief explanation of business purpose",
    "ordinary_necessary": "Assessment of ordinary and necessary test",
    "documentation_required": ["List of suggested documentation"],
    "audit_risk": "Low" | "Medium" | "High",
    "specific_rules": ["Specific IRS rules that apply"],
    "limitations": ["Any limitations or restrictions"],
    "deduction_status": "Likely Deductible" | "Possibly Deductible" | "Unlikely Deductible" | "Income" | "Refund",
    "deduction_percentage": 85,
    "reasoning_summary": "Three-line explanation considering user's profession, timing context, and specific business context",
    "irs_reference": "IRS Publication 535, Section 162 - Business Expenses"
  }
}

Transaction:
- Name: ${name}
- Amount: ${amount}
- Date: ${date}
- Category: ${category}
- Notes: ${notes}
  `.trim();
}

export async function analyzeTransaction(tx: any, userContext?: any): Promise<AIAnalysis> {

  const res = await openaiClient.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You return ONLY valid JSON matching the requested schema.' },
      { role: 'user', content: buildPrompt(tx, userContext) },
    ],
  });

  let parsed: any = {};
  try {
    parsed = JSON.parse(res.choices?.[0]?.message?.content ?? '{}');
  } catch {}

  // normalize & clamp
  const score =
    typeof parsed.deduction_score === 'number'
      ? Math.max(0, Math.min(1, parsed.deduction_score))
      : null;

  const out: AIAnalysis = {
    is_deductible: typeof parsed.is_deductible === 'boolean' ? parsed.is_deductible : null,
    deduction_score: score,
    status_label:
      parsed.status_label === 'Likely Deductible' ||
      parsed.status_label === 'Possibly Deductible' ||
      parsed.status_label === 'Unlikely Deductible' ||
      parsed.status_label === 'Income' ||
      parsed.status_label === 'Refund'
        ? parsed.status_label
        : 'Unknown',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : null,
    irs_publication: typeof parsed.irs_publication === 'string' ? parsed.irs_publication : null,
    irs_section: typeof parsed.irs_section === 'string' ? parsed.irs_section : null,
    required_docs: Array.isArray(parsed.required_docs) ? parsed.required_docs.filter((s: any) => typeof s === 'string') : [],
    key_analysis_factors: parsed.key_analysis_factors && typeof parsed.key_analysis_factors === 'object' ? {
      business_purpose: typeof parsed.key_analysis_factors.business_purpose === 'string' ? parsed.key_analysis_factors.business_purpose : '',
      ordinary_necessary: typeof parsed.key_analysis_factors.ordinary_necessary === 'string' ? parsed.key_analysis_factors.ordinary_necessary : '',
      documentation_required: Array.isArray(parsed.key_analysis_factors.documentation_required) ? parsed.key_analysis_factors.documentation_required.filter((s: any) => typeof s === 'string') : [],
      audit_risk: ['Low', 'Medium', 'High'].includes(parsed.key_analysis_factors.audit_risk) ? parsed.key_analysis_factors.audit_risk : 'Medium',
      specific_rules: Array.isArray(parsed.key_analysis_factors.specific_rules) ? parsed.key_analysis_factors.specific_rules.filter((s: any) => typeof s === 'string') : [],
      limitations: Array.isArray(parsed.key_analysis_factors.limitations) ? parsed.key_analysis_factors.limitations.filter((s: any) => typeof s === 'string') : [],
      deduction_status: ['Likely Deductible', 'Possibly Deductible', 'Unlikely Deductible', 'Income'].includes(parsed.key_analysis_factors.deduction_status) ? parsed.key_analysis_factors.deduction_status : 'Unknown',
      deduction_percentage: typeof parsed.key_analysis_factors.deduction_percentage === 'number' ? Math.max(0, Math.min(100, parsed.key_analysis_factors.deduction_percentage)) : (typeof out.deduction_score === 'number' ? Math.round(out.deduction_score * 100) : 0),
      reasoning_summary: typeof parsed.key_analysis_factors.reasoning_summary === 'string' ? parsed.key_analysis_factors.reasoning_summary : '',
      irs_reference: typeof parsed.key_analysis_factors.irs_reference === 'string' ? parsed.key_analysis_factors.irs_reference : '',
    } : undefined,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };

  // fallback for missing label: derive from score
  if (out.status_label === 'Unknown' && typeof out.deduction_score === 'number') {
    out.status_label =
      out.deduction_score >= 0.75 ? 'Likely Deductible'
      : out.deduction_score >= 0.40 ? 'Possibly Deductible'
      : 'Unlikely Deductible';
  }

  return out;
}

// Legacy function for backward compatibility
export async function analyzeTransactionDeductibility(transaction: any) {
  const analysis = await analyzeTransaction(transaction);
  
  return {
    success: true,
    is_deductible: analysis.is_deductible,
    deduction_score: analysis.deduction_score,
    deduction_reason: analysis.reasoning,
  };
}

export async function analyzeAllTransactions(userId: string) {
  try {
    const { data: transactions } = await getTransactionsServer(userId)
    if (!transactions || transactions.length === 0) {
      return { success: false, error: 'No transactions found' }
    }

    const analysisPromises = transactions.map(async (transaction) => {
      const analysis = await analyzeTransactionDeductibility(transaction)
      if (analysis.success) {
        await updateTransactionServerWithUserId(userId, transaction.trans_id, {
          is_deductible: null, // Always set to null to require user review
          deductible_reason: analysis.deduction_reason,
          deduction_score: analysis.deduction_score || undefined,
        })
      }
      return analysis
    })

    const results = await Promise.all(analysisPromises)
    const successful = results.filter(r => r.success).length

    return { success: true, analyzed: successful, total: transactions.length }
  } catch (error) {
    console.error('Error analyzing all transactions:', error)
    return { success: false, error }
  }
}

export async function generateTaxSummary(userId: string) {
  try {
    const { data: transactions } = await getTransactionsServer(userId)
    if (!transactions || transactions.length === 0) {
      return { success: false, error: 'No transactions found' }
    }

    const deductibleTransactions = transactions.filter(t => t.is_deductible)
    const totalDeductible = deductibleTransactions.reduce((sum, t) => sum + t.amount, 0)

    const prompt = `
      Generate a tax summary for business deductions:
      
      Total transactions: ${transactions.length}
      Deductible transactions: ${deductibleTransactions.length}
      Total deductible amount: $${totalDeductible}
      
      Deductible transactions:
      ${deductibleTransactions.map(t => `- ${t.merchant_name}: $${t.amount} (${t.deductible_reason})`).join('\n')}
      
      Provide a brief summary of the tax implications and any recommendations.
    `

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a tax professional providing clear, actionable advice.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 500,
      temperature: 0.3,
    })

    return {
      success: true,
      summary: response.choices[0].message.content,
      totalDeductible,
      deductibleCount: deductibleTransactions.length,
    }
  } catch (error) {
    console.error('Error generating tax summary:', error)
    return { success: false, error }
  }
} 