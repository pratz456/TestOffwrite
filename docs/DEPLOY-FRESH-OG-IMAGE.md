# Deploy so the link preview shows the WriteOff image

The link preview uses a **static** image so it works even when the dynamic OG route returns 500 in production.

## 0. Add the static OG image (required once)

Meta tags point to **`/og-image.png`**, which must exist in **`public/og-image.png`**.

**Option A – Save from browser (easiest)**  
1. Run `npm run dev`.  
2. Open **http://localhost:3000/opengraph-image** in your browser.  
3. Right‑click the image → **Save image as…** → save as **`og-image.png`** in the **`public`** folder.

**Option B – Script (dev server must be running)**  
In one terminal run `npm run dev`. In another:
```powershell
node scripts/save-og-image.js
```
This fetches the image from the dev server and writes `public/og-image.png`.

Commit **`public/og-image.png`** so it is included in the build and deploy.

## 1. Ensure nothing is locking build files

- Close Cursor/VS Code (or at least stop `npm run dev` and any terminals in this project).
- Close any other app that might have the project folder open.

## 2. Clean and build locally (optional but recommended)

In a **new** terminal:

```powershell
cd c:\WriteOFF\Feb\WriteOffAppWebsite

# Remove build output so Firebase can't reuse old artifacts
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .firebase -ErrorAction SilentlyContinue

# Fresh build (includes WriteOff opengraph-image)
npm run build
```

If `Remove-Item` fails with "Access denied", close every app using this folder and try again, or skip the delete and just run `npm run build`.

## 3. Deploy to Firebase Hosting

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
firebase deploy --only hosting
```

- Wait until the command finishes **without** errors.
- If you see "Could not determine the web framework", run the same from a terminal opened **outside** Cursor (e.g. Windows Terminal or PowerShell), after closing Cursor.

## 4. Confirm the new image

- **Image:** Meta tags use **`/og-image.png`** (static file from `public/`). After deploy, open **https://writeoffapp.com/og-image.png** in a private window to confirm the image loads.
- You should see the WriteOff image (dark card, “WriteOff”, “Stop overpaying taxes…”, CTA).
- **Metadata:** Set `NEXT_PUBLIC_SITE_URL=https://writeoffapp.com` (or your production URL) in the build/deploy environment so `metadataBase` is correct and crawlers get an absolute image URL.
- Then use [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) for `https://www.writeoffapp.com` and re-share the link so the preview updates.

If the scraper shows **"No image found"**: (1) Set `NEXT_PUBLIC_SITE_URL=https://writeoffapp.com` (or your production URL) **before** the build so the `og:image` tag gets an absolute URL. (2) After deploy, open `https://writeoffapp.com/opengraph-image` and `https://writeoffapp.com/og-image.png` in a private window and confirm both return the image (200). If that URL returns 404 or 500, the dynamic route isn’t running in production (check Firebase Hosting/Next.js setup). (3) Re-run the metadata debugger and clear caches.
