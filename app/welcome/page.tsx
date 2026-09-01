import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HomeContent } from "@/components/home-content";
import { WelcomeAuthRedirect } from "@/components/welcome-auth-redirect";
import { APP_SHELL_PATH, hasAuthSessionCookie } from "@/lib/auth-routes";

export const metadata: Metadata = {
  title: "Welcome",
  description:
    "Create a WriteOff account or sign in to track 1099 tax deductions.",
};

/**
 * SSR renders the real welcome/onboarding. Firebase auth is client-only, so
 * we must not wait on it — that produced a spinner-only page for signed-out users.
 * Signed-in visitors with a session cookie go straight to the app shell.
 */
export default async function WelcomePage() {
  const cookieStore = await cookies();
  if (hasAuthSessionCookie((name) => cookieStore.get(name))) {
    redirect(APP_SHELL_PATH);
  }

  return (
    <>
      <WelcomeAuthRedirect />
      <HomeContent />
    </>
  );
}
