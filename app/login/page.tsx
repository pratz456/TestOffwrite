import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

function loginAliasDestination(params: SearchParams): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) usp.append(key, v);
    } else if (typeof value === "string") {
      usp.set(key, value);
    }
  }
  const qs = usp.toString();
  return qs ? `/auth/login?${qs}` : "/auth/login";
}

/**
 * /login is a 404 on the live site; the working form is /auth/login.
 * This alias redirects there and keeps the query string. Not a third form.
 */
export default async function LoginAliasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  redirect(loginAliasDestination(await searchParams));
}
