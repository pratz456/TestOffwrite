# Firebase Authentication Setup Guide

## Issues Fixed

This guide addresses the Firebase authentication issues you were experiencing:

1. ✅ **Email verification now required** - Users must verify their email before signing in
2. ✅ **Improved sign-in flow** - Better error handling and user feedback
3. ✅ **Fixed middleware** - Proper session handling with Firebase auth tokens
4. ✅ **Enhanced UI** - Better user experience with verification status and resend options

## Environment Variables Required

Create a `.env.local` file in your project root with the following variables:

```env
# Firebase Configuration (Client-side)
# Get the remaining values from Firebase Console → Project Settings → General → Your apps → Web app config
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key_here
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=writeoff-23910.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=writeoff-23910
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=writeoff-23910.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-your_measurement_id

# Firebase Admin SDK (Server-side) - ✅ CONFIGURED
FIREBASE_ADMIN_PROJECT_ID=writeoff-23910
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-fbsvc@writeoff-23910.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nPASTE_YOUR_PRIVATE_KEY_FROM_JSON_HERE\n-----END PRIVATE KEY-----\n"

# Other API Keys (fill in your actual values)
OPENAI_API_KEY=your_openai_api_key
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_SECRET=your_plaid_secret
PLAID_ENV=sandbox
```

## Firebase Console Configuration

### 1. Enable Email Verification

1. Go to Firebase Console → Authentication → Settings
2. Click on "Templates" tab
3. Configure the "Email address verification" template:
   - Customize the email template if needed
   - Set the action URL to your domain: `https://yourdomain.com/auth/confirm`

### 2. Configure Authentication Domain

1. Go to Authentication → Settings → Authorized domains
2. Add your production domain
3. For development, `localhost` should already be added

### 3. Email Provider Settings

1. Go to Authentication → Settings → Advanced
2. Under "User account linking", ensure settings are appropriate
3. Under "User actions", make sure email verification is enabled

## How the Authentication Flow Now Works

### Sign Up Process:
1. User fills out sign-up form
2. Firebase creates the user account
3. **Verification email is automatically sent**
4. User is redirected to success page with instructions
5. User can resend verification email if needed

### Sign In Process:
1. User enters email and password
2. Firebase authenticates credentials
3. **System checks if email is verified**
4. If not verified: Shows error message with verification instructions
5. If verified: User is signed in and redirected to protected area

### Session Management:
1. Firebase auth state is monitored client-side
2. Auth token is stored in cookies for server-side middleware
3. Protected routes check for valid auth token
4. Automatic redirect to login for unauthenticated users

## Files Modified

- `lib/firebase/auth.ts` - Added email verification functions
- `lib/firebase/middleware.ts` - Fixed session handling
- `lib/firebase/auth-context.tsx` - New auth context for token management
- `app/auth/sign-up-success/page.tsx` - Enhanced with resend functionality

## Quick Setup Steps

### 1. Create Your `.env.local` File
Create a `.env.local` file in your project root and copy the template above. Then:

**✅ Already configured:**
- `FIREBASE_ADMIN_PROJECT_ID=writeoff-23910`
- `FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-fbsvc@writeoff-23910.iam.gserviceaccount.com`

**🔧 You need to add:**
1. **Private Key**: Copy from your service account JSON file (`private_key` field)
2. **Client-side config**: Get from Firebase Console → Project Settings → General → Web app

### 2. Get Client-Side Firebase Config
Go to Firebase Console → Project Settings → General → Your apps → Web app config:
1. Copy `apiKey` → `NEXT_PUBLIC_FIREBASE_API_KEY`
2. Copy `messagingSenderId` → `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`  
3. Copy `appId` → `NEXT_PUBLIC_FIREBASE_APP_ID`
4. Copy `measurementId` → `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`

### 3. Add Your Private Key
From your downloaded service account JSON:
```json
{
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG...\n-----END PRIVATE KEY-----\n"
}
```
Copy that entire value to `FIREBASE_ADMIN_PRIVATE_KEY` (keep the quotes!)

## Testing the Fix

1. **Complete environment setup** following steps above
2. **Test sign-up flow**:
   - Create a new account
   - Check that verification email is received
   - Verify the email works properly
3. **Test sign-in flow**:
   - Try signing in before email verification (should be blocked)
   - Verify email and then sign in (should work)
4. **Test protected routes**:
   - Access `/protected` without authentication (should redirect to login)
   - Sign in and access protected routes (should work)

## Troubleshooting

### Email Not Received
- Check spam/junk folder
- Verify Firebase email templates are configured
- Use the "Resend verification email" button
- Check Firebase Console logs

### Sign-in Issues
- Ensure email is verified first
- Check browser console for errors
- Verify environment variables are set correctly
- Check Firebase Console authentication logs

### Middleware Issues
- Clear browser cookies and try again
- Check that auth token is being set in cookies
- Verify middleware configuration in `middleware.ts`

## Next Steps

1. Set up your environment variables
2. Configure Firebase email templates
3. Test the authentication flow
4. Consider adding additional features like password reset
5. Set up proper error monitoring and logging
