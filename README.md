# WriteOff

Effortless tax deduction management for freelancers and small businesses.

## Tech Stack

- **Next.js 15** (App Router, Turbopack)
- **React 18**
- **Firebase** (Auth, Firestore, Hosting, Cloud Functions)
- **Stripe** (subscriptions)
- **Plaid** (bank account integration)
- **OpenAI** (AI-powered transaction analysis)
- **TypeScript**, **Tailwind CSS**, **shadcn/ui**

## Local Setup

### Prerequisites

- Node.js 20 (see `.nvmrc`)
- npm

### Install and Run

```bash
# Use Node 20 (Windows: run before npm commands)
. .\tools\powershell\ensure-node-20.ps1

# Install dependencies
npm install

# Start dev server
npm run dev
```

App runs at [http://localhost:3000](http://localhost:3000).

### Cross-origin dev warning (`100.x.x.x` → `/_next/*`)

If you use **Tailscale or a LAN IP** in the browser (e.g. `http://100.70.31.101:3000`) while `npm run dev` binds to `localhost`, Next.js may warn about cross-origin `/_next` requests. Add the **hostname only** (no `http://`, no port) to `.env.local`:

```env
NEXT_ALLOWED_DEV_ORIGINS=100.70.31.101
```

Use commas for multiple hosts. Restart the dev server after changing.

### `auth/unauthorized-domain`

If sign-in fails with that error, add your browser hostname in Firebase **Authentication → Settings → Authorized domains** (e.g. add `127.0.0.1` if you use that instead of `localhost`). See [docs/setup/firebase-unauthorized-domain.md](docs/setup/firebase-unauthorized-domain.md).

## Production Build

```bash
npm run build
firebase deploy --only "hosting,firestore"
```

## Environment Variables

Create `.env.local` with:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_FIREBASE_*` | Firebase client config (apiKey, authDomain, projectId, etc.) |
| `NEXT_ALLOWED_DEV_ORIGINS` | Optional. Hostnames allowed to load dev `/_next/*` (e.g. Tailscale IP). See troubleshooting below. |
| `FIREBASE_ADMIN_*` | Firebase Admin (projectId, clientEmail, privateKey) |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | Plaid API |
| `OPENAI_API_KEY` | OpenAI API |
| `STRIPE_*` | Stripe keys for subscriptions |

See `docs/setup/` for detailed setup guides.

## Deployment

- **CI:** GitHub Actions (`.github/workflows/ci.yml`)
- **Hosting:** Firebase Hosting + Cloud Functions (Next.js SSR)
- **Database:** Firestore

## Folder Structure

| Path | Description |
|------|-------------|
| `app/` | Next.js App Router (pages, API routes) |
| `components/` | React components |
| `lib/` | Firebase, Plaid, Stripe, AI logic |
| `ui/` | shadcn/ui primitives |
| `scripts/` | Build and deploy scripts |
| `docs/` | Documentation and archive |
| `tools/` | PowerShell and utility scripts |
