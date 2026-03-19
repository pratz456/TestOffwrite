# Fix: `auth/unauthorized-domain`

Firebase Authentication only allows sign-in from **authorized domains**. If you open the app from a host that isn’t on the list, you’ll see:

```text
FirebaseError: Firebase: Error (auth/unauthorized-domain).
```

## Fix (Firebase Console)

1. Open [Firebase Console](https://console.firebase.google.com/) → your project.
2. Go to **Build** → **Authentication** → **Settings** (gear tab).
3. Scroll to **Authorized domains**.
4. Click **Add domain** and add the **exact hostname** you use in the browser (no `http://`, no path).

### Common cases

| You open the app at | Add this domain |
|---------------------|-----------------|
| `http://localhost:3000` | `localhost` is usually already listed. |
| `http://127.0.0.1:3000` | Add **`127.0.0.1`** (not the same as `localhost` to Firebase). |
| `http://192.168.x.x:3000` | Add that IP (e.g. `192.168.1.5`). |
| Vercel / staging | Add your host, e.g. `your-app.vercel.app`. |
| Custom domain | Add e.g. `app.writeoffapp.com`. |

5. Save and **hard refresh** the app (or try again in a new tab).

## Dev tip

Prefer **`http://localhost:3000`** for local dev so you don’t need to authorize `127.0.0.1` separately.

This cannot be fixed in application code—only in the Firebase project settings.
