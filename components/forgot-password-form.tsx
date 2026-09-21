"use client";

import { cn } from "@/lib/utils";
import { resetPassword } from "@/lib/firebase/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { useRef, useState } from "react";

export function ForgotPasswordForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const sending = useRef(false);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await resetPassword(email.trim());
      // Preserve the same response for unknown accounts, including projects that
      // have not yet enabled Firebase's email enumeration protection.
      if (error && error.code !== 'auth/user-not-found') {
        setError(error.code === 'auth/network-request-failed'
          ? 'We could not send the request. Check your connection and try again.'
          : error.code === 'auth/too-many-requests'
            ? 'Too many requests. Please wait a few minutes and try again.'
            : error.code === 'auth/invalid-email'
              ? 'Please enter a valid email address.'
              : 'We could not send the reset request. Please try again.');
        return;
      }
      setSuccess(true);
    } catch {
      setError('We could not send the reset request. Please try again.');
    } finally {
      sending.current = false;
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      {success ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Check Your Email</CardTitle>
            <CardDescription>Password reset request received</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p role="status" className="text-sm text-muted-foreground">
              If you registered using your email and password, you will receive
              a password reset email.
            </p>
            <p className="text-sm text-muted-foreground">Check your inbox and spam folder. Use the latest reset email.</p>
            <Button variant="outline" className="w-full" onClick={() => setSuccess(false)}>Try another email</Button>
            <Link href="/auth/login" className="block text-center text-sm underline">Back to sign in</Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Reset Your Password</CardTitle>
            <CardDescription>
              Type in your email and we&apos;ll send you a link to reset your
              password
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleForgotPassword}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="email" required>Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="writeoffapp@gmail.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Sending..." : "Send reset email"}
                </Button>
              </div>
              <div className="mt-4 text-center text-sm">
                Already have an account?{" "}
                <Link
                  href="/auth/login"
                  className="underline underline-offset-4"
                >
                  Login
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
