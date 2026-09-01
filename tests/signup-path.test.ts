import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");

function readRepo(relPath: string) {
  return readFileSync(path.join(root, relPath), "utf8");
}

const UNSOURCED_MARKETING = [
  "$2,847 saved today",
  "4.9/5 from 200+ users",
  "4.9 out of 5",
  "from 200+ users",
  "Jordan Ellis",
  "Lila Freeman",
  "Carlos Mendoza",
  "Ashley Kim",
  "Over $11,000 saved",
];

describe("signup path: /welcome", () => {
  const welcome = readRepo("app/welcome/page.tsx");

  it("is a server component that SSRs HomeContent", () => {
    expect(welcome).not.toMatch(/^["']use client["']/);
    expect(welcome).toContain("HomeContent");
    expect(welcome).toContain("WelcomeAuthRedirect");
  });

  it("does not gate the page on a Firebase loading spinner", () => {
    expect(welcome).not.toContain("useAuth");
    expect(welcome).not.toContain("Loading...");
    expect(welcome).not.toContain("if (loading)");
  });

  it("keeps authenticated redirect off the critical SSR path", () => {
    const redirect = readRepo("components/welcome-auth-redirect.tsx");
    expect(redirect).toContain("use client");
    expect(redirect).toContain("router.replace(\"/protected\")");
    expect(redirect).toMatch(/return null/);
  });
});

describe("signup path: /login", () => {
  it("has a /login route that aliases /auth/login", () => {
    expect(existsSync(path.join(root, "app/login/page.tsx"))).toBe(true);
    const login = readRepo("app/login/page.tsx");
    expect(login).toContain('redirect(`/auth/login');
  });

  it("redirects /login in middleware so GET /login is not a 404", () => {
    const middleware = readRepo("middleware.ts");
    expect(middleware).toContain("pathname === '/login'");
    expect(middleware).toContain("url.pathname = '/auth/login'");
  });

  it("declares a Next.js redirect from /login to /auth/login", () => {
    const config = readRepo("next.config.ts");
    expect(config).toContain('source: "/login"');
    expect(config).toContain('destination: "/auth/login"');
  });
});

describe("marketing copy", () => {
  const landingFiles = [
    "components/landing/hero-section.tsx",
    "components/landing/landing-page.tsx",
    "components/landing/landing-header.tsx",
    "components/landing/landing-footer.tsx",
    "components/landing/problem-section.tsx",
    "components/landing/features-section.tsx",
    "components/landing/comparison-section.tsx",
    "components/landing/how-it-works-section.tsx",
    "app/page.tsx",
  ];

  it("does not ship unsourced user counts, dollars-saved, ratings, or named testimonials", () => {
    const combined = landingFiles.map(readRepo).join("\n");
    for (const claim of UNSOURCED_MARKETING) {
      expect(combined.includes(claim), `unsourced claim present: ${claim}`).toBe(false);
    }
    expect(existsSync(path.join(root, "components/landing/testimonials-section.tsx"))).toBe(
      false,
    );
    expect(combined).not.toContain("TestimonialsSection");
  });
});
