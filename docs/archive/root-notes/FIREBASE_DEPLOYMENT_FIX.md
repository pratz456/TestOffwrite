# Firebase Hosting Next.js 16 Deployment Fix

## Problem

During Firebase deployment, you encountered errors:
```
• non-static component /api/accounts/[accountId]/mark-personal/route
• non-static component /api/accounts/[accountId]/usage/route
• non-static component /api/accounts/route
• non-static component /api/ai/analyze-transaction/route
• non-static component /api/ai/parse-voice-command/route
• and 84 other reasons, use --debug to see more

Error: An unexpected error has occurred.
```

## Root Cause

Next.js 16 API routes require explicit configuration for Firebase Hosting's experimental frameworks integration. Routes that use the Node.js runtime need both:

1. `export const runtime = 'nodejs'` - Specifies Node.js runtime
2. `export const dynamic = 'force-dynamic'` - Tells Firebase these are dynamic routes, not static

Without `dynamic = 'force-dynamic'`, Firebase tries to statically analyze the routes and fails, causing the "non-static component" warnings.

## Solution Applied

A script was created and executed to automatically add `export const dynamic = 'force-dynamic'` to all API routes that had `export const runtime = 'nodejs'` but were missing the dynamic export.

### Files Fixed

**26 API routes** were automatically updated:
- `app/api/accounts/route.ts`
- `app/api/accounts/[accountId]/mark-personal/route.ts`
- `app/api/accounts/[accountId]/usage/route.ts`
- `app/api/ai/analyze-transaction/route.ts`
- `app/api/ai/parse-voice-command/route.ts`
- `app/api/analysis-job/route.ts`
- `app/api/analysis-status/route.ts`
- `app/api/cpa-question/route.ts`
- `app/api/database/accounts/route.ts`
- `app/api/debug/transaction-status/route.ts`
- `app/api/debug/transactions/route.ts`
- `app/api/monthly-deductions/route.ts`
- `app/api/openai/analyze-transaction/route.ts`
- `app/api/plaid/auto-analyze/route.ts`
- `app/api/plaid/exchange-public-token/route.ts`
- `app/api/plaid/get-accounts/route.ts`
- `app/api/plaid/import-transactions/route.ts`
- `app/api/plaid/items/route.ts`
- `app/api/plaid/items/[itemId]/route.ts`
- `app/api/plaid/refresh-balances/route.ts`
- `app/api/plaid/webhook/route.ts`
- `app/api/receipts/[filename]/route.ts`
- `app/api/reports/export/route.ts`
- `app/api/reports/generate-pdf/route.ts`
- `app/api/stripe/webhook/route.ts`
- `app/api/tax/schedule-c/export/route.ts`
- `app/api/test-firebase-permissions/route.ts`
- `app/api/transactions/analysis-status/route.ts`
- `app/api/transactions/route.ts`
- `app/api/upload-receipt/route.ts`
- `app/api/user/export/route.ts`

### Pattern Applied

Each fixed route now has:
```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ... rest of the route code
```

## Remaining Routes

46 routes were skipped because they either:
- Already have both exports
- Don't use Node.js runtime (might use Edge runtime)
- Are static routes that don't need these exports

If you encounter deployment issues with any of these routes, you may need to add the exports manually.

## Additional Fix: Next.js Output Configuration

**Update:** The `output: "standalone"` configuration in `next.config.ts` was removed because it's incompatible with Firebase Hosting's frameworks integration. Firebase expects to manage the build output itself.

See `FIREBASE_DEPLOYMENT_ERROR_FIX.md` for details on this additional fix.

## Verification

After these fixes, try deploying again:
```bash
npm run build
firebase deploy --only hosting
```

The "non-static component" warnings are expected (Firebase correctly detecting dynamic routes), but the deployment should now complete successfully without the "unexpected error".

If errors persist, try with debug flag:
```bash
firebase deploy --only hosting --debug
```

## Script

A script is available to fix any remaining routes if needed:
```bash
node scripts/fix-api-routes-dynamic.js
```

## Related Documentation

- See `FIREBASE_NEXTJS_COMPATIBILITY.md` for information about Next.js 16 compatibility with Firebase Hosting
- This fix addresses the compatibility issues mentioned in that document
