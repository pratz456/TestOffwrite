import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlogCTA } from "@/components/blog/blog-cta";

globalThis.React = React;

const source = readFileSync(new URL("../components/blog/blog-cta.tsx", import.meta.url), "utf8");
const INLINE = "Enter expenses, upload receipts, and review the details in WriteOff. Try WriteOff free for 30 days, no credit card needed.";

describe("blog CTA wording", () => {
  it("replaces the bank-connection sentence on the inline call to action", () => {
    expect(source).toContain(INLINE);
    expect(source).not.toContain("Add expenses by hand");
    expect(source.toLowerCase()).not.toContain("no bank connection");
    const inline = renderToStaticMarkup(React.createElement(BlogCTA, { variant: "inline" }));
    const full = renderToStaticMarkup(React.createElement(BlogCTA, { variant: "full" }));
    expect(inline).toContain(INLINE);
    expect(inline).not.toContain("Add expenses by hand");
    expect(inline.toLowerCase()).not.toContain("no bank connection");
    expect(full.toLowerCase()).not.toContain("no bank connection");
  });
});
