import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

function toQueryString(params: SearchParams): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) usp.append(key, v);
    } else if (typeof value === "string") {
      usp.set(key, value);
    }
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

/**
 * /login is a common bookmark and CTA target. The working form lives
 * at /auth/login; this route aliases it so GET /login is not a 404.
 */
export default async function LoginAliasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  redirect(`/auth/login${toQueryString(params)}`);
}
