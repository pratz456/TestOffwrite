import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const restored = {
  "app/page.tsx":
    "Organize business expenses, review receipts, and export records for your tax preparer. Start with manual entry, with no bank connection required.",
  "app/layout.tsx":
    "Organize business expenses, review receipts, and export records for your tax preparer. Start with manual entry, with no bank connection required.",
  "app/opengraph-image.tsx": "Start manually, with no bank connection required.",
  "components/landing/restored/hero-section.tsx":
    "Save expenses and receipts, review their business purpose, and prepare records for your accountant. Start with manual entry—no bank connection required.",
  "lib/content/faq.ts":
    "Set up your work profile, enter an expense or upload a receipt, then review the amount, date, category and business purpose. You can download your records archive on any plan or use report exports with a trial or Premium plan. No bank connection is required to get started.",
} as const;

describe("site-wide bank wording", () => {
  it("keeps the original no-bank-connection lines", () => {
    for (const [file, sentence] of Object.entries(restored)) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(source, file).toContain(sentence);
    }
  });
});
