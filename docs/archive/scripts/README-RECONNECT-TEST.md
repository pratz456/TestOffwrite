# Plaid Reconnect & Maximum Transactions Test

This guide helps you test if reconnecting your account via Plaid Link can fetch more historical transactions.

## Current Status

**Before Reconnect:**
- Total Transactions: 94
- First Transaction: 2025-08-19
- Last Transaction: 2025-11-17
- Date Range: 92 days
- Connection Date: 2025-08-19

## How to Reconnect via Plaid Link

### Step 1: Disconnect Current Account

1. Open your app in the browser
2. Go to **Settings** → **Bank Accounts** (or similar)
3. Find your connected account (Discover it Card)
4. Click **Disconnect** or **Remove Account**
5. Confirm the disconnection

### Step 2: Reconnect via Plaid Link

1. In your app, go to the **Connect Bank Account** page
2. Click **Connect Bank Account** button
3. Select your bank (Discover)
4. Log in with your bank credentials
5. Complete the Plaid Link flow
6. Select the same account(s) you had before

### Step 3: Get New Access Token

After reconnecting, get the new access token:

**Option A: Firebase Console**
1. Go to Firebase Console → Firestore Database
2. Navigate to `user_profiles` → `Q8jMWeUzcbSS64gpmYPJKKwqixJ2`
3. Copy the `plaid_token` value (this is the new access token)

**Option B: Browser Console**
1. Open your app, press F12
2. Go to Console tab
3. Run:
```javascript
const auth = getAuth();
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const token = await user.getIdToken();
    const res = await fetch('/api/user/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    console.log('New Plaid Token:', data.profile?.plaid_token);
  }
});
```

### Step 4: Test After Reconnect

Run the test again with the new access token:

```bash
npm run test:plaid:reconnect <new-access-token> Q8jMWeUzcbSS64gpmYPJKKwqixJ2 --after-reconnect
```

## What to Look For

After reconnecting, check if:

1. **More Transactions**: Total transaction count increased
2. **Earlier First Transaction**: First transaction date is earlier than 2025-08-19
3. **More History**: Days from first transaction increased

## Expected Results

### Best Case Scenario
- First transaction date goes back to October 2024 (when account was active)
- Total transactions increase significantly
- You get the full year of transactions needed for tax filing

### Likely Scenario
- Same number of transactions (Plaid doesn't fetch more history on reconnect)
- Connection date remains the same (2025-08-19)
- You'll need to use CSV import for older transactions

## Alternative: CSV Import

If reconnecting doesn't fetch more history, you can:

1. **Download CSV from your bank**:
   - Log into Discover.com
   - Go to Account Activity
   - Export transactions for Oct 2024 - Aug 2025
   - Download as CSV

2. **Import CSV** (once CSV import feature is built):
   - Go to Settings → Import Transactions
   - Upload CSV file
   - Map columns and import

## Test Results Storage

Test results are saved to `scripts/.reconnect-test-results.json` for comparison.

## Commands Reference

```bash
# Test before reconnect
npm run test:plaid:reconnect <access_token> <user_id>

# Test after reconnect
npm run test:plaid:reconnect <new_access_token> <user_id> --after-reconnect

# Test maximum transactions (730 days)
npm run test:plaid:reconnect <access_token> <user_id>

# Test 1-year specifically
npm run test:plaid:force-1year <access_token> <user_id>

# Test full history with multiple date ranges
npm run test:plaid:full-history <access_token> <user_id>
```

