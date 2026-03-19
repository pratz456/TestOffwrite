import { PageBackground } from "@/components/graphics/page-background";
import { SubtlePattern } from "@/components/graphics/subtle-pattern";
import { LandingHeader } from "@/components/landing/landing-header";
import { LandingFooter } from "@/components/landing/landing-footer";

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="light relative min-h-screen overflow-x-hidden bg-background text-foreground"
      style={{ colorScheme: "light" }}
    >
      <PageBackground />
      <SubtlePattern />
      <LandingHeader />
      <main>{children}</main>
      <LandingFooter />
    </div>
  );
}
