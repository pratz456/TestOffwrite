"use client";

import Link from "next/link";
import { useAuth } from "@/lib/firebase/auth-context";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export function BlogCTA({ variant = "inline" }: { variant?: "inline" | "full" }) {
  const { user, loading } = useAuth();
  const href = user ? "/protected" : "/welcome";
  const buttonText = user ? "Go to Dashboard" : "Start Your Free Trial";

  if (variant === "inline") {
    return (
      <div className="not-prose my-8 rounded-xl border border-green-200/60 bg-green-50/50 px-6 py-5">
        <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
          <div className="flex-1">
            <p className="text-base font-semibold text-foreground">
              <Sparkles className="mr-1.5 inline-block h-4 w-4 text-primary" />
              Stop tracking expenses manually.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              WriteOff&apos;s AI automatically finds and categorizes your deductions in real-time. Try free for 30 days.
            </p>
          </div>
          <Link href={href}>
            <Button
              size="default"
              disabled={loading}
              className="rounded-lg bg-primary font-semibold text-white shadow-md hover:shadow-lg hover:brightness-110"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                </span>
              ) : (
                buttonText
              )}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section className="relative mt-12 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/5 via-blue-50/50 to-cyan-50/30 px-6 py-10 text-center sm:px-10 sm:py-14">
      <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full opacity-[0.08]" style={{ background: "radial-gradient(circle, hsl(221 83% 53%), transparent 70%)" }} />
      <div className="pointer-events-none absolute -bottom-20 -left-20 h-48 w-48 rounded-full opacity-[0.06]" style={{ background: "radial-gradient(circle, hsl(160 60% 45%), transparent 70%)" }} />

      <h3 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
        Ready to stop overpaying taxes?
      </h3>
      <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
        WriteOff&apos;s AI finds every deduction, tracks expenses as you go, and estimates your quarterly taxes automatically. No spreadsheets. No guesswork.
      </p>
      <div className="mt-6 flex flex-col items-center gap-3">
        <Link href={href}>
          <Button
            size="lg"
            disabled={loading}
            className="rounded-lg bg-primary px-8 py-3 text-base font-semibold text-white shadow-md hover:shadow-lg hover:brightness-110"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              </span>
            ) : (
              buttonText
            )}
          </Button>
        </Link>
        <p className="text-xs text-muted-foreground">
          30-day free trial &middot; No credit card required &middot; Cancel anytime
        </p>
      </div>
    </section>
  );
}
