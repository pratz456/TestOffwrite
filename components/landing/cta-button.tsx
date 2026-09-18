"use client";

import Link from "next/link";
import { useAuth } from "@/lib/firebase/auth-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CtaButtonProps {
  className?: string;
  size?: "default" | "lg";
  label?: string;
  variant?: "default" | "outline";
}

export function CtaButton({ className, size = "default", label, variant = "default" }: CtaButtonProps) {
  const { user, loading } = useAuth();
  const text = user ? "Open WriteOff" : (label ?? "Get started");
  const classes = cn("rounded-xl font-medium shadow-none", size === "lg" && "h-12 px-6 text-base", className);

  if (loading) {
    return <Button variant={variant} size={size} disabled className={classes} aria-label="Loading account">{label ?? "Get started"}</Button>;
  }

  return (
    <Button asChild variant={variant} size={size} className={classes}>
      <Link href={user ? "/protected" : "/welcome"}>{text}</Link>
    </Button>
  );
}

export function AuthButtons({ className, size = "default" }: { className?: string; size?: "default" | "lg" }) {
  return <div className={cn("flex items-center gap-2", className)}><CtaButton size={size} /></div>;
}
