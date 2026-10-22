import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [
  "app/page.tsx",
  "app/layout.tsx",
  "app/opengraph-image.tsx",
  "components/landing/restored/hero-section.tsx",
  "lib/content/faq.ts",
];

describe("site-wide bank wording", () => {
  it("drops the no-bank-connection claim from the listed copy", () => {
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(source.toLowerCase(), file).not.toContain("no bank connection");
    }
  });
});
