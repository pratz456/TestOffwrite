/**
 * Canonical WriteOff auth entry points.
 * Keep a single login and a single sign-up — aliases must point here.
 */
export const AUTH_LOGIN_PATH = "/auth/login";
export const AUTH_SIGN_UP_PATH = "/auth/sign-up";
export const APP_SHELL_PATH = "/protected";

const AUTH_SESSION_COOKIES = ["firebase-auth-token", "__session"] as const;

export function hasAuthSessionCookie(
  getCookie: (name: string) => { value?: string } | undefined | null,
): boolean {
  return AUTH_SESSION_COOKIES.some((name) => Boolean(getCookie(name)?.value));
}

/** /login is an alias of the existing Firebase login — never a third form. */
export function loginAliasDestination(
  search?: string | URLSearchParams | Record<string, string | string[] | undefined> | null,
): string {
  const query = toQueryString(search);
  return query ? `${AUTH_LOGIN_PATH}?${query}` : AUTH_LOGIN_PATH;
}

function toQueryString(
  search?: string | URLSearchParams | Record<string, string | string[] | undefined> | null,
): string {
  if (!search) return "";
  if (typeof search === "string") {
    return search.replace(/^\?/, "");
  }
  if (search instanceof URLSearchParams) {
    return search.toString();
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, value);
    }
  }
  return params.toString();
}
