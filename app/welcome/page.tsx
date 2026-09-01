import { HomeContent } from "@/components/home-content";
import { WelcomeAuthRedirect } from "@/components/welcome-auth-redirect";

/**
 * Server page: always SSR the existing HomeContent (Create Account / Sign In).
 * Firebase auth is client-only; waiting on it produced a spinner-only HTML
 * response for signed-out users. Authenticated redirect to /protected happens
 * in the background and does not replace this page with a spinner.
 */
export default function WelcomePage() {
  return (
    <>
      <WelcomeAuthRedirect />
      <HomeContent />
    </>
  );
}
