"use client";

import { LandingHeader } from "./landing-header";
import { HeroSection } from "./hero-section";
import { ComparisonSection } from "./comparison-section";
import { HowItWorksSection } from "./how-it-works-section";
import { LandingFooter } from "./landing-footer";

export function LandingPage() {
  return (
    <div className="light min-h-screen bg-[#f5f5f7] text-slate-950" style={{ colorScheme: "light", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <LandingHeader />
      <main>
        <HeroSection />
        <HowItWorksSection />
        <ComparisonSection />
      </main>
      <LandingFooter />
    </div>
  );
}
