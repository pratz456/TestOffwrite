import type { Metadata } from "next";
import { HomeContent } from "@/components/home-content";
import { WelcomeAuthRedirect } from "@/components/welcome-auth-redirect";

export const metadata: Metadata = {
  title: "Welcome",
  description: "Create an account or sign in to WriteOff.",
};

/**
 * Post-signup / get-started page.
 *
 * Must SSR real content. A client-only Firebase auth gate previously
 * rendered only "Loading…" in the HTML, so people landing here after
 * signup saw a spinner and bounced.
 *
 * Authenticated users are redirected to /protected in the background
 * without replacing this page with a spinner.
 */
export default function WelcomePage() {
  return (
    <>
      <WelcomeAuthRedirect />
      <HomeContent />
    </>
  );
}
