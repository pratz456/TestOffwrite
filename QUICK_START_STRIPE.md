# Quick Start: Stripe Setup for Historical Transactions

This is a condensed guide to get Stripe working quickly. For detailed instructions, see `STRIPE_SETUP_GUIDE.md`.

## 1. Install Stripe Package ✅

Already done! The `stripe` package has been installed.

## 2. Get Your Stripe Keys (5 minutes)

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Developers** → **API keys**
2. Make sure you're in **Test mode** (toggle in top right)
3. Copy your **Secret key** (`sk_test_...`) → `STRIPE_SECRET_KEY`
4. Copy your **Publishable key** (`pk_test_...`) → `STRIPE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (optional but recommended)

## 3. Create Products in Stripe (3 minutes)

1. Go to **Products** → **"+ Add product"**
2. Name: `Historical Transactions (up to 1 year)`
3. Add TWO prices to the same product:
   - **Monthly**: $14.99/month → Copy Price ID (`price_...`) → `STRIPE_PRICE_ID_MONTHLY`
   - **Yearly**: $150/year → Copy Price ID (`price_...`) → `STRIPE_PRICE_ID_YEARLY`

## 4. Set Up Webhook for Local Development (2 minutes)

### Option A: Using Stripe CLI (Recommended)

1. Install Stripe CLI: [https://stripe.com/docs/stripe-cli](https://stripe.com/docs/stripe-cli)
2. Login: `stripe login`
3. Forward webhooks: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
4. Copy the webhook secret (`whsec_...`) that appears

### Option B: Manual Webhook Setup

1. Go to **Developers** → **Webhooks** → **"+ Add endpoint"**
2. URL: `https://your-domain.com/api/stripe/webhook` (for production)
3. Select events: `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_*`
4. Copy the signing secret (`whsec_...`)

## 5. Configure Environment Variables (1 minute)

Create `.env.local` in your project root:

```env
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# Monthly Price ($14.99/month)
STRIPE_PRICE_ID_MONTHLY=price_your_monthly_price_id_here
NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY=price_your_monthly_price_id_here

# Yearly Price ($150/year)
STRIPE_PRICE_ID_YEARLY=price_your_yearly_price_id_here
NEXT_PUBLIC_STRIPE_PRICE_ID_YEARLY=price_your_yearly_price_id_here

# Site URL
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## 6. Verify Configuration

Run the validation script:

```bash
npm run stripe:check
```

This will verify your environment variables are set correctly.

## 7. Test It!

1. Start your dev server:
   ```bash
   npm run dev
   ```

2. If using Stripe CLI, start webhook forwarding:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

3. In your app:
   - Go to Transactions page
   - Click "Start 1-Month Trial for 1-Year History"
   - Use test card: `4242 4242 4242 4242`
   - Complete checkout

4. Verify:
   - Check Firestore: `user_profiles/{userId}` should have `hasHistoricalAccess: true`
   - Try syncing transactions - should fetch up to 1 year

## Troubleshooting

**Webhook not working?**
- Make sure Stripe CLI is running: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
- Check webhook secret matches in `.env.local`
- Check server logs for errors

**Checkout not redirecting?**
- Verify `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID` are correct
- Check browser console for errors

**User not getting access?**
- Check webhook events in Stripe Dashboard → Developers → Events
- Verify webhook is updating Firestore correctly
- Check Firestore permissions

## Next Steps

- See `STRIPE_SETUP_GUIDE.md` for detailed instructions
- See `HISTORICAL_TRANSACTIONS_FEATURE.md` for feature documentation
- Test with different Stripe test cards
- Set up production webhook when ready to go live

