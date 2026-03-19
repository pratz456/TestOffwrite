export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

function getOpenAIOrNull() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

interface VoiceCommand {
  type: 'add_expense' | 'add_mileage' | 'question' | 'unknown';
  data: {
    amount?: number;
    merchant?: string;
    category?: string;
    purpose?: string;
    miles?: number;
    question?: string;
  };
  confidence: number;
}

export async function POST(request: NextRequest) {
  try {
    const openai = getOpenAIOrNull();
    if (!openai) {
      return NextResponse.json(
        { error: 'OpenAI is not configured (missing OPENAI_API_KEY)' },
        { status: 500 }
      );
    }

    const { text } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    console.log('🎤 [Voice Command] Processing:', text);

    const systemPrompt = `You are a voice command parser for a tax expense tracking app. Parse the user's spoken text into structured commands.

Available command types:
1. add_expense - User wants to add a business expense
2. add_mileage - User wants to log business mileage
3. question - User is asking a tax-related question
4. unknown - Command doesn't match any known patterns

For add_expense commands, extract:
- amount: The dollar amount (as a number)
- merchant: The business/merchant name
- category: Business category (meals_50, gas, office_supplies, software_subscriptions, travel, vehicle_expense, home_office, utilities_phone_internet, education_training, dues_and_memberships, bank_and_payment_fees, rent, other)
- purpose: Business purpose if mentioned

For add_mileage commands, extract:
- miles: Number of miles driven
- purpose: Business purpose for the trip

For question commands, extract:
- question: The tax question being asked

Return ONLY valid JSON in this exact format:
{
  "type": "add_expense" | "add_mileage" | "question" | "unknown",
  "data": {
    "amount": number (for expenses),
    "merchant": "string" (for expenses),
    "category": "string" (for expenses),
    "purpose": "string" (for expenses/mileage),
    "miles": number (for mileage),
    "question": "string" (for questions)
  },
  "confidence": number (0-1)
}

Examples:
- "Add $45 Starbucks meeting expense" → {"type": "add_expense", "data": {"amount": 45, "merchant": "Starbucks", "category": "meals_50", "purpose": "meeting"}, "confidence": 0.9}
- "Log 25 miles business trip" → {"type": "add_mileage", "data": {"miles": 25, "purpose": "business trip"}, "confidence": 0.8}
- "Can I deduct my home office?" → {"type": "question", "data": {"question": "Can I deduct my home office?"}, "confidence": 0.9}
- "Hello there" → {"type": "unknown", "data": {}, "confidence": 0.1}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      temperature: 0.1,
      max_tokens: 200
    });

    const responseText = completion.choices[0]?.message?.content;
    
    if (!responseText) {
      throw new Error('No response from OpenAI');
    }

    let command: VoiceCommand;
    try {
      command = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ [Voice Command] JSON parse error:', parseError);
      console.error('❌ [Voice Command] Raw response:', responseText);
      
      // Fallback parsing
      command = {
        type: 'unknown',
        data: {},
        confidence: 0.1
      };
    }

    // Validate command structure
    if (!command.type || !command.data || typeof command.confidence !== 'number') {
      command = {
        type: 'unknown',
        data: {},
        confidence: 0.1
      };
    }

    console.log('✅ [Voice Command] Parsed command:', command);

    return NextResponse.json({
      success: true,
      command
    });

  } catch (error) {
    console.error('❌ [Voice Command] Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to parse voice command',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
