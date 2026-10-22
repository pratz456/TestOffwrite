"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/firebase/auth-context";
import { Button } from "@/components/ui/button";
import { LoginAnchor } from "@/components/landing/public-auth-links";
import { PUBLIC_SIGN_UP_HREF } from "@/lib/public-auth-links";
import { cn } from "@/lib/utils";

interface CtaButtonProps {
  className?: string;
  size?: "default" | "lg";
  label?: string;
  variant?: "default" | "outline";
}

export function CtaButton({ className, size = "default", label, variant = "default" }: CtaButtonProps) {
  const { user, loading } = useAuth();
  const classes = cn("min-h-11 rounded-lg font-semibold transition-all duration-200", size === "lg" && "h-12 px-8 text-base", variant === "default" && "bg-primary text-white shadow-md hover:shadow-lg hover:brightness-110", variant === "outline" && "border-primary text-primary hover:bg-primary/5", className);

  if (!loading && user) {
    return (
      <Button asChild variant={variant} size={size} className={classes}>
        <Link href="/protected">Go to Dashboard</Link>
      </Button>
    );
  }

  // Server HTML is the loading state. A real anchor has to be in that markup;
  // a disabled button is not a crawlable or pre-hydration link.
  const signUpLabel = loading ? (label ?? "Get started") : (label ?? "Get Started Free");
  return (
    <>
      <Button asChild variant={variant} size={size} className={classes}>
        <a href={PUBLIC_SIGN_UP_HREF}>{signUpLabel}</a>
      </Button>
      <LoginAnchor />
    </>
  );
}

export function AuthButtons({ className, size = "default" }: { className?: string; size?: "default" | "lg" }) {
  return <div className={cn("flex items-center gap-2", className)}><CtaButton size={size} label="Login / Register" /></div>;
}
