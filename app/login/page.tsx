import { redirect } from "next/navigation";

/**
 * Belt-and-suspenders: middleware already 307s /login → /auth/login
 * with the query string. This page must stay static (no searchParams).
 */
export default function LoginAliasPage() {
  redirect("/auth/login");
}
