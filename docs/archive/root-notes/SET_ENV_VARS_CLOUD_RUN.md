# Setting Environment Variables in Cloud Run for Next.js

Your Plaid credentials are configured in Firebase Functions config, but Next.js API routes run on Cloud Run and need environment variables set directly.

## Option 1: Via Google Cloud Console (Recommended)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select project: **writeoff-23910**
3. Navigate to **Cloud Run** → **Services**
4. Find service: **ssrwriteoff23910** (or similar)
5. Click on the service name
6. Click **"EDIT & DEPLOY NEW REVISION"**
7. Go to **"Variables & Secrets"** tab
8. Click **"ADD VARIABLE"** and add (use values from your secrets manager, not real keys in git):

   ```
   PLAID_CLIENT_ID = <your-plaid-client-id>
   PLAID_SECRET = <your-plaid-secret>
   PLAID_ENV = production
   OPENAI_API_KEY = <your-openai-api-key>
   ```

9. Click **"DEPLOY"**

## Option 2: Via Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com/project/writeoff-23910)
2. Navigate to **Functions** → **Configuration**
3. Look for environment variables section
4. Add the same variables as above

## Option 3: Via gcloud CLI (if you have gcloud installed)

```bash
gcloud run services update ssrwriteoff23910 \
  --region=us-central1 \
  --update-env-vars="PLAID_CLIENT_ID=<id>,PLAID_SECRET=<secret>,PLAID_ENV=production,OPENAI_API_KEY=<key>"
```

## After Setting Variables

1. The Cloud Run service will automatically restart with new variables
2. Test the bank connection again at https://writeoffapp.com
3. The error should be resolved
