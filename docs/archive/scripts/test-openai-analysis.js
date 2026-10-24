// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

const OpenAI = null;

// Test OpenAI analysis
async function testOpenAIAnalysis() {
  console.log('🧪 Testing OpenAI analysis...');
  
  try {
    // Check environment variables
    console.log('📋 Environment check:');
    console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing');
    
    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ OPENAI_API_KEY is not set in .env.local');
      return;
    }
    
    // Initialize OpenAI client
    console.log('🔄 Initializing OpenAI client...');
    if (!OpenAI) {
      console.error('This archived script no longer constructs a model client. Use the server gate.');
      return;
    }
    const openai = OpenAI;
    
    console.log('✅ OpenAI client initialized successfully');
    
    // Test transaction analysis
    console.log('🔄 Testing transaction analysis...');
    
    const testTransaction = {
      merchant_name: 'Starbucks',
      amount: 5.50,
      category: 'FOOD_AND_DRINK_COFFEE',
      date: '2024-01-15',
    };
    
    const prompt = `
    Analyze this transaction for tax deductibility:
    
    Transaction: ${testTransaction.merchant_name}
    Amount: $${testTransaction.amount}
    Category: ${testTransaction.category}
    Date: ${testTransaction.date}
    
    Determine if this transaction is tax deductible for a business owner. Consider:
    1. Is it a legitimate business expense?
    2. Is it ordinary and necessary for the business?
    3. Is it directly related to business operations?
    4. What percentage of the transaction amount is deductible?
    
    Respond with a JSON object in this exact format:
    {
      "is_deductible": true/false,
      "deduction_score": 0.85,
      "deduction_percent": 100,
      "deduction_reason": "Detailed explanation of why it is or isn't deductible"
    }
    `;
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a tax expert specializing in business deductions. Provide accurate, conservative analysis. Always respond with valid JSON in the exact format requested.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 150,
      temperature: 0.1,
    });
    
    const content = response.choices[0].message.content;
    console.log('✅ OpenAI response received');
    console.log('📋 Raw response:', content);
    
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      console.log('✅ JSON parsed successfully');
      console.log('📋 Analysis result:', analysis);
      
      // Validate required fields
      const requiredFields = ['is_deductible', 'deduction_score', 'deduction_percent', 'deduction_reason'];
      const missingFields = requiredFields.filter(field => !(field in analysis));
      
      if (missingFields.length === 0) {
        console.log('✅ All required fields present');
        console.log('🎉 OpenAI analysis test completed successfully!');
      } else {
        console.error('❌ Missing required fields:', missingFields);
      }
    } else {
      console.error('❌ No valid JSON found in response');
    }
    
  } catch (error) {
    console.error('❌ OpenAI analysis test failed:', error.message);
    console.error('Full error:', error);
  }
}

// Run the test
testOpenAIAnalysis().catch(console.error);
