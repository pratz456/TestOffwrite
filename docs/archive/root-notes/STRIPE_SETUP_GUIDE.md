# Stripe Setup Guide for Historical Transactions Feature

This guide will walk you through setting up Stripe for the Historical Transactions subscription feature.

## Step 1: Create a Stripe Account

1. Go to [https://stripe.com](https://stripe.com)
2. Sign up for a new account or log in to your existing account
3. Complete the account setup process

## Step 2: Get Your API Keys

1. Go to Stripe Dashboard → **Developers** → **API keys**
2. Make sure you're in **Test mode** (toggle in top right)
3. Copy your **Secret key** (starts with `sk_test_`)
   - This will be your `STRIPE_SECRET_KEY` environment variable
4. Copy your **Publishable key** (starts with `pk_test_`)
   - This will be your `STRIPE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` environment variables
   - Note: Publishable key is optional for current implementation but recommended

**For Production:**
- Switch to **Live mode** (toggle in top right)
- Copy your **Secret key** (starts with `sk_live_`)
- Copy your **Publishable key** (starts with `pk_live_`)
- Use these in your production environment

## Step 3: Create Products and Prices

You need to create TWO prices for the same product: one monthly and one yearly.

### Create the Product:

1. Go to Stripe Dashboard → **Products**
2. Click **"+ Add product"**
3. Fill in the product details:
   - **Name**: `Historical Transactions (up to 1 year)`
   - **Description**: `Access up to 12 months of transaction history`
   - **Pricing model**: `Recurring`
   - **Currency**: `USD`
4. Click **"Save product"**

### Create Monthly Price ($14.99/month):

1. In the product you just created, click **"+ Add another price"** or **"Add price"**
2. Set up the monthly price:
   - **Price**: `14.99`
   - **Billing period**: `Monthly`
   - **Currency**: `USD`
3. Click **"Add price"**
4. Copy the **Price ID** (starts with `price_`) - this is your `STRIPE_PRICE_ID_MONTHLY`

### Create Yearly Price ($150/year):

1. Still in the same product, click **"+ Add another price"** or **"Add price"**
2. Set up the yearly price:
   - **Price**: `150.00`
   - **Billing period**: `Yearly` (or `Every 12 months`)
   - **Currency**: `USD`
3. Click **"Add price"**
4. Copy the **Price ID** (starts with `price_`) - this is your `STRIPE_PRICE_ID_YEARLY`

**Note:** The code automatically sets a 30-day free trial for both plans, so customers won't be charged for the first month/year.

## Step 4: Set Up Webhook Endpoint

### For Local Development (using Stripe CLI):

1. Install Stripe CLI:
   - **Windows**: Download from [https://stripe.com/docs/stripe-cli](https://stripe.com/docs/stripe-cli)
   - **Mac**: `brew install stripe/stripe-cli/stripe`
   - **Linux**: See Stripe CLI documentation

2. Login to Stripe CLI:
   ```bash
   stripe login
   ```

3. Forward webhooks to your local server:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

4. Copy the webhook signing secret (starts with `whsec_`) that appears
   - This will be your `STRIPE_WEBHOOK_SECRET` for local development

### For Production:

1. Go to Stripe Dashboard → **Developers** → **Webhooks**
2. Click **"+ Add endpoint"**
3. Enter your endpoint URL:
   ```
   https://writeoffapp.com/api/stripe/webhook
   ```
   (Replace with your actual domain)
4. Select events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Click **"Add endpoint"**
6. After creating, click on the endpoint to view details
7. Click **"Reveal"** next to "Signing secret"
8. Copy the signing secret (starts with `whsec_`)
   - This will be your `STRIPE_WEBHOOK_SECRET` for production

## Step 5: Configure Environment Variables

### Local Development (.env.local):

Create a `.env.local` file in your project root (if it doesn't exist) and add:

```env
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_test_secret_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_from_stripe_cli

# Stripe Price IDs - Monthly ($14.99/month)
STRIPE_PRICE_ID_MONTHLY=price_your_monthly_price_id_here
NEXT_PUBLIC_STRIPE_PRICE_ID_MONTHLY=price_your_monthly_price_id_here

# Stripe Price IDs - Yearly ($150/year)
STRIPE_PRICE_ID_YEARLY=price_your_yearly_price_id_here
NEXT_PUBLIC_STRIPE_PRICE_ID_YEARLY=price_your_yearly_price_id_here

# Site URL
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### Production (Firebase Hosting / Vercel):

Add these environment variables in your hosting platform:

**For Firebase Hosting:**
1. Go to Firebase Console → Your Project → Hosting
2. Add environment variables in the hosting settings
3. Or use Firebase Functions config:
   ```bash
   firebase functions:config:set stripe.secret_key="sk_live_..." stripe.webhook_secret="whsec_..." stripe.price_id="price_..."
   ```

**For Vercel:**
1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add each variable for Production environment

## Step 6: Test the Integration

### Test the Checkout Flow:

1. Start your development server:
   ```bash
   npm run dev
   ```

2. Make sure Stripe CLI is forwarding webhooks (if testing locally):
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

3. In your app, navigate to the Transactions page
4. Click "Start 1-Month Trial for 1-Year History"
5. You should be redirected to Stripe Checkout

### Test with Stripe Test Cards:

Use these test card numbers in Stripe Checkout:

- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **Requires Authentication**: `4000 0025 0000 3155`

For all test cards:
- **Expiry**: Any future date (e.g., 12/34)
- **CVC**: Any 3 digits (e.g., 123)
- **ZIP**: Any 5 digits (e.g., 12345)

### Verify Webhook Events:

1. Check your terminal/console for webhook logs
2. In Stripe Dashboard → **Developers** → **Events**, you should see:
   - `checkout.session.completed` when checkout succeeds
   - `customer.subscription.created` when subscription is created
   - `customer.subscription.updated` when subscription status changes

### Verify User Access:

1. After successful checkout, check your Firestore database:
   - Go to `user_profiles/{userId}`
   - Verify these fields are set:
     - `hasHistoricalAccess: true`
     - `trialStart: [timestamp]`
     - `trialEnd: [timestamp]`
     - `stripeCustomerId: "cus_..."`
     - `stripeSubscriptionId: "sub_..."`
     - `stripeSubscriptionStatus: "trialing"`

2. Try connecting a bank account or syncing transactions
3. Verify that the system fetches up to 1 year of transactions (instead of 3 months)

## Step 7: Monitor and Debug

### Check Webhook Logs:

1. Stripe Dashboard → **Developers** → **Webhooks**
2. Click on your webhook endpoint
3. View recent events and their responses
4. Check for any failed deliveries

### Common Issues:

**Issue: Webhook not receiving events**
- Verify webhook URL is correct and accessible
- Check that webhook secret matches in environment variables
- Ensure webhook endpoint is deployed and running

**Issue: Checkout redirects but subscription not created**
- Check webhook logs in Stripe Dashboard
- Verify webhook secret is correct
- Check server logs for errors

**Issue: User doesn't get access after checkout**
- Verify webhook handler is updating user profile correctly
- Check Firestore permissions
- Verify `firebase_uid` is in Stripe customer/subscription metadata

## Step 8: Go Live

When ready for production:

1. **Switch to Live Mode** in Stripe Dashboard
2. **Create a live product and price** (repeat Step 3 in Live mode)
3. **Set up production webhook** (repeat Step 4 for production URL)
4. **Update environment variables** with live keys:
   - `STRIPE_SECRET_KEY=sk_live_...`
   - `STRIPE_WEBHOOK_SECRET=whsec_...` (from production webhook)
   - `STRIPE_PRICE_ID=price_...` (from live product)
5. **Test with a real card** (use a small amount first)
6. **Monitor webhook events** in production

## Security Best Practices

1. **Never commit** `.env.local` or `.env` files to git
2. **Use different keys** for test and production
3. **Rotate webhook secrets** if compromised
4. **Monitor webhook events** for suspicious activity
5. **Use HTTPS** for all webhook endpoints in production
6. **Verify webhook signatures** (already implemented in code)

## Support

- Stripe Documentation: [https://stripe.com/docs](https://stripe.com/docs)
- Stripe Support: [https://support.stripe.com](https://support.stripe.com)
- Stripe API Reference: [https://stripe.com/docs/api](https://stripe.com/docs/api)

