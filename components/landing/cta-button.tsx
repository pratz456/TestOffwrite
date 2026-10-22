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
  const classes = cn("rounded-xl font-medium shadow-none", size === "lg" && "h-12 px-6 text-base", className);

  if (!loading && user) {
    return (
      <Button asChild variant={variant} size={size} className={classes}>
        <Link href="/protected">Open WriteOff</Link>
      </Button>
    );
  }

  return (
    <>
      <Button asChild variant={variant} size={size} className={classes}>
        <a href={PUBLIC_SIGN_UP_HREF}>{label ?? "Get started"}</a>
      </Button>
      <LoginAnchor />
    </>
  );
}

export function AuthButtons({ className, size = "default" }: { className?: string; size?: "default" | "lg" }) {
  return <div className={cn("flex items-center gap-2", className)}><CtaButton size={size} /></div>;
}
