# Stripe Keys & Environment Variables Reference

This document lists all Stripe-related environment variables needed for the Historical Transactions feature.

## Required Environment Variables

### 1. STRIPE_SECRET_KEY (Required)
- **Type**: Server-side only (NOT public)
- **Format**: `sk_test_...` (test mode) or `sk_live_...` (production)
- **Where to get it**:
  1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
  2. Navigate to **Developers** → **API keys**
  3. Toggle to **Test mode** or **Live mode**
  4. Copy the **Secret key** (starts with `sk_test_` or `sk_live_`)
- **Used in**:
  - `app/api/stripe/create-checkout/route.ts` - Creating checkout sessions
  - `app/api/stripe/webhook/route.ts` - Verifying webhook events
- **Security**: ⚠️ **NEVER** expose this in client-side code or commit to git

### 2. STRIPE_PUBLISHABLE_KEY (Optional - Recommended)
- **Type**: Public (client-side accessible, safe to expose)
- **Format**: `pk_test_...` (test mode) or `pk_live_...` (production)
- **Where to get it**:
  1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
  2. Navigate to **Developers** → **API keys**
  3. Toggle to **Test mode** or **Live mode**
  4. Copy the **Publishable key** (starts with `pk_test_` or `pk_live_`)
- **Used in**:
  - Currently not used (we use server-side Checkout)
  - Can be used for Stripe Elements, Payment Intents, or other client-side Stripe features
- **Also set**: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (same value, for Next.js client-side)
- **Security**: ✅ Safe to expose in client-side code (this is its purpose)

### 3. STRIPE_WEBHOOK_SECRET (Required)
- **Type**: Server-side only (NOT public)
- **Format**: `whsec_...`
- **Where to get it**:

  **For Local Development (Stripe CLI)**:
  1. Install Stripe CLI: [https://stripe.com/docs/stripe-cli](https://stripe.com/docs/stripe-cli)
  2. Run: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
  3. Copy the webhook signing secret that appears (starts with `whsec_`)

  **For Production**:
  1. Go to Stripe Dashboard → **Developers** → **Webhooks**
  2. Click on your webhook endpoint (or create one)
  3. Click **"Reveal"** next to "Signing secret"
  4. Copy the secret (starts with `whsec_`)
- **Used in**:
  - `app/api/stripe/webhook/route.ts` - Verifying webhook signatures
- **Security**: ⚠️ **NEVER** expose this in client-side code or commit to git

### 4. STRIPE_PRICE_ID_MONTHLY (Required)
- **Type**: Can be public (NEXT_PUBLIC_ prefix) or server-side
- **Format**: `price_...`
- **Value**: Price ID for $14.99/month subscription
- **Where to get it**:
  1. Go to Stripe Dashboard → **Products**
  2. Find "Historical Transactions (up to 1 year)" product
  3. Click on the **Monthly** price ($14.99/month)
  4. Copy the **Price ID** (starts with `price_`)
- **Used in**:
  - `app/api/stripe/create-checkout/route.ts` - When user selects monthly plan
- **Also set**: `NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY` (same value, for client-side if needed)

### 5. STRIPE_PRICE_ID_YEARLY (Required)
- **Type**: Can be public (NEXT_PUBLIC_ prefix) or server-side
- **Format**: `price_...`
- **Value**: Price ID for $150/year subscription
- **Where to get it**:
  1. Go to Stripe Dashboard → **Products**
  2. Find "Historical Transactions (up to 1 year)" product
  3. Click on the **Yearly** price ($150/year)
  4. Copy the **Price ID** (starts with `price_`)
- **Used in**:
  - `app/api/stripe/create-checkout/route.ts` - When user selects yearly plan
- **Also set**: `NEXT_PUBLIC_STRIPE_PRICE_ID_YEARLY` (same value, for client-side if needed)

### 6. NEXT_PUBLIC_SITE_URL (Required)
- **Type**: Public (client-side accessible)
- **Format**: Full URL (e.g., `https://writeoffapp.com` or `http://localhost:3000`)
- **Purpose**: Used for Stripe checkout redirect URLs
- **Where to set**:
  - **Local**: `http://localhost:3000`
  - **Production**: Your actual domain (e.g., `https://writeoffapp.com`)
- **Used in**:
  - `app/api/stripe/create-checkout/route.ts` - `success_url` and `cancel_url`
- **Fallback**: Falls back to `VERCEL_URL` if not set

## Optional / Legacy Variables

### STRIPE_PRICE_ID (Optional - Legacy)
- **Type**: Can be public or server-side
- **Format**: `price_...`
- **Purpose**: Legacy fallback for monthly price (if new vars not set)
- **Used in**: `app/api/stripe/create-checkout/route.ts` - Fallback for monthly if `STRIPE_PRICE_ID_MONTHLY` not set
- **Note**: Not required if you set `STRIPE_PRICE_ID_MONTHLY`

### NEXT_PUBLIC_STRIPE_PRICE_ID (Optional - Legacy)
- **Type**: Public (client-side accessible)
- **Format**: `price_...`
- **Purpose**: Legacy fallback for monthly price (client-side)
- **Note**: Not required if you set `NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY`

## Complete .env.local Example

```env
# ============================================
# STRIPE CONFIGURATION
# ============================================

# Stripe Secret Key (Server-side only - NEVER expose to client)
# Get from: Stripe Dashboard → Developers → API keys
STRIPE_SECRET_KEY=sk_test_51AbC123...your_secret_key_here

# Stripe Publishable Key (Public - Safe to expose on client-side)
# Get from: Stripe Dashboard → Developers → API keys
STRIPE_PUBLISHABLE_KEY=pk_test_51AbC123...your_publishable_key_here
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_51AbC123...your_publishable_key_here

# Stripe Webhook Secret (Server-side only - NEVER expose to client)
# Get from: Stripe CLI (local) or Stripe Dashboard → Webhooks (production)
STRIPE_WEBHOOK_SECRET=whsec_1234567890abcdef...your_webhook_secret_here

# Monthly Price ID ($14.99/month)
# Get from: Stripe Dashboard → Products → Historical Transactions → Monthly price
STRIPE_PRICE_ID_MONTHLY=price_1AbC123monthly...your_monthly_price_id
NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY=price_1AbC123monthly...your_monthly_price_id

# Yearly Price ID ($150/year)
# Get from: Stripe Dashboard → Products → Historical Transactions → Yearly price
STRIPE_PRICE_ID_YEARLY=price_1AbC123yearly...your_yearly_price_id
NEXT_PUBLIC_STRIPE_PRICE_ID_YEARLY=price_1AbC123yearly...your_yearly_price_id

# Site URL (for Stripe redirects)
NEXT_PUBLIC_SITE_URL=http://localhost:3000
# For production: NEXT_PUBLIC_SITE_URL=https://writeoffapp.com
```

## Quick Checklist

- [ ] `STRIPE_SECRET_KEY` - From Stripe Dashboard → API keys
- [ ] `STRIPE_PUBLISHABLE_KEY` - From Stripe Dashboard → API keys (optional but recommended)
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - Same as above (for client-side)
- [ ] `STRIPE_WEBHOOK_SECRET` - From Stripe CLI or Dashboard → Webhooks
- [ ] `STRIPE_PRICE_ID_MONTHLY` - From Stripe Dashboard → Products → Monthly price
- [ ] `NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY` - Same as above
- [ ] `STRIPE_PRICE_ID_YEARLY` - From Stripe Dashboard → Products → Yearly price
- [ ] `NEXT_PUBLIC_STRIPE_PRICE_ID_YEARLY` - Same as above
- [ ] `NEXT_PUBLIC_SITE_URL` - Your site URL

## Security Notes

### ⚠️ NEVER Commit These to Git:
- `STRIPE_SECRET_KEY` - Keep this secret!
- `STRIPE_WEBHOOK_SECRET` - Keep this secret!

### ✅ Safe to Commit (if needed):
- `STRIPE_PRICE_ID_*` - Price IDs are not sensitive (but still better in env vars)
- `NEXT_PUBLIC_*` - These are public anyway

### 🔒 Best Practices:
1. Use `.env.local` for local development (already in `.gitignore`)
2. Use environment variables in production (Firebase/Vercel settings)
3. Never log or expose secret keys in client-side code
4. Use different keys for test vs production
5. Rotate keys if compromised

## Test vs Production Keys

### Test Mode:
- `STRIPE_SECRET_KEY=sk_test_...`
- Use test price IDs from test mode products
- Use Stripe CLI webhook secret for local testing

### Production Mode:
- `STRIPE_SECRET_KEY=sk_live_...`
- Use live price IDs from live mode products
- Use production webhook secret from Stripe Dashboard

## Verification

Run the validation script to check all keys are set:
```bash
npm run stripe:check
```

This will verify:
- All required variables are present
- Format looks correct (starts with expected prefixes)
- Stripe API connection works (if key is valid)

