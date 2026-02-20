# Public assets

**`writeofflogo.png`** – App logo used for:

- Favicon and app icons (`app/layout.tsx`, `manifest.json`)
- In-app logo (header, sidebar, auth screens)

**`og-image.png`** – Static Open Graph / Twitter image for link previews. Generate it by running `npm run dev`, opening http://localhost:3000/opengraph-image, and saving the image as `public/og-image.png`. Required so link previews work in production (the dynamic route can return 500 in serverless).
