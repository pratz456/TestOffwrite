"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/firebase/auth-context";
import { Button } from "@/components/ui/button";
import { LoginAnchor } from "@/components/landing/public-auth-links";
import { PUBLIC_SIGN_UP_HREF } from "@/lib/public-auth-links";
import { Sparkles } from "lucide-react";

export function BlogCTA({ variant = "inline" }: { variant?: "inline" | "full" }) {
  const { user, loading } = useAuth();
  const signedIn = !loading && !!user;
  const href = signedIn ? "/protected" : PUBLIC_SIGN_UP_HREF;
  const buttonText = signedIn ? "Go to Dashboard" : "Start Your Free Trial";

  if (variant === "inline") {
    return (
      <div className="not-prose my-8 rounded-xl border border-green-200/60 bg-green-50/50 px-6 py-5">
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
          <div className="flex-1">
            <p className="text-base font-semibold text-foreground">
              <Sparkles className="mr-1.5 inline-block h-4 w-4 text-primary" />
              Keep your expense records together.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter expenses, upload receipts, and review the details in WriteOff. Try free for 30 days, with no bank connection required.
            </p>
          </div>
          {signedIn ? (
            <Button asChild size="default" className="rounded-lg bg-primary font-semibold text-white shadow-md hover:shadow-lg hover:brightness-110">
              <Link href={href}>{buttonText}</Link>
            </Button>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Button asChild size="default" className="rounded-lg bg-primary font-semibold text-white shadow-md hover:shadow-lg hover:brightness-110">
                <a href={href}>{buttonText}</a>
              </Button>
              <LoginAnchor />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="relative mt-12 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/5 via-blue-50/50 to-cyan-50/30 px-6 py-10 text-center sm:px-10 sm:py-14">
      <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full opacity-[0.08]" style={{ background: "radial-gradient(circle, hsl(221 83% 53%), transparent 70%)" }} />
      <div className="pointer-events-none absolute -bottom-20 -left-20 h-48 w-48 rounded-full opacity-[0.06]" style={{ background: "radial-gradient(circle, hsl(160 60% 45%), transparent 70%)" }} />

      <h3 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
        Ready to organize your business expenses?
      </h3>
      <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
        Save expenses and receipts as you go. Review their business purpose and prepare records for your accountant. In-app filing and AI analysis are not available in this preview.
      </p>
      <div className="mt-6 flex flex-col items-center gap-3">
        {signedIn ? (
          <Button asChild size="lg" className="rounded-lg bg-primary px-8 py-3 text-base font-semibold text-white shadow-md hover:shadow-lg hover:brightness-110">
            <Link href={href}>{buttonText}</Link>
          </Button>
        ) : (
          <>
            <Button asChild size="lg" className="rounded-lg bg-primary px-8 py-3 text-base font-semibold text-white shadow-md hover:shadow-lg hover:brightness-110">
              <a href={href}>{buttonText}</a>
            </Button>
            <LoginAnchor />
          </>
        )}
        <p className="text-xs text-muted-foreground">
          30-day free trial &middot; No credit card required &middot; Cancel anytime
        </p>
      </div>
    </section>
  );
}
