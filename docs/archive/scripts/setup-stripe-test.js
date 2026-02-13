/**
 * Script to help set up Stripe test mode configuration
 * This script validates your Stripe configuration and provides helpful feedback
 *
 * Usage: node scripts/setup-stripe-test.js
 */

require('dotenv').config({ path: '.env.local' });

const requiredEnvVars = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_ID_MONTHLY',
  'NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY',
  'STRIPE_PRICE_ID_YEARLY',
  'NEXT_PUBLIC_STRIPE_PRICE_ID_YEARLY',
  'NEXT_PUBLIC_SITE_URL',
];

const optionalEnvVars = [
  'STRIPE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
];

console.log('🔍 Checking Stripe Configuration...\n');
console.log('📋 Required Stripe Environment Variables:\n');

let allValid = true;

// Check for required environment variables
requiredEnvVars.forEach(varName => {
  const value = process.env[varName];
  if (!value) {
    console.error(`❌ Missing: ${varName}`);
    allValid = false;
  } else {
    // Validate format
    if (varName === 'STRIPE_SECRET_KEY' && !value.startsWith('sk_test_') && !value.startsWith('sk_live_')) {
      console.warn(`⚠️  ${varName} doesn't look like a valid Stripe key (should start with sk_test_ or sk_live_)`);
    } else if (varName === 'STRIPE_WEBHOOK_SECRET' && !value.startsWith('whsec_')) {
      console.warn(`⚠️  ${varName} doesn't look like a valid webhook secret (should start with whsec_)`);
    } else if (varName.includes('PRICE_ID') && !value.startsWith('price_')) {
      console.warn(`⚠️  ${varName} doesn't look like a valid price ID (should start with price_)`);
    } else if (varName.includes('PUBLISHABLE_KEY') && !value.startsWith('pk_test_') && !value.startsWith('pk_live_')) {
      console.warn(`⚠️  ${varName} doesn't look like a valid publishable key (should start with pk_test_ or pk_live_)`);
    } else {
      const displayValue = value.length > 20 ? `${value.substring(0, 20)}...` : value;
      console.log(`✅ ${varName}: ${displayValue}`);
    }
  }
});

// Check optional variables
console.log('\n📋 Optional Stripe Environment Variables:\n');
optionalEnvVars.forEach(varName => {
  const value = process.env[varName];
  if (!value) {
    console.log(`ℹ️  Optional: ${varName} (not set, but recommended)`);
  } else {
    if (varName.includes('PUBLISHABLE_KEY') && !value.startsWith('pk_test_') && !value.startsWith('pk_live_')) {
      console.warn(`⚠️  ${varName} doesn't look like a valid publishable key (should start with pk_test_ or pk_live_)`);
    } else {
      const displayValue = value.length > 20 ? `${value.substring(0, 20)}...` : value;
      console.log(`✅ ${varName}: ${displayValue}`);
    }
  }
});

console.log('\n');

if (!allValid) {
  console.error('❌ Some required environment variables are missing!');
  console.log('\n📝 Next steps:');
  console.log('1. Copy .env.example to .env.local');
  console.log('2. Fill in your Stripe credentials from Stripe Dashboard');
  console.log('3. See STRIPE_SETUP_GUIDE.md for detailed instructions');
  console.log('4. See STRIPE_KEYS_REFERENCE.md for where to get each key');
  process.exit(1);
}

// Try to validate with Stripe API (optional)
if (process.env.STRIPE_SECRET_KEY) {
  try {
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    console.log('🔗 Testing Stripe API connection...');
    stripe.customers.list({ limit: 1 })
      .then(() => {
        console.log('✅ Stripe API connection successful!\n');
        console.log('🎉 Your Stripe configuration looks good!');
        console.log('\n📝 Next steps:');
        console.log('1. Make sure your webhook is set up (see STRIPE_SETUP_GUIDE.md)');
        console.log('2. Test the checkout flow in your app');
        console.log('3. Monitor webhook events in Stripe Dashboard');
      })
      .catch((error) => {
        console.error('❌ Stripe API connection failed:', error.message);
        console.log('\n⚠️  Check that your STRIPE_SECRET_KEY is correct');
      });
  } catch (error) {
    console.warn('⚠️  Could not test Stripe API connection (stripe package may not be installed)');
    console.log('   Run: npm install stripe');
  }
} else {
  console.log('⚠️  Cannot test API connection without STRIPE_SECRET_KEY');
}

