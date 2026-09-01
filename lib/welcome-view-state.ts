/**
 * /welcome must never block anonymous visitors on an auth spinner.
 * Auth `loading` starts true during SSR/prerender; do not wait on it.
 */
export type WelcomeView = "home" | "redirecting";

export function getWelcomeView(user: unknown): WelcomeView {
  return user ? "redirecting" : "home";
}
