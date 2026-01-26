import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ProtectedLayoutClient } from "@/components/protected-layout-client";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side authentication check
  // This prevents unauthorized users from even loading protected pages
  const cookieStore = await cookies();
  const firebaseToken = cookieStore.get('firebase-auth-token')?.value;
  const sessionCookie = cookieStore.get('__session')?.value;

  // If no auth token or session cookie, redirect to login
  // Client-side will handle the redirect param for better UX
  if (!firebaseToken && !sessionCookie) {
    redirect('/auth/login?redirect=/protected');
  }

  // Client-side checks will handle token verification and provide better UX
  return <ProtectedLayoutClient>{children}</ProtectedLayoutClient>;
}
