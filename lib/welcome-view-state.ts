/**
 * /welcome must never block anonymous visitors on an auth spinner.
 * Auth `loading` starts true during SSR/prerender and can stay true if
 * Firebase session resolution is slow or hangs after signup.
 */
export type WelcomeView = "home" | "redirecting";

export function getWelcomeView(user: unknown): WelcomeView {
  return user ? "redirecting" : "home";
}

export const AUTH_SETTLE_TIMEOUT_MS = 2500;
