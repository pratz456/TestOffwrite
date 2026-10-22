import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlogCTA } from "@/components/blog/blog-cta";

globalThis.React = React;

const source = readFileSync(new URL("../components/blog/blog-cta.tsx", import.meta.url), "utf8");
const INLINE = "Enter expenses, upload receipts, and review the details in WriteOff. Try WriteOff free for 30 days, no credit card needed. Add expenses by hand or upload receipts.";
const PREVIEW = "In-app filing and AI analysis are not available in this preview.";

describe("blog CTA wording", () => {
  it("replaces the bank-connection sentence and leaves the preview sentence", () => {
    expect(source).toContain(INLINE);
    expect(source).toContain(PREVIEW);
    expect(source.toLowerCase()).not.toContain("no bank connection");
    const inline = renderToStaticMarkup(React.createElement(BlogCTA, { variant: "inline" }));
    const full = renderToStaticMarkup(React.createElement(BlogCTA, { variant: "full" }));
    expect(inline).toContain("Try WriteOff free for 30 days, no credit card needed. Add expenses by hand or upload receipts.");
    expect(inline.toLowerCase()).not.toContain("no bank connection");
    expect(full).toContain(PREVIEW);
    expect(full.toLowerCase()).not.toContain("no bank connection");
  });
});
