"use client";

import { PageBackground } from "@/components/graphics/page-background";
import { SubtlePattern } from "@/components/graphics/subtle-pattern";
import { LandingHeader } from "./landing-header";
import { HeroSection } from "./hero-section";
import { ProblemSection } from "./problem-section";
import { FeaturesSection } from "./features-section";
import { ComparisonSection } from "./comparison-section";
import { HowItWorksSection } from "./how-it-works-section";
import { TestimonialsSection } from "./testimonials-section";
import { LandingFooter } from "./landing-footer";

export function LandingPage() {
  return (
    <div className="light relative min-h-screen overflow-x-hidden bg-background text-foreground" style={{ colorScheme: "light" }}>
      <PageBackground />
      <SubtlePattern />
      <LandingHeader />
      <main>
        <HeroSection />
        <ProblemSection />
        <FeaturesSection />
        <ComparisonSection />
        <HowItWorksSection />
        <TestimonialsSection />
      </main>
      <LandingFooter />
    </div>
  );
}
