import { redirect } from "next/navigation";
import { loginAliasDestination } from "@/lib/auth-routes";

/**
 * /login is a 404 on the live site; the real form lives at /auth/login.
 * This alias redirects there — it is not a third login page.
 */
export default async function LoginAliasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(loginAliasDestination(await searchParams));
}
