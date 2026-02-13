# Quick Test Guide for Plaid Transactions

## 🚀 Instant Testing Options

### Option 1: Quick Test (Recommended - Uses Firestore)

If you have a user ID with a connected Plaid account:

```bash
npm run test:plaid:quick <your-user-id>
```

**Example:**
```bash
npm run test:plaid:quick abc123xyz
```

This script will:
1. Automatically fetch the Plaid access token from Firestore
2. Run both 1-year and maximum transaction tests
3. Show detailed date validation

### Option 2: Manual Test (With Access Token)

If you have a Plaid access token directly:

```bash
npm run test:plaid <access_token> [user_id]
```

**Example:**
```bash
npm run test:plaid access-sandbox-abc123 user123
```

## 📋 How to Get Your User ID

### Method 1: From Browser Console
1. Open your app in the browser
2. Open Developer Console (F12)
3. Type: `firebase.auth().currentUser?.uid` or check the user object
4. Copy the user ID

### Method 2: From Firestore Console
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Navigate to Firestore Database
3. Open `user_profiles` collection
4. Copy any user document ID

### Method 3: From App Settings
1. Log into your app
2. Go to Settings
3. Check the URL or inspect the page - user ID might be visible

## 🔑 How to Get Plaid Access Token

### Method 1: From Firestore (Easiest)
The `quick-test-plaid.js` script does this automatically!

### Method 2: Manual Extraction
1. Go to Firebase Console → Firestore
2. Open `user_profiles` collection
3. Find your user document
4. Copy the `plaid_token` field value

### Method 3: From Browser Console
```javascript
// In browser console after logging in
const user = firebase.auth().currentUser;
fetch(`/api/subscriptions/check-access`, {
  headers: { Authorization: `Bearer ${await user.getIdToken()}` }
})
.then(r => r.json())
.then(console.log);
```

## ✅ What the Test Checks

1. **1-Year Transaction Retrieval**:
   - Fetches 365 days of transactions
   - Validates date range calculation
   - Compares first transaction date with today
   - Shows if you successfully got 1 year of history

2. **Maximum Transaction Retrieval**:
   - Tests Plaid's maximum (730 days / 2 years)
   - Validates pagination for large datasets
   - Shows total transaction count

3. **Date Validation**:
   - First transaction date vs today
   - Expected vs actual date ranges
   - Warnings if transactions are outside requested range

## 📊 Expected Output

```
================================================================================
🧪 TEST: 1-Year Transaction Retrieval (365 days)
================================================================================

📅 Date Range Configuration (matching app logic):
   Start Date: 2024-12-18 (12/18/2024)
   End Date:   2025-12-17 (12/17/2025)
   Requested:  365 days (1 year)
   Calculated: 365 days
   Actual:     365 days

📊 Found 2 account(s)
🔍 Testing with account: Checking Account (acc-xxx)

📄 Page 1: Retrieved 500 transactions (Total so far: 500/1250)
📄 Page 2: Retrieved 500 transactions (Total so far: 1000/1250)
📄 Page 3: Retrieved 250 transactions (Total so far: 1250/1250)

✅ Transaction Fetch Results:
   Total Transactions: 1250
   Total Pages: 3

📅 Transaction Date Analysis:
   First Transaction Date: 2024-12-18 (12/18/2024)
   Last Transaction Date:  2025-12-17 (12/17/2025)
   Today's Date:           2025-12-17 (12/17/2025)

   Days from first transaction to today: 365 days
   Days from last transaction to today:  0 days
   Requested date range:                 365 days

✅ Validation (First Transaction Date vs Today):
   ✓ First transaction is within the requested 1-year range
   ✓ Date difference: 0 days (within tolerance)
   ✓ Successfully retrieved 1 year (365 days) of transaction history
   ✓ First transaction date: 2024-12-18 is 365 days before today
```

## 🐛 Troubleshooting

### Error: "User not found"
- Make sure the user ID is correct
- Check that the user exists in Firestore `user_profiles` collection

### Error: "No Plaid access token found"
- User hasn't connected a bank account yet
- Connect a bank account via Plaid Link in the app first

### Error: "Plaid credentials not found"
- Make sure `.env.local` has `PLAID_CLIENT_ID` and `PLAID_SECRET`
- Check that you're running from the project root directory

### Error: "Invalid access token"
- Token might be expired or invalid
- Reconnect the bank account to get a new token

## 💡 Tips

- Use sandbox/test mode for testing (won't affect real accounts)
- The test uses the first account found - modify the script to test specific accounts
- Check the console output for detailed pagination and date information
- The script validates that the date calculation matches your app's logic

