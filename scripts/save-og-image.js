/**
 * Saves the OG image from the local dev server to public/og-image.png.
 * Run with the dev server already running: npm run dev (in another terminal), then node scripts/save-og-image.js
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "..", "public");
const outPath = path.join(publicDir, "og-image.png");

http
  .get(`http://localhost:${port}/opengraph-image`, (res) => {
    if (res.statusCode !== 200) {
      console.error(`Got ${res.statusCode} from /opengraph-image. Is the dev server running (npm run dev)?`);
      process.exit(1);
    }
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => {
      const buffer = Buffer.concat(chunks);
      fs.mkdirSync(publicDir, { recursive: true });
      fs.writeFileSync(outPath, buffer);
      console.log(`Saved ${buffer.length} bytes to ${outPath}`);
    });
  })
  .on("error", (err) => {
    console.error("Failed to fetch /opengraph-image:", err.message);
    console.error("Make sure the dev server is running: npm run dev");
    process.exit(1);
  });
