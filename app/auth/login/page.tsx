import { LoginForm } from "@/components/login-form";
import { Suspense } from "react";

export default function Page() {
  return (
    <Suspense fallback={<p role="status">Loading sign-in…</p>}>
      <LoginForm />
    </Suspense>
  );
}
