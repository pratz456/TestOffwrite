import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlogCTA } from "@/components/blog/blog-cta";

globalThis.React = React;

const source = readFileSync(new URL("../components/blog/blog-cta.tsx", import.meta.url), "utf8");
const INLINE = "Enter expenses, upload receipts, and review the details in WriteOff. Try free for 30 days, with no bank connection required.";
const PREVIEW = "In-app filing and AI analysis are not available in this preview.";

describe("blog CTA wording", () => {
  it("keeps the original inline sentence and the preview sentence", () => {
    expect(source).toContain(INLINE);
    expect(source).not.toContain("Add expenses by hand");
    expect(source).toContain(PREVIEW);
    const inline = renderToStaticMarkup(React.createElement(BlogCTA, { variant: "inline" }));
    const full = renderToStaticMarkup(React.createElement(BlogCTA, { variant: "full" }));
    expect(inline).toContain(INLINE);
    expect(inline).not.toContain("Add expenses by hand");
    expect(full).toContain(PREVIEW);
  });
});
